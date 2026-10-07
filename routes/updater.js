var log = require("../log").logger("updater");
var upload = require("./util").upload;
var exec = require("child_process").exec;
var got = require("got");
var fs = require("fs");
var path = require("path");
var stream = require("stream");
var config = require("../config");

/*
 * Same-origin proxy to the updater (port 81, localhost only).
 *
 * The dashboard/config app runs on :80; the updater API lives on :81.
 * Browser calls to :81 are cross-origin (no CORS there) and sit behind a
 * separate login, so the dashboard cannot drive updates directly. These
 * endpoints relay the handful of update operations server-to-server over
 * loopback, which keeps the browser same-origin and keeps the engine's own
 * authentication in front of update actions.
 */

function updaterBase() {
    return "http://127.0.0.1:" + (config.engine.get("server_port") + 1);
}

function relayError(res, err) {
    var message = err && err.message ? err.message : String(err);
    if (err && err.code === "ECONNREFUSED") {
        message = "The updater service is not running.";
    }
    res.json({ status: "error", message: message });
}

// GET /updater/status → updater /status (state, prepared updates)
var proxyStatus = function (req, res, next) {
    got(updaterBase() + "/status", { responseType: "json", timeout: 5000 })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// GET /updater/config → updater /config (platform, system — used by the
// config app to filter the package manifest it fetches in the browser)
var proxyConfig = function (req, res, next) {
    got(updaterBase() + "/config", { responseType: "json", timeout: 5000 })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// POST /updater/update/download {version} → updater downloads that package
// from the registry using the TOOL's connection (online tools only)
var proxyDownload = function (req, res, next) {
    got.post(updaterBase() + "/update/download", {
        json: { version: req.params.version },
        responseType: "json",
        timeout: 10 * 60 * 1000, // package download can be slow in the shop
    })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// POST /updater/update/apply → updater applies whatever it has prepared
var proxyApply = function (req, res, next) {
    got.post(updaterBase() + "/update/apply", { responseType: "json", timeout: 10000 })
        .then(function (r) {
            res.json(r.body);
            next();
        })
        .catch(function (err) {
            relayError(res, err);
            next();
        });
};

// Stream a .fmp/.fmu from a path on this machine to the updater's
// manual-update endpoint, which installs it immediately. The file is
// streamed, never buffered: update packages run tens of megabytes and the
// Pi may be memory-constrained. The updater's /update/manual uses a
// two-phase keyed upload protocol: a JSON metadata POST that returns a
// key, then the multipart POST carrying key + index + the file itself.
function relayPackageToUpdater(filePath, fileName, res, next) {
    fs.stat(filePath, function (statErr, stat) {
        if (statErr) {
            relayError(res, statErr);
            return next();
        }
        got.post(updaterBase() + "/update/manual", {
            json: { meta: {}, files: [{ filename: fileName }] },
            responseType: "json",
            timeout: 10000,
        })
            .then(function (metaResp) {
                var key = metaResp.body && metaResp.body.data && metaResp.body.data.key;
                if (!key) {
                    throw new Error("Updater did not issue an upload key.");
                }
                var boundary = "----fabmo-relay-" + Date.now();
                var safeName = fileName.replace(/"/g, "");
                var head = Buffer.from(
                    "--" + boundary + "\r\n" +
                    'Content-Disposition: form-data; name="key"\r\n\r\n' + key + "\r\n" +
                    "--" + boundary + "\r\n" +
                    'Content-Disposition: form-data; name="index"\r\n\r\n0\r\n' +
                    "--" + boundary + "\r\n" +
                    'Content-Disposition: form-data; name="file"; filename="' + safeName + '"\r\n' +
                    "Content-Type: application/octet-stream\r\n\r\n"
                );
                var tail = Buffer.from("\r\n--" + boundary + "--\r\n");

                var body = new stream.PassThrough();
                var request = got.post(updaterBase() + "/update/manual", {
                    body: body,
                    responseType: "json",
                    timeout: 10 * 60 * 1000,
                    headers: {
                        "content-type": "multipart/form-data; boundary=" + boundary,
                        "content-length": String(head.length + stat.size + tail.length),
                    },
                });

                body.write(head);
                var fileStream = fs.createReadStream(filePath);
                fileStream.on("error", function (readErr) {
                    log.error("Error reading update file: " + readErr.message);
                    body.destroy(readErr);
                });
                fileStream.on("end", function () {
                    body.end(tail);
                });
                fileStream.pipe(body, { end: false });

                return request;
            })
            .then(function (r) {
                log.info("Relayed update package " + fileName + " to the updater");
                res.json(r.body);
                next();
            })
            .catch(function (gotErr) {
                relayError(res, gotErr);
                next();
            });
    });
}

// POST /updater/update/manual — accept a .fmp/.fmu uploaded by the browser
// (which may have fetched it over ITS internet connection on a tool that has
// none) and forward it to the updater's manual-update endpoint.
var proxyManual = function (req, res, next) {
    // Plain multipart POST (field name "file") — not the keyed two-phase
    // protocol in util.upload, which exists for the job-submission flow.
    // restify's bodyParser has already written the file to the upload dir
    // and will delete it when this response ends.
    var file = req.files && req.files.file;
    if (!file) {
        return res.json({ status: "error", message: "No update file supplied." });
    }
    var fileName = file.name || "update.fmp";
    if (!/\.(fmp|fmu)$/i.test(fileName)) {
        return res.json({ status: "error", message: "Unknown file type for " + fileName });
    }
    relayPackageToUpdater(file.path, fileName, res, next);
};

/*
 * USB update packages. For tools where neither the Pi nor the browser has
 * internet, an update can arrive on a USB stick: we scan mounted drives for
 * .fmp/.fmu packages and offer them in the config app's update cascade.
 * A watcher on the mount directories emits a "usb_packages" change event on
 * plug-in/removal so open dashboards re-check without polling.
 */

// Same mount conventions as routes/usbFileRoutes.js.
var USB_MOUNT_POINTS = ["/media/pi", "/media/root", "/mnt"];

// "fabmo-engine_linux_raspberry-pi_v4.2.39.fmp" → {product, version}
function parsePackageName(name) {
    var product = null;
    var m = name.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)_/i);
    if (m) {
        product = m[1].toLowerCase();
    }
    var v = name.match(/_v?(\d+\.\d+\.\d+)\.(?:fmp|fmu)$/i);
    return { product: product, version: v ? "v" + v[1] : null };
}

// Scan the top level of each mounted drive (and the mount roots themselves)
// for update packages. Depth is deliberately shallow: "put the file on the
// stick" should be the whole instruction.
function scanUSBPackages(callback) {
    var results = [];
    var pendingDirs = 0;
    var done = false;
    function finish() {
        if (!done && pendingDirs === 0) {
            done = true;
            callback(null, results);
        }
    }
    function scanDir(dir, recurse) {
        pendingDirs++;
        fs.readdir(dir, function (err, entries) {
            if (err) {
                pendingDirs--;
                return finish();
            }
            entries.forEach(function (entry) {
                if (entry[0] === ".") {
                    return;
                }
                var full = path.join(dir, entry);
                pendingDirs++;
                fs.stat(full, function (statErr, stat) {
                    pendingDirs--;
                    if (!statErr) {
                        if (stat.isFile() && /\.(fmp|fmu)$/i.test(entry)) {
                            var parsed = parsePackageName(entry);
                            results.push({
                                name: entry,
                                path: full,
                                size: stat.size,
                                modified: stat.mtime,
                                product: parsed.product,
                                version: parsed.version,
                            });
                        } else if (stat.isDirectory() && recurse) {
                            scanDir(full, false);
                        }
                    }
                    finish();
                });
            });
            pendingDirs--;
            finish();
        });
    }
    USB_MOUNT_POINTS.forEach(function (root) {
        scanDir(root, true);
    });
    // All roots missing → readdir errors drain pendingDirs; make sure the
    // callback still fires even if every scanDir call fails synchronously.
    setImmediate(finish);
}

// GET /updater/usb/packages → packages found on mounted USB drives
var usbPackages = function (req, res, next) {
    scanUSBPackages(function (err, packages) {
        if (err) {
            relayError(res, err);
            return next();
        }
        res.json({ status: "success", data: { packages: packages } });
        next();
    });
};

// POST /updater/usb/install {path} → stream that package to the updater
// (which installs it immediately — same endpoint the browser relay uses)
var usbInstall = function (req, res, next) {
    var requested = req.params.path || (req.body && req.body.path);
    if (!requested) {
        res.json({ status: "error", message: "No package path supplied." });
        return next();
    }
    var resolved = path.resolve(String(requested));
    var underMount = USB_MOUNT_POINTS.some(function (root) {
        return resolved.indexOf(root + path.sep) === 0;
    });
    if (!underMount || !/\.(fmp|fmu)$/i.test(resolved)) {
        res.json({ status: "error", message: "Invalid package path." });
        return next();
    }
    fs.stat(resolved, function (err, stat) {
        if (err || !stat.isFile()) {
            relayError(res, err || new Error("Package file not found."));
            return next();
        }
        log.info("Installing update package from USB: " + resolved);
        relayPackageToUpdater(resolved, path.basename(resolved), res, next);
    });
};

// Watch the mount directories so plug-in/removal notifies open dashboards.
// Debounced: a mount generates a burst of events while files appear.
function startUSBWatcher() {
    var timer = null;
    function notify() {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(function () {
            timer = null;
            try {
                var machine = require("../machine").machine;
                if (machine) {
                    machine.emit("change", "usb_packages");
                }
            } catch (e) {
                log.warn("USB watch notify failed: " + e.message);
            }
        }, 2000);
    }
    // Watch /media too: /media/pi itself appears on first-ever mount.
    USB_MOUNT_POINTS.concat(["/media"]).forEach(function (dir) {
        try {
            var watcher = fs.watch(dir, notify);
            watcher.on("error", function () {
                /* dir vanished; mount events will still hit a parent */
            });
        } catch (e) {
            /* dir doesn't exist on this system — fine */
        }
    });
}

// function redirect(req, res, next) {
//     switch(req.method) {
//         case 'GET':
//             var host = req.headers.host.split(':')[0].trim('/');
//             var path = req.params[0];
//             var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
//             res.redirect(302, url, next);
//             break;

//         case 'POST':
//             var host = req.headers.host.split(':')[0].trim('/');
//             var path = req.params[0];
//             var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
//             var response = {'url' : url};
//             res.json(300, response);
//             break;
//     }
// }

var updateFabmo = function (req, res, next) {
    upload(req, res, next, function (err, upload) {
        log.info("Upload complete");
        log.info("Processing Manual Update");

        var uploads = upload.files;
        if (uploads.length > 1) {
            log.warn(
                "Got an upload of " +
                    uploads.length +
                    " files for a manual update when only one is allowed."
            );
        }
        var filePath = upload.files[0].file.path;
        var fileName = upload.files[0].file.name;
        console.log(filePath);
        console.log(fileName);
        // res.json({
        //     status: 'success',
        //     data:{
        //         status: 'complete'
        //     }
        // });
        try {
            if (fileName.match(/.*\.tar/i)) {
                // eslint-disable-next-line no-unused-vars
                exec("docker load < " + filePath, function (err, result) {
                    if (err) {
                        console.log("hey there was an error loading fabmo");
                    } else {
                        console.log(
                            "we loaded the fabmo hopefull watchtower restarts this"
                        );
                    }
                });
            } else {
                throw new Error("Unknown file type for " + filePath);
            }
            res.json({
                status: "success",
                data: {
                    status: "complete",
                },
            });
        } catch (err) {
            res.json({ status: "error", message: err });
        }
    });
};

module.exports = function (server) {
    server.post("/update/fabmo", updateFabmo);
    server.get("/updater/status", proxyStatus);
    server.get("/updater/config", proxyConfig);
    server.post("/updater/update/download", proxyDownload);
    server.post("/updater/update/apply", proxyApply);
    server.post("/updater/update/manual", proxyManual);
    server.get("/updater/usb/packages", usbPackages);
    server.post("/updater/usb/install", usbInstall);
    startUSBWatcher();
};
