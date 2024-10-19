/*
 * util.js
 *
 * This module is full of functions that are of general interest.
 *
 * Note that this function bears the same name as node's built-in util module.
 * This one is require()d with require('./util') while the built-in one with require('util')
 */
var path = require("path");
var log = require("./log").logger("util");
var fs = require("fs");
var q = require("q");
var uuid = require("uuid");
var escapeRE = require("escape-regexp-component");
var exec = require("child_process").exec;
var stream = require("stream");
var util = require("util");
var mime = require("mime");
var errors = require("restify");

// These are consulted by various upload functions
const ALLOWED_APP_EXTENSIONS = [".zip", ".fma"];

const GCODE_EXTENSIONS = [".nc", ".g", ".gc", ".gcode"];
const OPENSBP_EXTENSIONS = [".sbp", ".sbc"];

var MethodNotAllowedError = errors.MethodNotAllowedError;
var NotAuthorizedError = errors.NotAuthorizedError;
var ResourceNotFoundError = errors.ResourceNotFoundError;

function listify(x) {
    if (x instanceof Array) {
        return x;
    } else {
        return [x];
    }
}

// Execute a command in the shell
//   callback - gets the output of the command (stdout)
function doshell(command, callback) {
    // eslint-disable-next-line no-unused-vars
    exec(command, function (error, stdout, stderr) {
        callback(stdout);
    });
}

// Call the 'sync' function (linux)
// Careful - this function waits for a second before returning
function diskSync(callback) {
    doshell("sync", function () {
        setTimeout(function () {
            callback();
        }, 1000);
    });
}

// Extend an object with the properties of another object.
// force - If true, create new keys in a if they do not already exist.  Otherwise, don't.
// Example:
//   extend( {a:1,b:2,c:{d:3}}, {a:2,c:{d:4}}) = {a:2,b:2,c:{d:4}}
function extend(a, b, force) {
    for (var k in b) {
        if (Object.prototype.hasOwnProperty.call(a, k) || force) {
            if (typeof b[k] === "object" && b[k] !== null) {
                if (typeof a[k] === "object" && a[k] !== null) {
                    extend(a[k], b[k], force);
                } else {
                    if (force) {
                        a[k] = b[k];
                    } else {
                        log.warn("Object format error in extend.");
                    }
                }
            } else {
                a[k] = b[k];
            }
        }
    }
}

// Return the filename given a full path
// TODO - this seems senseless - can't we just use the path module where needed?
exports.filename = function (pathname) {
    var parts = pathname.split(path.sep);
    return parts[parts.length - 1];
};

// Create and return a unique filename with the same extension as the provided filename
//   filename - an existing filename whose extension will be copied for the new filename
//    Example:
//      createUniqueFilename('/opt/fabmo/example.sbp') -> '12345.sbp'
//
var createUniqueFilename = function (filename) {
    var extension = /[.]/.exec(filename) ? /[^.]+$/.exec(filename) : undefined;
    return uuid.v1() + (extension ? "." + extension : "");
};

// Simple queue, faster than using array.shift
// Example:
//    var q = new Queue()
//    q.enqueue('a')
//    q.enqueue('b')
//    q.enqueue('c')
//
//    q.dequeue() -> 'a'
//    q.multiDequeue(2) -> ['b','c']
//
function Queue() {
    var queue = [];
    var offset = 0;

    this.getLength = function () {
        return queue.length - offset;
    };
    this.getContents = function () {
        return queue;
    };
    this.isEmpty = function () {
        return queue.length === 0;
    };
    this.enqueue = function (item) {
        queue.push(item);
    };
    this.multiEnqueue = function (iterable) {
        iterable.forEach(function (item) {
            queue.push(item);
        });
    };
    this.dequeue = function () {
        // if the queue is empty, return immediately
        if (queue.length === 0) return undefined;

        // store the item at the front of the queue
        var item = queue[offset];

        // increment the offset and remove the free space if necessary
        if (++offset * 2 >= queue.length) {
            queue = queue.slice(offset);
            offset = 0;
        }

        // return the dequeued item
        return item;
    };

    // Return up to count items from the queue (in the order they would be retrieved if dequeued)
    //   count - The number of items to return
    //           Note: If there are fewer than the number of requested items in the queue
    //                 all items in the queue will be returned.
    this.multiDequeue = function (count) {
        // If asking for more items than are in the queue, return everything
        count = count > queue.length ? queue.length : count;

        // store the item at the front of the queue
        var items = queue.slice(offset, offset + count);

        // add to the offset and remove the free space if necessary
        offset += count;
        if (offset * 2 >= queue.length) {
            queue = queue.slice(offset);
            offset = 0;
        }

        // return the dequeued item
        return items;
    };

    this.peek = function () {
        return queue.length > 0 ? queue[offset] : undefined;
    };
    this.clear = function () {
        queue = [];
        offset = 0;
    };
}

// Return true if this is an allowable NC file
// TODO - this sort of functionality should really be moved to the runtimes
// TODO - function name should be camel case in keeping with coding conventions
function allowed_file(filename) {
    return isGCodeFile(filename) || isOpenSBPFile(filename);
}

function isGCodeFile(pathname) {
    return GCODE_EXTENSIONS.indexOf(path.extname(pathname).toLowerCase()) !== -1;
}

function isOpenSBPFile(pathname) {
    return OPENSBP_EXTENSIONS.indexOf(path.extname(pathname).toLowerCase()) !== -1;
}

// Return true if this is an allowable file to contain an app.
// TODO - This check should live in the app manager, really.
function allowedAppFile(filename) {
    if (ALLOWED_APP_EXTENSIONS.indexOf(path.extname(filename).toLowerCase()) !== -1) {
        return true;
    } else {
        return false;
    }
}

/**
 * Move a file from src to dest, avoiding cross-device rename failures.
 * This method will first try fs.rename and call the supplied callback if it succeeds. Otherwise
 * it will pipe the conent of src into dest and unlink src upon completion.
 *
 * This might take a little more time than a single fs.rename, but it avoids error when
 * trying to rename files from one device to the other.
 */
var move = function (src, dest, cb) {
    var renameDeferred = q.defer();

    fs.rename(src, dest, function (err) {
        if (err) {
            renameDeferred.reject(err);
        } else {
            renameDeferred.resolve();
        }
    });

    renameDeferred.promise.then(
        function () {
            // rename worked
            return cb(null);
        },
        function (err) {
            log.warn("io.move: standard rename failed, trying stream pipe... (" + err + ")");

            // rename didn't work, try pumping
            var is = fs.createReadStream(src),
                os = fs.createWriteStream(dest);

            is.pipe(os);

            is.on("end", function () {
                fs.unlinkSync(src);
                cb(null);
            });

            is.on("error", function (err) {
                return cb(err);
            });

            os.on("error", function (err) {
                return cb(err);
            });
        }
    );
};

function serveStatic(opts) {
    opts = opts || {};
    /*
    assert.object(opts, 'options');
    assert.string(opts.directory, 'options.directory');
    assert.optionalNumber(opts.maxAge, 'options.maxAge');
    assert.optionalObject(opts.match, 'options.match');
    assert.optionalString(opts.charSet, 'options.charSet');
    */

    var p = path.normalize(opts.directory).replace(/\\/g, "/");
    var re = new RegExp("^" + escapeRE(p) + "/?.*");

    function serveFileFromStats(file, err, stats, isGzip, req, res, next) {
        if (err) {
            next(new ResourceNotFoundError(err, req.path()));
            return;
        } else if (!stats.isFile()) {
            next(new ResourceNotFoundError("%s does not exist", req.path()));
            return;
        }

        if (res.handledGzip && isGzip) {
            res.handledGzip();
        }

        var fstream = fs.createReadStream(file + (isGzip ? ".gz" : ""));
        var maxAge = opts.maxAge === undefined ? 3600 : opts.maxAge;
        // eslint-disable-next-line no-unused-vars
        fstream.once("open", function (fd) {
            res.cache({ maxAge: maxAge });
            res.set("Content-Length", stats.size);
            res.set("Content-Type", mime.lookup(file));
            res.set("Last-Modified", stats.mtime);
            if (opts.charSet) {
                var type = res.getHeader("Content-Type") + "; charset=" + opts.charSet;
                res.setHeader("Content-Type", type);
            }
            if (opts.etag) {
                res.set("ETag", opts.etag(stats, opts));
            }
            res.writeHead(200);
            fstream.pipe(res);
            fstream.once("end", function () {
                next(false);
            });
        });
    }

    function serveNormal(file, req, res, next) {
        fs.stat(file, function (err, stats) {
            if (!err && stats.isDirectory() && opts.default) {
                // Serve an index.html page or similar
                file = path.join(file, opts.default);
                fs.stat(file, function (dirErr, dirStats) {
                    serveFileFromStats(file, dirErr, dirStats, false, req, res, next);
                });
            } else {
                serveFileFromStats(file, err, stats, false, req, res, next);
            }
        });
    }

    function serve(req, res, next) {
        var uricomp = decodeURIComponent(req.path());
        var file = path.join(opts.directory, uricomp);

        if (req.method !== "GET" && req.method !== "HEAD") {
            next(new MethodNotAllowedError(req.method));
            return;
        }

        if (!re.test(file.replace(/\\/g, "/"))) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.match && !opts.match.test(file)) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.gzip && req.acceptsEncoding("gzip")) {
            fs.stat(file + ".gz", function (err, stats) {
                if (!err) {
                    res.setHeader("Content-Encoding", "gzip");
                    serveFileFromStats(file, err, stats, true, req, res, next);
                } else {
                    serveNormal(file, req, res, next);
                }
            });
        } else {
            serveNormal(file, req, res, next);
        }
    }

    return serve;
}

// TODO better error handling here
// TODO bad argument name
// Return a tree structure that represents a walk of the specified directory
//   filename - The name of the directory to walk ()
// Each node in the returned object has the following properties:
//     path : The path of the object
//     text : The filename only
//     name : The filename (again?  TODO: Why?)
//     type : 'file' for files, 'dir' for directories
// children : A list of child nodes, if this is a directory
function walkDir(filename) {
    var stats = fs.lstatSync(filename),
        info = {
            path: filename,
            text: path.basename(filename),
            name: path.basename(filename),
        };

    if (stats.isDirectory()) {
        info.type = "dir";
        info.children = fs.readdirSync(filename).map(function (child) {
            return walkDir(filename + "/" + child);
        });
    } else {
        // Assuming it's a file. In real life it could be a symlink or
        // something else!
        info.type = "file";
        info.children = null;
    }

    return info;
}

// Get the size of this file
//   path - Path to check
//     cb - Callback gets the size as an integer number of bytes, or error
// TODO - is this really needed?
function getSize(path, cb) {
    fs.stat(path, function (err, stats) {
        if (err) {
            cb(err);
        } else {
            cb(null, stats.size);
        }
    });
}

// TODO: I am pretty sure this function is terrible.
// Look at where it's used, and re-evaluate the need for it.  I think it should be factored out.
function fixJSON(json) {
    var retval = {};

    for (var key in json) {
        if (typeof json[key] === "object") {
            var value = fixJSON(json[key]);
        } else {
            // eslint-disable-next-line no-redeclare
            var value = Number(json[key]);
            if (typeof value === "undefined" || isNaN(value)) {
                if (json[key] === "true") {
                    value = true;
                } else if (json[key] === "false") {
                    value = false;
                } else {
                    value = json[key];
                }
            }
        }
        if (key[0] === "_") {
            key = key.slice(1);
        }
        retval[key] = value;
    }
    return retval;
}

// Watchdog object
// Simple object that keeps a recurring timer that, if it expires,
// will exit the application.  Timer can be refreshed by the reset() method.
// Works like a watchdog in an embedded system that resets the CPU if a process runs away.

// TODO:  Not sure that this is currently used, but it doesn't do anything. (exit stuff commented out)
//        I think a more useful watchdog would accept a callback in its constructor, and simply call that
//        in the case that it expires.
function Watchdog(timeout, exit_code) {
    this.watchdog_flag;
    this.watchdog_timeout = timeout || 1000;
    this.watchdog_exit_code = exit_code || 20;

    var watchdog_exit = function () {
        //throw new Error("G2 is not responding");
        //process.exit(this.watchdog_exit_code);
    };

    this.start = function (watchdog_timeout) {
        if (this.watchdog_flag === undefined) {
            this.watchdog_flag = setTimeout(watchdog_exit, watchdog_timeout);
        } else {
            this.reset();
        }
    };

    this.stop = function () {
        if (this.watchdog_flag) {
            clearTimeout(this.watchdog_flag);
            this.watchdog_flag = undefined;
        }
    };

    this.reset = function (watchdog_timeout) {
        if (this.watchdog_flag) {
            clearTimeout(this.watchdog_flag);
            this.watchdog_flag = setTimeout(watchdog_exit, watchdog_timeout);
        }
    };
}

// Convenience function for getting the client IP address from a restify request.
var getClientAddress = function (req) {
    return (req.headers["x-forwarded-for"] || "").split(",")[0] || req.connection.remoteAddress;
};

// Check to see if something is a number (strings that parse to numbers, for example)
var isANumber = function (n) {
    if (n === null) {
        return false;
    }
    try {
        n = Number(n);
        return !Number.isNaN(n);
    } catch (e) {
        return false;
    }
};

// Unit conversion, Rounded
var mm2inR = function (mm) {
    return Math.round((mm / 25.4) * 1000) / 1000;
};

// Unit conversion, Rounded
var in2mmR = function (inch) {
    return Math.round(inch * 25.4 * 100) / 100;
};

// Unit conversion
var mm2in = function (mm) {
    return mm / 25.4;
};

// Unit conversion
var in2mm = function (inch) {
    return inch * 25.4;
};

// Unit type normalizer
var unitType = function (u) {
    u = String(u).trim().toLowerCase();
    switch (u) {
        case "0":
        case "in":
            return "in";
        case "1":
        case "mm":
            return "mm";
        default:
            throw new Error("Invalid unit type specifier: " + u);
    }
};

function LineNumberer(options) {
    // allow use without new
    if (!(this instanceof LineNumberer)) {
        return new LineNumberer(options);
    }
    this.count = 20; ////## lower numbers for prepend/postpend
    this.start = true;
    this.input = "";
    this.output = "";
    // We start with lastChar as a newline to start each stream with a line number.
    this.lastChar = "\n";
    // init Transform
    stream.Transform.call(this, options);
}
util.inherits(LineNumberer, stream.Transform);

LineNumberer.prototype._transform = function (chunk, enc, next) {
    this.input = chunk.toString();
    // log.debug("input:  " + this.input);
    // Walk the input chunk and add new line number after each newline if line number is not present
    for (const c of this.input) {
        if (this.lastChar == "\n") {
            this.count += 1;
            this.output += c == "N" ? "" : "N" + this.count + " ";
            this.output += c;
        } else {
            this.output += c;
        }
        this.lastChar = c;
    }
    // log.debug("output:  " + this.output);
    this.push(this.output);
    this.output = "";
    next();
};

LineNumberer.prototype._flush = function (done) {
    // Ensure we end with a new line so the final line is sent.
    this.push("\n");
    done();
};

var countLineNumbers = function (filename, callback) {
    var i;
    var lines = 0;
    require("fs")
        .createReadStream(filename)
        .on("data", function (chunk) {
            for (i = 0; i < chunk.length; ++i) if (chunk[i] == 10) lines++;
        })
        .on("end", function () {
            callback(null, lines);
        });
};

var addTimerParam = function (timer, params = {}) {
    params["timer"] = timer;
    if (params["message"] == null || params["message"] === undefined) {
        params["message"] = "Pausing for " + params["timer"] + " Seconds ...";
    }
    return params;
};

// var addMessageParam = function (message, params = {}) {
//     params["message"] = message;
//     return params;
// };

var addInputParam = function (input_var, params = {}) {
    params["input"] = { name: input_var.name, type: input_var.type };
    return params;
};

var addOkParam = function (ok, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(params, "custom")) {
        params["custom"] = {};
    }
    params.custom["ok"] = {
        text: ok["text"],
        func: ok["func"],
    };
    return params;
};

var addCancelParam = function (cancel, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(params, "custom")) {
        params["custom"] = {};
    }
    params.custom["cancel"] = {
        text: cancel["text"],
        func: cancel["func"],
    };
    return params;
};

var addTitleParam = function (title, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(params, "custom")) {
        params["custom"] = {};
    }
    params.custom["title"] = title;
    return params;
};

var addDetailParam = function (detail, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(params, "custom")) {
        params["custom"] = {};
    }
    params.custom["detail"] = detail;
    return params;
};

var addNoButtonParam = function (noButton, params = {}) {
    if (!Object.prototype.hasOwnProperty.call(params, "custom")) {
        params["custom"] = {};
    }
    params.custom["noButton"] = noButton;
    return params;
};

// PAUSE/DIALOG MODAL DISPLAY OPTIONS
// The flexible MODAL display options are based on function:  packageModalParams(<new parameters>, <current info object>)

// This function accepts a set of optional new parameters and optional current status['info'] as an object ready for send to front end.
// If called without arguments, a basic info object with 'message': 'Paused ...' will be created.
// Functionality is built around use for OpenSBP PAUSE display on the client, but can be very flexible.

// Current Info Object should be the output of a prior execution of PAUSE/DIALOGUE or the info section of a status update object prior to transmission.
// New Parameters is an object with one or more of the available customization parameters defined as below:
//     timer:  INT Sets Timer param (only greater than 10 sec will display) and message text to accompany duration number.
// TIMER_DISPLAY_CUTOFF is controlling variable for display of PAUSE modal.
// NOTE: if Timer is included only TIMER and Message params will be set. Timer is intended for timed pause and should not be used in
//               conjunction with other customizations.
//     message: STRING sets the message to be displayed in the modal to the provided string.

//     input: FABMO VARIABLE OBJECT object with name and type properties defining a variable to be provided by the user and set to provided value on resume.
//     okText: STRING sets the text on the green "ok" button on modal.
//         NOTE: Defaults to "ok" if set to Falsy value green "ok" button will not display.
//     okFunc: STRING sets the onclick action for the green "ok" button on modal.
//         NOTE: To set okFunc okText MUST be defined as well.  Accepts 'resume' or 'quit' other text will result in the button closing modal with no further action.
//     cancelText: STRING sets the text on the red "cancel" button on modal.
//         NOTE: Defaults to "cancel" if set to Falsy value red "cancel" button will not display.
//     cancelFunc: STRING sets the onclick action for the red "cancel" button on modal.
//         NOTE: To set cancelFunc cancelText MUST be defined as well.  Accepts 'resume' or 'quit' other text will result in the button closing modal with no further action.
//     detail: STRING HTML String that will be displayed below Message and Input in it's own Div. If ommited nothing is displayed.
//     title: STRING title of Modal box.  If ommited nothing is displayed.
//     noButton: BOOLEAN if set to a truthy value will ensure no buttons are displayed on the modal.
//         NOTE: With No Buttons there is not a way to close the modal.
// TODO: Implement Image Param?  Image Param is available on modal and parsed by dashboard.showModal() but would require a valid image source provided by this param.
// TODO: noLogo option (?) can be parsed by dashboard.showModal() but is not implemented by this function, the client status parser, or the modal HTML.
// TODO: Add packaging for error info on implementation of error handling
var packageModalParams = function (params = {}, modalParams = {}) {
    // Handle message first
    if (Object.prototype.hasOwnProperty.call(params, "message")) {
        modalParams.message = params["message"];
    }
    // Handle timer
    if (Object.prototype.hasOwnProperty.call(params, "timer")) {
        modalParams = addTimerParam(params["timer"], modalParams);
    }
    if (Object.prototype.hasOwnProperty.call(params, "input_var")) {
        modalParams = addInputParam(params["input_var"], modalParams);
    }

    // Handle okText
    if (Object.prototype.hasOwnProperty.call(params, "okText")) {
        if (params["okText"]) {
            // okText is truthy; add the OK button
            var okFunc = Object.prototype.hasOwnProperty.call(params, "okFunc") ? params["okFunc"] : "resume";
            modalParams = addOkParam({ text: params["okText"], func: okFunc }, modalParams);
        } else {
            // okText is falsy; explicitly set custom.ok to null
            if (!Object.prototype.hasOwnProperty.call(modalParams, "custom")) {
                modalParams["custom"] = {};
            }
            modalParams.custom["ok"] = null;
        }
    }

    // Handle cancelText
    if (Object.prototype.hasOwnProperty.call(params, "cancelText")) {
        if (params["cancelText"]) {
            // cancelText is truthy; add the Cancel button
            var cancelFunc = Object.prototype.hasOwnProperty.call(params, "cancelFunc") ? params["cancelFunc"] : "quit";
            modalParams = addCancelParam({ text: params["cancelText"], func: cancelFunc }, modalParams);
        } else {
            // cancelText is falsy; explicitly set custom.cancel to null
            if (!Object.prototype.hasOwnProperty.call(modalParams, "custom")) {
                modalParams["custom"] = {};
            }
            modalParams.custom["cancel"] = null;
        }
    }

    if (Object.prototype.hasOwnProperty.call(params, "detail")) {
        modalParams = addDetailParam(params["detail"], modalParams);
    }
    if (Object.prototype.hasOwnProperty.call(params, "title")) {
        modalParams = addTitleParam(params["title"], modalParams);
    }
    if (Object.prototype.hasOwnProperty.call(params, "noButton")) {
        modalParams = addNoButtonParam(params["noButton"], modalParams);
    }
    return modalParams;
};

exports.countLineNumbers = countLineNumbers;
exports.LineNumberer = LineNumberer;
exports.packageModalParams = packageModalParams;

exports.serveStatic = serveStatic;
exports.getSize = getSize;
exports.Queue = Queue;
exports.Watchdog = Watchdog;
exports.allowed_file = allowed_file;
exports.allowedAppFile = allowedAppFile;
exports.move = move;
exports.walkDir = walkDir;
exports.createUniqueFilename = createUniqueFilename;
exports.fixJSON = fixJSON;
exports.extend = extend;
exports.doshell = doshell;
exports.getClientAddress = getClientAddress;
exports.isANumber = isANumber;
exports.in2mm = in2mm;
exports.mm2in = mm2in;
exports.in2mmR = in2mmR;
exports.mm2inR = mm2inR;
exports.unitType = unitType;
exports.diskSync = diskSync;

//For unit testing, anything labeled private is for unit testing only
exports.private_listify = listify;
exports.private_mm2in = mm2in;
exports.private_in2mm = in2mm;
exports.private_unitType = unitType;
