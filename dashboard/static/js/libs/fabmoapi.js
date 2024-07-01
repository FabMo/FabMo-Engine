/* eslint-disable no-redeclare */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd) define([], factory);
    /* Browser global */ else root.FabMoAPI = factory();
})(this, function (io) {
    "use strict";

    var io = require("./socket.io.js");

    var PING_TIMEOUT = 3000;
    var makePostData = function (obj, options) {
        var file = null;
        if (obj instanceof jQuery) {
            if (obj.is("input:file")) {
                obj = obj[0];
            } else {
                obj = obj.find("input:file")[0];
            }
            file = obj.files[0];
        } else if (obj instanceof HTMLInputElement) {
            file = obj.files[0];
        } else if (obj instanceof File || obj instanceof Blob) {
            file = obj;
        } else if (typeof obj === "string") {
            file = Blob(obj, { type: "text/plain" });
        }

        if (!file) {
            var msg = "Cannot make post data from " + JSON.stringify(obj);
            throw new Error(msg);
        }

        var job = {};
        var options = options || {};
        for (var key in options) {
            0;
            job[key] = options[key];
        }
        job.file = file;
        return job;
    };

    var FabMoAPI = function (base_url) {
        this.events = {
            status: [],
            disconnect: [],
            authentication_failed: [],
            user_change: [],
            connect: [],
            job_start: [],
            job_end: [],
            change: [],
            video_frame: [],
            upload_progress: [],
        };
        var url = window.location.origin;
        this.is_refreshed = null;
        this.base_url = url.replace(/\/$/, "");
        this.commandCounter = 0;
        this.status = {};
        this.config = {};
        this._initializeWebsocket();
    };

    FabMoAPI.prototype._initializeWebsocket = function () {
        localStorage.debug = false;
        try {
            this.socket = io.connect(this.base_url + "/private", {
                reconnection: true,
                reconnectionDelay: 500,
                maxReconnectionAttempts: Infinity,
            });
        } catch (e) {
            this.socket = null;
            console.error("connection to the engine via websocket failed : " + e.message);
        }

        if (this.socket) {
            this.socket.prependAny(function (eventName, ...args) {});
            this.socket.on(
                "status",
                function (status) {
                    this._setStatus(status);
                    this.emit("status", status);
                }.bind(this)
            );

            this.socket.on(
                "change",
                function (topic) {
                    this.emit("change", topic);
                }.bind(this)
            );

            this.socket.on(
                "connect",
                function () {
                    console.info("Websocket connected");
                    this.emit("connect");
                    this.requestStatus();
                    // If we are reconnecting to the websocket while the webpage
                    // is already open, we need to refresh the page
                    if (this.is_refreshed == false) {
                        this.is_refreshed = true;
                        window.location.reload(true);
                    }
                }.bind(this)
            );

            this.socket.on("message", function (message) {
                console.info("Websocket message: " + JSON.stringify(message));
            });

            this.socket.on(
                "disconnect",
                function () {
                    this.is_refreshed = false;
                    console.info("Websocket disconnected");
                    this.emit("disconnect");
                }.bind(this)
            );

            this.socket.on(
                "authentication_failed",
                function (message) {
                    this.emit("authentication_failed", message);
                }.bind(this)
            );

            this.socket.on(
                "connect_error",
                function () {
                    this.emit("disconnect");
                    console.info("Websocket disconnected (connection error)");
                }.bind(this)
            );

            this.socket.on("user_change", function (user) {
                this.emit("user_change", user);
            });
        }
    };

    FabMoAPI.prototype.startVideoStreaming = function (callback) {
        try {
            this.videoSocket = io(this.base_url + "/video");
        } catch (e) {
            this.videoSocket = null;
            console.info("connection to the video streaming via websocket failed.");
        }

        if (this.videoSocket) {
            this.videoSocket.on(
                "frame",
                function (data) {
                    this.emit("video_frame", data);
                }.bind(this)
            );

            this.videoSocket.on(
                "connect",
                function () {
                    console.info("Video streaming websocket connected");
                }.bind(this)
            );

            this.videoSocket.on("message", function (message) {
                console.info(" Video streaming websocket message: " + JSON.stringify(message));
            });

            this.videoSocket.on(
                "disconnect",
                function () {
                    console.info("Video streaming websocket disconnected");
                }.bind(this)
            );

            this.videoSocket.on(
                "connect_error",
                function () {
                    console.info("Video streaming websocket disconnected (connection error)");
                }.bind(this)
            );
            callback();
        } else {
            callback("connection to the video streaming via websocket failed.");
        }
    };

    FabMoAPI.prototype.emit = function (evt, data) {
        var handlers = this.events[evt];
        if (handlers) {
            for (var i = 0; i < handlers.length; i++) {
                handlers[i](data);
            }
        }
    };

    FabMoAPI.prototype.on = function (message, func) {
        if (message in this.events) {
            this.events[message].push(func);
        }
    };

    FabMoAPI.prototype._setStatus = function (status) {
        var old_status = this.status;
        this.status = status;
        if (old_status.job && !status.job) {
            this.emit("job_end", old_status.job);
        }
        if (!old_status.job && status.job) {
            this.emit("job_start", status.job);
        }
    };

    FabMoAPI.prototype.ping = function (callback) {
        if (this.socket) {
            var start = Date.now();

            var fail = setTimeout(
                function () {
                    this.socket.off("pong");
                    callback(new Error("Timeout waiting for ping response."), null);
                }.bind(this),
                PING_TIMEOUT
            );

            this.socket.once("pong", function () {
                clearTimeout(fail);
                callback(null, Date.now() - start);
            });
            this.socket.emit("ping");
        }
    };

    FabMoAPI.prototype.sendTime = function (callback) {
        var d = new Date();
        var t = d.getTime();
        var data = { ms: t };
        this._post("/time", data, callback, callback);
    };

    FabMoAPI.prototype.get_time = function (callback) {
        this._get("/time", callback, callback, "time");
    };

    // Updater Configuration

    FabMoAPI.prototype.getUpdaterConfig = function (callback) {
        var callback = callback || function () {};
        this._get(
            "updater/config",
            callback,
            function (err, data) {
                this.updater_config = data;
                callback(err, data);
            }.bind(this),
            "config"
        );
    };

    FabMoAPI.prototype.setUpdaterConfig = function (cfg_data, callback) {
        this._post("updater/config", cfg_data, callback, function (err, data) {
            callback = callback || function () {};
            callback(null, cfg_data);
        });
    };

    // Configuration
    FabMoAPI.prototype.getConfig = function (callback) {
        var callback = callback || function () {};
        this._get(
            "/config",
            callback,
            function (err, data) {
                this.config = data;
                callback(err, data);
            }.bind(this),
            "config"
        );
    };

    FabMoAPI.prototype.setConfig = function (cfg_data, callback) {
        this._post("/config", cfg_data, callback, function (err, data) {
            callback = callback || function () {};
            if (err) {
                callback(err);
            } else {
                callback(null, data);
            }
        });
    };

    // Version/Info
    FabMoAPI.prototype.getVersion = function (callback) {
        this._get(
            "/version",
            callback,
            function (err, version) {
                if (err) {
                    callback(err);
                }
                this.version = version;
                callback(null, version);
            }.bind(this),
            "version"
        );
    };
    FabMoAPI.prototype.getInfo = function (callback) {
        var callback = callback || function () {};
        this._get("/info", callback, callback, "info");
    };

    // Status
    FabMoAPI.prototype.getStatus = function (callback) {
        this._get("/status", callback, callback, "status");
    };

    FabMoAPI.prototype.requestStatus = function () {
        this.socket.emit("status");
    };

    // Direct commands
    FabMoAPI.prototype.quit = function (callback) {
        this.command("quit", {}, callback);
    };

    FabMoAPI.prototype.pause = function (callback) {
        this.command("pause", {}, callback);
    };

    FabMoAPI.prototype.resume = function (input = false, callback) {
        var args = {};
        if (input) {
            args = input;
        }
        this.command("resume", args, callback);
    };

    // Jobs
    FabMoAPI.prototype.getJobQueue = function (callback) {
        this._get("/jobs/queue", callback, callback, "jobs");
    };

    FabMoAPI.prototype.getJob = function (id, callback) {
        this._get("/job/" + id, callback, callback, "job");
    };

    FabMoAPI.prototype.getJobInfo = FabMoAPI.prototype.getJob;

    FabMoAPI.prototype.resubmitJob = function (id, callback) {
        this._post("/job/" + id, {}, callback, callback);
    };

    FabMoAPI.prototype.updateOrder = function (data, callback) {
        this._patch("/job/" + data.id, data, callback, callback);
        this.emit("change", "jobs");
    };

    FabMoAPI.prototype.runNextJob = function (callback) {
        this._post("/jobs/queue/run", {}, callback, callback);
    };

    FabMoAPI.prototype.getJobHistory = function (options, callback) {
        var start = options.start || 0;
        var count = options.count || 0;
        this._get("/jobs/history?start=" + start + "&count=" + count, callback, callback, "jobs");
    };

    FabMoAPI.prototype.getJob = function (id, callback) {
        this._get("/job/" + id, callback, callback, "job");
    };

    FabMoAPI.prototype.getJobs = function (callback) {
        this._get("/jobs", callback, callback, "jobs");
    };

    FabMoAPI.prototype.deleteJob = function (id, callback) {
        this._del("/job/" + id, {}, callback, callback, "job");
    };

    FabMoAPI.prototype.clearJobQueue = function (callback) {
        this._del("/jobs/queue", callback, callback);
    };

    FabMoAPI.prototype.getJobsInQueue = function (callback) {
        this._get("/jobs/queue", callback, callback, "jobs");
    };

    // Apps
    FabMoAPI.prototype.getApps = function (callback) {
        this._get("/apps", callback, callback, "apps");
    };

    FabMoAPI.prototype.deleteApp = function (id, callback) {
        this._del("/apps/" + id, {}, callback, callback);
    };

    FabMoAPI.prototype.submitApp = function (apps, options, callback) {
        this._postUpload("/apps", apps, {}, callback, callback, "apps");
    };

    FabMoAPI.prototype.getAppConfig = function (app_id, callback) {
        this._get("/apps/" + app_id + "/config", callback, callback, "config");
    };

    FabMoAPI.prototype.setAppConfig = function (id, cfg_data, callback) {
        this._post("/apps/" + id + "/config", { config: cfg_data }, callback, callback, "config");
    };

    // Macros
    FabMoAPI.prototype.getMacros = function (callback) {
        this._get("/macros", callback, callback, "macros");
    };

    FabMoAPI.prototype.runMacro = function (id, callback) {
        this._post("/macros/" + id + "/run", {}, callback, callback, "macro");
    };

    FabMoAPI.prototype.updateMacro = function (id, macro, callback) {
        this._post("/macros/" + id, macro, callback, callback, "macro");
    };

    FabMoAPI.prototype.deleteMacro = function (id, callback) {
        this._del("/macros/" + id, {}, callback, callback);
    };

    FabMoAPI.prototype.runCode = function (runtime, code, callback) {
        var data = { cmd: code, runtime: runtime };
        this._post("/code", data, callback, callback);
    };

    FabMoAPI.prototype.gcode = function (code, callback) {
        this.runCode("gcode", code, callback);
    };

    FabMoAPI.prototype.sbp = function (code, callback) {
        this.runCode("sbp", code, callback);
    };

    FabMoAPI.prototype.goto = function (move, callback) {
        this.executeRuntimeCode("manual", { cmd: "goto", move: move });
    };

    FabMoAPI.prototype.set = function (move, callback) {
        this.executeRuntimeCode("manual", { cmd: "set", move: move });
    };

    FabMoAPI.prototype.executeRuntimeCode = function (runtime, code, callback) {
        this.socket.emit("code", { rt: runtime, data: code });
    };

    FabMoAPI.prototype.manualStart = function (axis, speed, second_axis, second_speed) {
        this.executeRuntimeCode("manual", {
            cmd: "start",
            axis: axis,
            speed: speed,
            second_axis: second_axis,
            second_speed: second_speed,
        });
    };

    FabMoAPI.prototype.manualHeartbeat = function () {
        this.executeRuntimeCode("manual", { cmd: "maint" });
    };

    FabMoAPI.prototype.manualStop = function (callback) {
        this.executeRuntimeCode("manual", { cmd: "stop" });
    };

    FabMoAPI.prototype.manualQuit = function () {
        this.executeRuntimeCode("manual", { cmd: "quit" });
    };

    FabMoAPI.prototype.manualEnter = function (options) {
        options = options || {};
        this.executeRuntimeCode("manual", {
            cmd: "enter",
            mode: options["mode"],
            hideKeypad: options["hideKeypad"],
        });
    };

    FabMoAPI.prototype.manualExit = function () {
        this.executeRuntimeCode("manual", { cmd: "exit" });
    };

    FabMoAPI.prototype.manualMoveFixed = function (axis, speed, distance, second_axis, second_distance) {
        this.executeRuntimeCode("manual", {
            cmd: "fixed",
            axis: axis,
            speed: speed,
            dist: distance,
            second_axis: second_axis,
            second_dist: second_distance,
        });
    };

    FabMoAPI.prototype.manualRunGCode = function (code) {
        this.executeRuntimeCode("manual", { cmd: "raw", code: code });
    };

    FabMoAPI.prototype.setAcc = function (acc, new_RPM, callback) {
        this._post("/acc/spindle_speed", { rpm: new_RPM }, callback);
    };

    FabMoAPI.prototype.setUix = function (acc, new_override, callback) {
        this._post("/uix/fr_override", { ovr: new_override }, callback);
    };

    FabMoAPI.prototype.connectToWifi = function (ssid, key, callback) {
        var data = { ssid: ssid, key: key };
        //        this._post("/network/wifi/connect", data, callback, callback, "wifi");
        this._post("/network/wifi/connect", data, callback, callback);
    };

    FabMoAPI.prototype.disconnectFromWifi = function (ssid, callback) {
        var data = { ssid: ssid };
        this._post("/network/wifi/disconnect", data, callback, callback);
    };

    // FabMoAPI.prototype.forgetWifi = function (callback) {
    //     this._post("/network/wifi/forget", {}, callback, callback);
    // };

    FabMoAPI.prototype.enableWifi = function (callback) {
        var data = { enabled: true };
        this._post("/network/wifi/state", data, callback, callback);
    };

    FabMoAPI.prototype.disableWifi = function (callback) {
        var data = { enabled: false };
        this._post("/network/wifi/state", data, callback, callback);
    };

    FabMoAPI.prototype.enableHotspot = function (callback) {
        var data = { enabled: true };
        this._post("/network/hotspot/state", data, callback, callback);
    };

    FabMoAPI.prototype.disableHotspot = function (callback) {
        var data = { enabled: false };
        this._post("/network/hotspot/state", data, callback, callback);
    };

    FabMoAPI.prototype.getNetworkIdentity = function (callback) {
        this._get("/network/identity", callback, callback);
    };

    FabMoAPI.prototype.setNetworkIdentity = function (identity, callback) {
        this._post("/network/identity", identity, callback, callback);
    };

    FabMoAPI.prototype.isOnline = function (callback) {
        this._get("/network/online", callback, callback, "online");
    };

    FabMoAPI.prototype.getWifiNetworks = function (callback) {
        this._get("/network/wifi/scan", callback, callback, "wifi");
    };

    FabMoAPI.prototype.getWifiNetworkHistory = function (callback) {
        this._get("/network/wifi/history", callback, callback, "history");
    };

    FabMoAPI.prototype.isWifiOn = function (callback) {
        this._get("/network/wifi/wifion", callback, callback, "wifion");
    };

    FabMoAPI.prototype.submitJob = function (job, options, callback) {
        this._postUpload("/job", job, {}, callback, callback, null, options);
    };
    FabMoAPI.prototype.submitJobs = FabMoAPI.prototype.submitJob;

    FabMoAPI.prototype.command = function (name, args, callback) {
        this.socket.emit("cmd", { name: name, args: args || {}, count: this.commandCounter }, callback);
        this.commandCounter += 1;
    };

    FabMoAPI.prototype.submitFirmwareUpdate = function (file, options, callback, progress) {
        this._postUpload("/firmware/update", file, {}, callback, callback, null, progress);
    };

    FabMoAPI.prototype.submitUpdate = function (file, options, callback, progress) {
        this._postUpload("/update/fabmo", file, {}, callback, callback, null, progress);
    };

    FabMoAPI.prototype.getCurrentUser = function (callback) {
        this._get("/authentication/user", callback, callback);
    };

    FabMoAPI.prototype.addUser = function (user_info, callback) {
        this._post("/authentication/user", user_info, callback, callback);
    };

    FabMoAPI.prototype.modifyUser = function (user_info, callback) {
        var username = user_info.user.username;

        var user = user_info;
        this._post("/authentication/user/" + username, user, callback, callback);
    };

    FabMoAPI.prototype.deleteUser = function (user_info, callback) {
        var id = user_info.user.username;
        this._del("/authentication/user/" + id, {}, callback, callback);
    };

    FabMoAPI.prototype.getUsers = function (callback) {
        this._get("/authentication/users", callback, callback);
    };

    FabMoAPI.prototype.getUpdaterStatus = function (callback) {
        this._get("/updater/status", callback, callback, "status");
    };

    FabMoAPI.prototype._url = function (path) {
        return this.base_url + "/" + path.replace(/^\//, "");
    };

    FabMoAPI.prototype._get = function (url, errback, callback, key) {
        var url = this._url(url);
        var callback = callback || function () {};
        var errback = errback || function () {};

        $.ajax({
            url: url,
            type: "GET",
            cache: false,
            dataType: "json",
            success: function (result) {
                if (result.status === "success") {
                    if (key) {
                        callback(null, result.data[key]);
                    } else {
                        callback(null, result.data);
                    }
                } else if (result.status === "fail") {
                    errback(result.data);
                } else {
                    errback(result.message);
                }
            },
            error: function (data, err) {
                errback(err);
            },
        });
    };

    FabMoAPI.prototype._postUpload = function (url, data, metadata, errback, callback, key, options) {
        //var url = this._url(url);
        var callback = callback || function () {};
        var errback = errback || function () {};
        var options = options || {};
        // The POST Upload is done in two pieces.  First is a metadata post which transmits
        // an array of json objects that describe the files in question.
        // Following the metadata is a multipart request for each uploaded file.
        // So for N files, you have N+1 requests, the first for the metadata, and then N remaining for the files themselves.
        if (!Array.isArray(data)) {
            data = [data];
        }
        var meta = {
            files: [],
            meta: metadata,
        };

        var files = [];
        data.forEach(function (item) {
            files.push(item.file);
            delete item.file;
            meta.files.push(item);
        });

        var onMetaDataUploadComplete = function (err, k) {
            if (err) {
                return errback(err);
            }
            var requests = [];
            files.forEach(
                function (file, index) {
                    var fd = new FormData();
                    fd.append("key", k);
                    fd.append("index", index);
                    if (options.compressed) {
                        //var compress_start_time = Date.now();
                        fd.append("compressed", true);
                        var pako = require("./pako.min.js");
                        var fr = new FileReader();
                        fr.readAsArrayBuffer(file);
                        fr.onload = function (evt) {
                            //var size_bf_compression = file.size;
                            file = new File([pako.deflate(fr.result)], file.name, file);
                            //var compression_time=Date.now()-compress_start_time
                            //var stats = "Size before compression : "+size_bf_compression+" after : "+file.size+" ratio : "+((file.size/size_bf_compression)*100)+"% compression time : "+compression_time+"ms";
                            fd.append("file", file);
                            //var time_before_send = Date.now();
                            var onFileUploadComplete = function (err, data) {
                                if (err) {
                                    // Bail out here too - fail on any one file upload failure
                                    requests.forEach(function (req) {
                                        req.abort();
                                    });
                                    return errback(err);
                                }
                                if (data.status === "complete") {
                                    //var transport_time = Date.now()-time_before_send;
                                    //console.log(stats+" transport time + decompression : "+transport_time+"ms total: "+(compression_time+transport_time)+"ms");
                                    if (key) {
                                        callback(null, data.data[key]);
                                    } else {
                                        callback(null, data.data);
                                    }
                                }
                            }.bind(this);
                            var request = this._post(
                                url,
                                fd,
                                onFileUploadComplete,
                                onFileUploadComplete,
                                null,
                                null,
                                true
                            );
                            requests.push(request);
                        }.bind(this);
                    } else {
                        fd.append("file", file);
                        var time_before_send = Date.now();
                        var onFileUploadComplete = function (err, data) {
                            if (err) {
                                // Bail out here too - fail on any one file upload failure
                                requests.forEach(function (req) {
                                    req.abort();
                                });
                                return errback(err);
                            }
                            if (data.status === "complete") {
                                //var transport_time = Date.now()-time_before_send;
                                //console.log("transport time : "+transport_time+"ms ");
                                if (key) {
                                    callback(null, data.data[key]);
                                } else {
                                    callback(null, data.data);
                                }
                            }
                        }.bind(this);
                        var request = this._post(url, fd, onFileUploadComplete, onFileUploadComplete, null, null, true);
                        requests.push(request);
                    }
                }.bind(this)
            );
        }.bind(this);
        this._post(url, meta, onMetaDataUploadComplete, onMetaDataUploadComplete, "key");
    };

    FabMoAPI.prototype._post = function (url, data, errback, callback, key, redirect, doProgress) {
        if (!redirect) {
            var url = this._url(url);
        }
        var callback = callback || function () {};
        var errback = errback || function () {};

        var xhr = new XMLHttpRequest();

        // fix NO-CACHE
        url += (url.indexOf("?") == -1 ? "?_=" : "& _=") + new Date().getTime();

        xhr.open("POST", url);
        if (doProgress) {
            xhr.upload.addEventListener(
                "progress",
                function (evt) {
                    this.emit("upload_progress", {
                        filename: data.get("file").name,
                        value: evt.loaded / evt.total,
                    });
                }.bind(this)
            );
        }

        if (!(data instanceof FormData)) {
            xhr.setRequestHeader("Content-Type", "application/json;");
            if (typeof data != "string") {
                data = JSON.stringify(data);
            }
        }

        xhr.onload = function () {
            switch (xhr.status) {
                case 200:
                    var response = JSON.parse(xhr.responseText);
                    switch (response.status) {
                        case "success":
                            if (key) {
                                callback(null, response.data[key]);
                            } else {
                                callback(null, response.data);
                            }
                            break;

                        case "fail":
                            if (key) {
                                errback(response.data[key]);
                            } else {
                                errback(response.data);
                            }
                            break;
                        default:
                            errback(response.message);
                            break;
                    }
                    break;

                case 300:
                    // TODO infinite loop issue here?
                    try {
                        var response = JSON.parse(xhr.responseText);
                        if (response.url) {
                            this._post(response.url, data, errback, callback, key, true);
                        } else {
                            console.error("Bad redirect in FabMo API");
                        }
                    } catch (e) {
                        console.error(e);
                    }
                    break;

                default:
                    console.error("Got a bad response from server: " + xhr.status);
                    break;
            }
        }.bind(this);
        xhr.send(data);
        return xhr;
    };

    FabMoAPI.prototype._patch = function (url, data, errback, callback, key) {
        var url = this._url(url);
        var callback = callback || function () {};
        var errback = errback || function () {};
        $.ajax({
            url: url,
            type: "PATCH",
            cache: false,
            data: data,
            success: function (result) {
                if (data.status === "success") {
                    if (key) {
                        callback(null, result.data.key);
                    } else {
                        callback(null, result.data);
                    }
                } else if (data.status === "fail") {
                    errback(result.data);
                } else {
                    errback(result.message);
                }
            },
            error: function (data, err) {
                errback(err);
            },
        });
    };

    FabMoAPI.prototype._del = function (url, data, errback, callback, key) {
        var url = this._url(url);
        var callback = callback || function () {};
        var errback = errback || function () {};
        $.ajax({
            url: url,
            type: "DELETE",
            dataType: "json",
            cache: false,
            data: data,
            success: function (result) {
                if (data.status === "success") {
                    if (key) {
                        callback(null, result.data.key);
                    } else {
                        callback(null, result.data);
                    }
                } else if (data.status === "fail") {
                    errback(result.data);
                } else {
                    errback(result.message);
                }
            },
            error: function (data, err) {
                errback(err);
            },
        });
    };

    return FabMoAPI;
});
