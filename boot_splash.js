/*
 * boot_splash.js
 *
 * Binds the web port the instant the process starts — before the heavy
 * engine module tree is even require()'d — and serves a small self-contained
 * "FabMo is starting…" page so the browser shows progress instead of a
 * connection-refused error during the ~15-25s cold-boot window.
 *
 * Deliberately dependency-free (Node built-in http/fs/path only) so it loads
 * and binds in a few milliseconds. engine.js hands the port over to the real
 * restify server at the end of startup via stop().
 *
 * Lifecycle:
 *   server.js   -> boot_splash.start()           // binds port immediately
 *   engine.js   -> boot_splash.setStatus(msg)     // coarse progress labels
 *   engine.js   -> boot_splash.stop(cb)           // release port, then restify listens
 *   on failure  -> boot_splash.setError(msg)      // page shows the error
 */
var http = require("http");
var fs = require("fs");
var path = require("path");

var DEFAULT_PORT = 80;
var HTML_PATH = path.join(__dirname, "boot_splash.html");

var server = null;
var sockets = new Set();
var htmlCache = null;
var startedAt = Date.now();

var status = {
    state: "starting", // "starting" | "error"
    message: "Starting up…",
    detail: null,
};

// Read the configured web port without pulling in the heavy config module.
// Falls back to 80 (the shipped default) if anything is missing/unreadable.
function resolvePort() {
    var candidates = [
        "/opt/fabmo/config/engine.json",
        path.join(__dirname, "profiles/default/config/engine.json"),
    ];
    for (var i = 0; i < candidates.length; i++) {
        try {
            var cfg = JSON.parse(fs.readFileSync(candidates[i], "utf8"));
            if (cfg && cfg.server_port) {
                return cfg.server_port;
            }
        } catch (e) {
            // try next
        }
    }
    return DEFAULT_PORT;
}

function loadHtml() {
    if (htmlCache !== null) {
        return htmlCache;
    }
    try {
        htmlCache = fs.readFileSync(HTML_PATH, "utf8");
    } catch (e) {
        // Minimal inline fallback if the html file is somehow missing.
        htmlCache =
            "<!doctype html><meta charset=utf-8><title>FabMo is starting</title>" +
            "<meta http-equiv=refresh content=2>" +
            "<body style='font-family:sans-serif;text-align:center;margin-top:20vh'>" +
            "<h2>FabMo is starting…</h2><p>This page will load automatically.</p></body>";
    }
    return htmlCache;
}

function handle(req, res) {
    var url = (req.url || "/").split("?")[0];

    // Progress endpoint the splash page polls. The sentinel lets the page tell
    // our response apart from the real engine's once it takes over the port.
    if (url === "/boot-status") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
        });
        res.end(
            JSON.stringify({
                fabmo_boot_splash: true,
                state: status.state,
                message: status.message,
                detail: status.detail,
                elapsed: Math.round((Date.now() - startedAt) / 1000),
            })
        );
        return;
    }

    // Serve the splash page for any browser (html) GET.
    var accept = req.headers ? req.headers.accept || "" : "";
    if (req.method === "GET" && (url === "/" || accept.indexOf("text/html") !== -1 || url.indexOf(".") === -1)) {
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        });
        res.end(loadHtml());
        return;
    }

    // Everything else (API calls, assets) — tell the caller we're not ready.
    res.writeHead(503, {
        "Content-Type": "application/json",
        "Retry-After": "3",
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ status: "error", message: "FabMo is still starting", state: status.state }));
}

// Start the splash server. Best-effort: if the port can't be bound, we log and
// continue without a splash — the engine still starts normally.
function start(opts, callback) {
    if (typeof opts === "function") {
        callback = opts;
        opts = {};
    }
    opts = opts || {};
    callback = callback || function () {};
    if (server) {
        return callback(null);
    }
    var port = opts.port || resolvePort();
    startedAt = Date.now();

    server = http.createServer(handle);

    // Track sockets so stop() can force the port free promptly (keep-alive
    // connections from the polling page would otherwise delay close()).
    server.on("connection", function (socket) {
        sockets.add(socket);
        socket.on("close", function () {
            sockets.delete(socket);
        });
    });

    server.once("error", function (err) {
        // eslint-disable-next-line no-console
        console.error("[boot_splash] could not bind port " + port + ": " + err.message);
        try {
            server.close();
        } catch (e) { /* ignore */ }
        server = null;
        callback(err);
    });

    server.listen(port, "0.0.0.0", function () {
        // eslint-disable-next-line no-console
        console.log("[boot_splash] serving startup page on port " + port);
        callback(null);
    });
}

function setStatus(message, detail) {
    status.state = "starting";
    status.message = message || status.message;
    if (detail !== undefined) {
        status.detail = detail;
    }
}

function setError(message, detail) {
    status.state = "error";
    status.message = message || "Startup failed";
    if (detail !== undefined) {
        status.detail = detail;
    }
}

function isActive() {
    return !!server;
}

// Release the port so the real server can bind it. Destroys lingering sockets
// first so close() completes quickly, then waits for the 'close' event.
function stop(callback) {
    callback = callback || function () {};
    if (!server) {
        return callback(null);
    }
    var s = server;
    server = null;
    sockets.forEach(function (socket) {
        try {
            socket.destroy();
        } catch (e) { /* ignore */ }
    });
    sockets.clear();
    try {
        s.close(function () {
            callback(null);
        });
    } catch (e) {
        callback(e);
    }
}

exports.start = start;
exports.setStatus = setStatus;
exports.setError = setError;
exports.stop = stop;
exports.isActive = isActive;
