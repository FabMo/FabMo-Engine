/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/*
 * This is where the application context that we will expose to the "apps" will go
 * This will include the currently selected machine (if any) as well as functions to interact with the dashboard itself.
 * This is different than the context provided by context.js, which is the context for the entire dashboard, not just
 * the parts that we want the app to see.
 */
define(function (require) {
    var events = require("./events.js");
    var toastr = require("./libs/toastr.min.js");
    var context = require("./context.js");
    var modalIsShown = false;
    var Dashboard = function (target) {
        this.engine = null;
        this.router = null;
        this.machine = null;
        this.socket = null;
        this.ui = null;
        this.status = {
            job: null,
        };
        this.target = target || window;
        this.handlers = {};
        this.events = {
            status: [],
            job_start: [],
            job_end: [],
            change: [],
            disconnect: [],
            reconnect: [],
            video_frame: [],
            upload_progress: [],
        };
        this._registerHandlers();
        this._setupMessageListener();
    };

    function browse(callback) {
        var file_input = $("#hidden-file-input");
        callback = callback || function () {};

        file_input.one("click", function () {
            file_input.val(null);
            file_input.off("change");
            file_input.one("change", function (evt) {
                callback(evt);
            });
        });
        file_input.click();
    }

    Dashboard.prototype.setBusyMessage = function (message) {
        // TODO SET THE BUSY MESSAGE HERE
        console.info("App is busy loading: " + message);
    };

    Dashboard.prototype.browseForFiles = function (callback) {
        document.getElementById("hidden-file-input").multiple = true;
        browse(callback);
    };

    Dashboard.prototype.browseForFile = function (callback) {
        document.getElementById("hidden-file-input").multiple = false;
        browse(callback);
    };

    Dashboard.prototype.setEngine = function (engine) {
        this.engine = engine;
        this.engine.on(
            "status",
            function (data) {
                this.updateStatus(data);
            }.bind(this)
        );
        this.engine.on(
            "change",
            function (topic) {
                this._fireEvent("change", topic);
            }.bind(this)
        );
        this.engine.on(
            "video_frame",
            function (frame) {
                this._fireEvent("video_frame", frame);
            }.bind(this)
        );
        this.engine.on(
            "upload_progress",
            function (frame) {
                this._fireEvent("upload_progress", frame);
            }.bind(this)
        );
        this.engine.on(
            "connect",
            function () {
                this._fireEvent("reconnect", null);
            }.bind(this)
        );
        this.engine.on(
            "disconnect",
            function () {
                this._fireEvent("disconnect", null);
            }.bind(this)
        );
    };

    Dashboard.prototype.setRouter = function (router) {
        this.router = router;
    };

    // Register a handler function for the provided message type
    Dashboard.prototype._registerHandler = function (name, handler) {
        if ("message" in this.handlers) {
            throw 'Already registered a handler for the "' + name + '" message.';
        }
        this.handlers[name] = handler;
    };

    // Register a handler assuming that the message type is concurrent with a method name in the dashboard object (as is common)
    Dashboard.prototype._registerHandlerByName = function (name) {
        var proto = Object.getPrototypeOf(this);
        if (name in proto) {
            this.handlers[name] = proto[name];
        }
    };

    // The events member is a mapping of event type to sources and ids which map back to functions in the client dashboard
    Dashboard.prototype._registerEventListener = function (name, source) {
        if (name in this.events) {
            listeners = this.events[name];
            for (var i in listeners) {
                if (listeners[i] == source) {
                    return;
                }
            }
            this.events[name].push(source);
        }
    };

    Dashboard.prototype._fireEvent = function (name, data) {
        if (name in this.events) {
            listeners = this.events[name];
            for (var i in listeners) {
                var source = listeners[i];
                var msg = {
                    status: "success",
                    type: "evt",
                    id: name,
                    data: data,
                };
                try {
                    if (source) source.postMessage(msg, "*");
                } catch (e) {
                    //Fix this
                }
            }
        }
    };

    Dashboard.prototype._setupMessageListener = function () {
        this.target.addEventListener(
            "message",
            function (evt) {
                var source = evt.source;
                if ("call" in evt.data) {
                    var func = evt.data.call;
                    if (func in this.handlers) {
                        var handler = this.handlers[func];
                        var data = evt.data.data;
                        var id = evt.data.id >= 0 ? evt.data.id : -1;
                        var msg;
                        try {
                            handler(data, function (err, data, callbackId) {
                                // Use callbackId if provided, otherwise fall back to id
                                var cbid = typeof callbackId !== "undefined" ? callbackId : id;
                                var msg;
                                if (err) {
                                    msg = {
                                        status: "error",
                                        type: "cb",
                                        message: JSON.stringify(err),
                                        id: cbid,
                                    };
                                } else {
                                    msg = {
                                        status: "success",
                                        type: "cb",
                                        data: data,
                                        id: cbid,
                                    };
                                }
                                if (source) {
                                    source.postMessage(msg, evt.origin);
                                }
                            });
                        } catch (e) {
                            msg = {
                                status: "error",
                                type: "cb",
                                message: JSON.stringify(e),
                                id: id,
                            };
                            if (source) {
                                source.postMessage(JSON.stringify(msg), evt.origin);
                            }
                        }
                    }
                } else if ("on" in evt.data) {
                    var name = evt.data.on;
                    source = evt.source;
                    this._registerEventListener(name, source);
                }
            }.bind(this)
        );
    };

    Dashboard.prototype._registerHandlers = function () {
        this._registerHandler("ready", function () {
            // TODO Ready handler for apps will go here.
        });

        this._registerHandler("setBusyMessage", function (data) {
            this.setBusyMessage(data.message || "");
        });

        // Show the DRO
        this._registerHandler(
            "showDRO",
            function (data, callback) {
                this.openRightMenu();
                callback(null);
            }.bind(this)
        );

        // Hide the DRO
        this._registerHandler(
            "hideDRO",
            function () {
                this.closeRightMenu();
            }.bind(this)
        );

        //Show nav
        this._registerHandler(
            "showNav",
            function (callback) {
                this.showNav();
                callback(null);
            }.bind(this)
        );

        // Hide the nav
        this._registerHandler(
            "hideNav",
            function (callback) {
                this.hideNav();
                callback(null);
            }.bind(this)
        );

        // Show the Modal

        this._registerHandler(
            "openModal",
            function (options, callback) {
                if (options.ok) {
                    options.ok = function () {
                        callback(null, "ok");
                    };
                }
                if (options.cancel) {
                    options.cancel = function () {
                        callback(null, "cancel");
                    };
                }
                try {
                    this.showModal(options);
                } catch (e) {
                    callback(e);
                }
            }.bind(this)
        );

        this._registerHandler(
            "closeModal",
            function () {
                this.hideModal();
                callback(null);
            }.bind(this)
        );

        // Show the footer
        this._registerHandler(
            "showFooter",
            function () {
                this.openFooter();
            }.bind(this)
        );

        // Hide the footer
        this._registerHandler(
            "hideFooter",
            function () {
                this.closeFooter();
            }.bind(this)
        );

        // Show a notification
        this._registerHandler(
            "notification",
            function (data, callback) {
                this.notification(data.type, data.message);
                callback(null);
            }.bind(this)
        );

        //Submit firmware
        this._registerHandler(
            "submitFirmwareUpdate",
            function (file, options, callback, progress) {
                this.engine.submitFirmwareUpdate(file, options, callback, progress);
            }.bind(this)
        );

        //Submit update

        this._registerHandler(
            "submitUpdate",
            function (file, options, callback, progress) {
                this.engine.submitUpdate(file, options, callback, progress);
            }.bind(this)
        );

        // Submit a job
        this._registerHandler(
            "submitJob",
            function (data, callback) {
                var options = data.options || {};
                this.engine.submitJob(
                    data.jobs,
                    data.options,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(err, result);
                            if (!options.stayHere) {
                                this.launchApp("job-manager", {}, callback);
                            }
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "resubmitJob",
            function (data, callback) {
                var options = data.options || {};
                var id = data.id;
                this.engine.resubmitJob(
                    id,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(err, result);
                            if (!options.stayHere) {
                                this.launchApp("job-manager", {}, callback);
                            }
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "deleteJob",
            function (id, callback) {
                this.engine.deleteJob(
                    id,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(err, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "showUSBFileBrowser",
            function (data, callback) {
                console.log("Dashboard handler for showUSBFileBrowser called with:", data);
                var callbackId = data.callbackId;
                var options = data.options || {};
                var app = options.app || "job_manager"; // Default to job_manager if not specified

                this._ensureUSBBrowserModuleLoaded(
                    function (moduleLoaded) {
                        if (moduleLoaded && window.USBBrowser && typeof window.USBBrowser.getInstance === "function") {
                            try {
                                var browser = window.USBBrowser.getInstance();
                                console.log("Got USB Browser instance in dashboard handler");

                                browser.show(
                                    function (err, result) {
                                        console.log("USB Browser show callback in dashboard:", err, result);

                                        if (err) {
                                            callback(err, null, callbackId);
                                        } else if (result && result.filePath) {
                                            if (app === "sb4") {
                                                // Just return the file path to the app's callback
                                                callback(null, { filePath: result.filePath }, callbackId);
                                            } else {
                                                // Default: submit the job and update job_manager
                                                this.engine.submitUSBFile(
                                                    result.filePath,
                                                    options,
                                                    function (submitErr, submitResult) {
                                                        if (submitErr) {
                                                            callback(submitErr);
                                                        } else {
                                                            callback(null, submitResult);

                                                            // Notify job_manager to update queue
                                                            var jobManagerIframe = document.querySelector(
                                                                'iframe[src*="job_manager.fma"]'
                                                            );
                                                            if (jobManagerIframe) {
                                                                jobManagerIframe.contentWindow.postMessage(
                                                                    { type: "updateQueueEvent" },
                                                                    "*"
                                                                );
                                                            }
                                                        }
                                                    }
                                                );
                                            }
                                        } else {
                                            callback(null, { cancelled: true });
                                        }
                                    }.bind(this)
                                );
                            } catch (e) {
                                console.error("Error showing USB browser from dashboard:", e);
                                this._showFallbackBrowser(options, callback);
                            }
                        } else {
                            console.log("USB Browser module not available in dashboard, using fallback");
                            //this._showFallbackBrowser(options, callback);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        /* Helper method to ensure the USB Browser module is loaded
         * Tries to load it if not already available
         */
        Dashboard.prototype._ensureUSBBrowserModuleLoaded = function (callback) {
            // If already loaded, return immediately
            if (window.USBBrowser && typeof window.USBBrowser.getInstance === "function") {
                console.log("USB Browser module already loaded");
                callback(true);
                return;
            }

            console.log("USB Browser module not loaded, attempting to load it");

            // Try to load the module
            var script = document.createElement("script");
            script.src = "/js/libs/usb-browser.js";

            // Set timeout for loading
            var loadTimeout = setTimeout(function () {
                console.error("Timeout loading USB Browser module");
                callback(false);
            }, 3000);

            script.onload = function () {
                clearTimeout(loadTimeout);
                console.log("USB Browser module loaded successfully");

                // Give it a moment to initialize
                setTimeout(function () {
                    if (typeof USBBrowser !== "undefined") {
                        window.USBBrowser = USBBrowser;
                        console.log("USBBrowser attached to window object");
                        callback(true);
                    } else {
                        console.error("USBBrowser not defined after script load");
                        callback(false);
                    }
                }, 100);
            };

            script.onerror = function () {
                clearTimeout(loadTimeout);
                console.error("Failed to load USB Browser module");
                callback(false);
            };

            document.head.appendChild(script);
        };

        // For use in non-Job Manager apps
        this._registerHandler(
            "submitUSBFile",
            function (data, callback) {
                // data.path is the USB file path, data.options is options object
                if (!data || !data.path) {
                    callback(new Error("No file path provided for submitUSBFile"));
                    return;
                }
                this.engine.submitUSBFile(data.path, data.options || {}, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, result);
                    }
                });
            }.bind(this)
        );

        // Get the list of jobs in the queue
        this._registerHandler(
            "getJobsInQueue",
            function (data, callback) {
                this.engine.getJobsInQueue(function (err, jobs) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, jobs);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "getJobHistory",
            function (options, callback) {
                this.engine.getJobHistory(options || {}, function (err, jobs) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, jobs);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "updateOrder",
            function (data, callback) {
                this.engine.updateOrder(data, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, result);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "getJobInfo",
            function (id, callback) {
                this.engine.getJobInfo(id, function (err, job) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, job);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "clearJobQueue",
            function (data, callback) {
                this.engine.clearJobQueue(function (err) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "runNext",
            function (data, callback) {
                this.engine.runNextJob(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "pause",
            function (data, callback) {
                this.engine.pause(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "stop",
            function (data, callback) {
                this.engine.quit(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "resume",
            function (data, callback) {
                this.engine.resume(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualNudge",
            function (data, callback) {
                this.engine.manualNudge(data.dir, data.dist, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualStart",
            function (data, callback) {
                this.engine.manualStart(
                    data.axis,
                    data.speed,
                    data.second_axis,
                    data.second_speed,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null);
                        }
                    }
                );
            }.bind(this)
        );

        this._registerHandler(
            "manualEnter",
            function (data, callback) {
                this.engine.manualEnter({ mode: data["mode"], hideKeypad: data["hideKeypad"] }, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualRunGCode",
            function (data, callback) {
                this.engine.manualRunGCode(data.code, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualExit",
            function (data, callback) {
                this.engine.manualExit(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualHeartbeat",
            function (data, callback) {
                this.engine.manualHeartbeat(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "manualStop",
            function (data, callback) {
                this.engine.manualStop(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "zero",
            function (text, callback) {
                this.engine.zero(text, function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null);
                    }
                });
            }.bind(this)
        );

        this._registerHandler(
            "getApps",
            function (data, callback) {
                this.engine.getApps(function (err, result) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, result);
                    }
                });
            }.bind(this)
        );

        // Submit an app
        this._registerHandler(
            "submitApp",
            function (data, callback) {
                this.submitApps(data.apps, {}, callback);
            }.bind(this)
        );

        this._registerHandler(
            "deleteApp",
            function (id, callback) {
                this.engine.deleteApp(
                    id,
                    function (err, result) {
                        this.refreshApps();
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "runGCode",
            function (text, callback) {
                this.engine.gcode(
                    text,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "runSBP",
            function (text, callback) {
                this.engine.sbp(
                    text,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getUpdaterConfig",
            function (data, callback) {
                this.engine.getUpdaterConfig(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "setUpdatertConfig",
            function (data, callback) {
                this.engine.setUpdaterConfig(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getConfig",
            function (data, callback) {
                this.engine.getConfig(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "setConfig",
            function (data, callback) {
                this.engine.setConfig(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        ///
        /// NETWORK MANAGEMENT
        ///
        this._registerHandler(
            "connectToWifi",
            function (data, callback) {
                this.engine.connectToWifi(
                    data.ssid,
                    data.key,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "disconnectFromWifi",
            function (data, callback) {
                this.engine.disconnectFromWifi(
                    data.ssid,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        // this._registerHandler(
        //     "forgetWifi",
        //     function (data, callback) {
        //         this.engine.forgetWifi(
        //             data.ssid,
        //             function (err, result) {
        //                 if (err) {
        //                     callback(err);
        //                 } else {
        //                     callback(null, result);
        //                 }
        //             }.bind(this)
        //         );
        //     }.bind(this)
        // );

        this._registerHandler(
            "enableWifi",
            function (data, callback) {
                this.engine.enableWifi(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "disableWifi",
            function (data, callback) {
                this.engine.disableWifi(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "enableWifiHotspot",
            function (data, callback) {
                this.engine.enableHotspot(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "disableWifiHotspot",
            function (data, callback) {
                this.engine.disableHotspot(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getWifiNetworks",
            function (data, callback) {
                this.engine.getWifiNetworks(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getWifiNetworkHistory",
            function (data, callback) {
                this.engine.getWifiNetworkHistory(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "isWifiOn",
            function (data, callback) {
                this.engine.isWifiOn(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getNetworkIdentity",
            function (data, callback) {
                this.getNetworkIdentity(function (err, result) {
                    callback(err, result);
                });
            }.bind(this)
        );

        this._registerHandler(
            "isOnline",
            function (data, callback) {
                this.engine.isOnline(function (err, result) {
                    callback(err, result);
                });
            }.bind(this)
        );

        this._registerHandler(
            "setNetworkIdentity",
            function (data, callback) {
                this.engine.setNetworkIdentity(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        ///
        /// MACROS
        ///
        this._registerHandler(
            "getMacros",
            function (data, callback) {
                this.engine.getMacros(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "runMacro",
            function (data, callback) {
                this.engine.runMacro(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "updateMacro",
            function (data, callback) {
                this.engine.updateMacro(
                    data.id,
                    data.macro,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "deleteMacro",
            function (data, callback) {
                this.engine.deleteMacro(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        ///
        /// USER MANAGEMENT
        ///

        this._registerHandler(
            "getCurrentUser",
            function (data, callback) {
                this.engine.getCurrentUser(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );
        this._registerHandler(
            "addUser",
            function (data, callback) {
                this.engine.addUser(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );
        this._registerHandler(
            "modifyUser",
            function (data, callback) {
                this.engine.modifyUser(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );
        this._registerHandler(
            "deleteUser",
            function (data, callback) {
                this.engine.deleteUser(
                    data,
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );
        this._registerHandler(
            "getUsers",
            function (data, callback) {
                this.engine.getUsers(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "getUpdaterStatus",
            function (data, callback) {
                this.engine.getUpdaterStatus(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "startVideoStreaming",
            function (data, callback) {
                this.engine.startVideoStreaming(
                    function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            callback(null, result);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        ///
        /// DASHBOARD (APP MANAGEMENT)
        ///
        this._registerHandler(
            "launchApp",
            function (data, callback) {
                id = data.id;
                args = data.args || {};
                this.launchApp(id, args, callback);
            }.bind(this)
        );

        this._registerHandler(
            "getAppArgs",
            function (data, callback) {
                callback(null, context.current_app_args || {});
            }.bind(this)
        );

        this._registerHandler(
            "getAppInfo",
            function (data, callback) {
                callback(null, context.current_app_info || {});
            }.bind(this)
        );

        this._registerHandler(
            "getAppConfig",
            function (data, callback) {
                this.engine.getAppConfig(context.current_app_id, callback);
            }.bind(this)
        );

        this._registerHandler(
            "setAppConfig",
            function (data, callback) {
                this.engine.setAppConfig(context.current_app_id, data, callback);
            }.bind(this)
        );

        this._registerHandler(
            "getVersion",
            function (data, callback) {
                this.engine.getVersion(callback);
            }.bind(this)
        );

        ////## added to support retrieval of firmware ver for config manager page 1/2/21
        this._registerHandler(
            "getInfo",
            function (data, callback) {
                this.engine.getInfo(callback);
            }.bind(this)
        );

        this._registerHandler(
            "requestStatus",
            function (data, callback) {
                this.engine.getStatus(
                    function (err, status) {
                        if (err) {
                            callback(err);
                        } else {
                            this.updateStatus(status);
                            callback(null, status);
                        }
                    }.bind(this)
                );
            }.bind(this)
        );

        this._registerHandler(
            "navigate",
            function (data, callback) {
                if (data.url) {
                    var pat = /^((https?:\/\/)|\/)/i;
                    if (pat.test(data.url)) {
                        window.open(data.url, data.options.target || "_self");
                    } else {
                        window.open(data.path + data.url, data.options.target || "_self");
                    }
                } else {
                    callback(new Error("No URL specified"));
                }
            }.bind(this)
        );

        this._registerHandler(
            "notify",
            function (data, callback) {
                if (data.message) {
                    this.notification(data.type || "info", data.message);
                    callback(null);
                } else {
                    callback(new Error("Must provide a message to notify."));
                }
            }.bind(this)
        );
    };

    Dashboard.prototype.getNetworkIdentity = function (callback) {
        callback = callback || function () {};
        this.engine.getNetworkIdentity(
            function (err, result) {
                if (err) {
                    callback(err);
                } else {
                    var name = result.name || "";
                    name = "TOOL:  " + name;
                    $("#tool-name").text(name);
                    document.title = name || "FabMo Dashboard";
                    callback(null, result);
                }
            }.bind(this)
        );
    };

    Dashboard.prototype.updateStatus = function (status) {
        if (this.status.job && !status.job) {
            this._fireEvent("job_end", null);
        }

        if (!this.status.job && status.job) {
            this._fireEvent("job_start", null);
        }
        this.status = status;
        this._fireEvent("status", status);
    };

    // Brings up the DRO (if separate from the keypad) in the dashboard
    Dashboard.prototype.DRO = function (callback) {
        this.notification("info", 'Move the tool if necessary, then hit "Enter');
        this.openRightMenu(); //Open the menu to let the user control the tool

        //Waiting keydown on "enter" key, before calling callback.
        var key = $(document).keydown(function (e) {
            if (e.which == 13) {
                if (typeof callback === "function") callback(key);
            }
        });
        return;
    };

    //Open the right menu
    Dashboard.prototype.openRightMenu = function () {
        if ($(window).width() < 900) {
            events.openDROover();
        } else {
            events.openDROPush();
        }
    };

    //Close the right menu
    Dashboard.prototype.closeRightMenu = function () {
        if ($(window).width() < 900) {
            events.closeDROover();
        } else {
            events.closeDROPush();
        }
    };

    Dashboard.prototype.showNav = function (callback) {
        var nav = document.getElementsByClassName("tab-bar")[0];
        var DRO = document.getElementById("right-menu");
        var leftMenu = document.getElementById("left-menu");
        var main = document.getElementById("main");
        DRO.style.marginTop = "45px";
        nav.style.display = "block";
        leftMenu.style.top = "56px";
        main.style.paddingTop = "3.5rem";
        events.resizedoc();
    };

    Dashboard.prototype.hideNav = function (callback) {
        var nav = document.getElementsByClassName("tab-bar")[0];
        var DRO = document.getElementById("right-menu");
        var leftMenu = document.getElementById("left-menu");
        var main = document.getElementById("main");
        //var height = document
        nav.style.display = "none";
        DRO.style.marginTop = "0px";
        leftMenu.style.top = "0px";
        leftMenu.style.height = "auto";
        main.style.paddingTop = 0;
        events.resizedoc();
    };

    //Open Footer
    Dashboard.prototype.openFooter = function () {
        $(".footBar").css("height", "175px");
        //Set size of app container (so footer does not hide content)
        $(".main-section").css("padding-bottom", "175px");
    };

    //Close Footer
    Dashboard.prototype.closeFooter = function () {
        $(".footBar").css("height", "0px");
        $(".main-section").css("padding-bottom", "0px");
    };

    //Show Modal
    Dashboard.prototype.showModal = function (options) {
        console.log("showModal called with options:", options); // Log the options object

        modalIsShown = true;

        $(".modalDim").show();
        $(".newModal").show();
        $(".modalLogo").show();
        if (options["title"]) {
            $(".modalTitle").html(options.title).show();
        } else {
            $(".modalTitle").hide();
        }

        if (options["input"]) {
            $(".modalDialogue").html(options.input).show();
        } else {
            $(".modalDialogue").html(options.input).hide();
            $(".modalDialogue").hide();
        }

        if (options["message"]) {
            $(".modalDialogue").html(options.message).show();
        } else {
            $(".modalDialogue").hide();
        }

        if (options["detail"]) {
            $(".modalDetail").html(options.detail).show();
        } else {
            $(".modalDetail").hide();
        }

        if (options["image"]) {
            $(".modalImage img").attr("src", options.image);
            $(".modalImage").show();
            $(".modalImage").css("width", "25%");
            $(".modalDialogue").css("width", "65%");
        } else {
            $(".modalImage").hide();
            $(".modalImage").css("width", "0%");
            $(".modalDialogue").css("width", "100%");
        }

        // Set up the variable input field, if provided, as a Yes-No option or as a normal input
        // ... first determine if we have a special YES_NO input case and what kind (this is to test Brian's pref for 0/1)
        let selectedValue = null; // Variable to store the selected YES_NO value    ** DETECTION Y-N HERE! ***
        let inputPresent = false;
        let inputType = "text";
        if (options.input && options.input.name) {
            let ckInput = typeof options.input.name === "string" ? options.input.name.toUpperCase() : "";
            if (ckInput === "LAST_YN") {
                inputPresent = true;
                inputType = "text";
            } else if (ckInput == "YN") {
                inputPresent = true;
                inputType = "numeric";
            }
        }

        // Special input case for Yes-No option triggered by user_variable "&LAST_YN". But possibly using &YN trigger for numeric value
        //         if (options.input && options.input.name && options.input.name.toUpperCase() === "LAST_YN") {
        if (inputPresent) {
            console.log("Detected YN input:", options.input); // Log detection of user_variable
            selectedValue = "";
            $(".modalInput").hide();
            $(".modalButtons").html(`
                <div class="yes-no-buttons" style="margin-bottom: 10px;">
                    <div class="modalYes" style="display: inline-block; margin-right: 10px; cursor: pointer; border: 1px solid lightgray; padding: 5px;"><span>Yes</span></div>
                    <div class="modalNo" style="display: inline-block; cursor: pointer; border: 1px solid lightgray; padding: 5px;"><span>No</span></div>
                </div>
                <div class="ok-cancel-buttons">
                    <div class="ok-cancel-buttons" style="display: inline-block; margin-right: 10px;">
                    <div class="modalCancel" style="display: inline-block"><span>Cancel</span></div>
                    <div class="modalOkay" style="display: inline-block"><span>Okay</span></div>
                </div>
            `);

            //set the "ok-button" to disabled; leave the Cancel button enabled
            $(".modalOkay").css("pointer-events", "none");
            $(".modalOkay").css("opacity", "0.5");

            $(".modalYes")
                .off("click")
                .on("click", function () {
                    if (inputType === "numeric") {
                        selectedValue = 1;
                    } else {
                        selectedValue = "YES";
                    }
                    $(".modalYes").css("font-weight", "bold");
                    $(".modalYes").css("color", "white");
                    $(".modalYes").css("background-color", "#5Daa35");
                    $(".modalNo").css("font-weight", "normal");
                    $(".modalNo").css("color", "black");
                    $(".modalNo").css("background-color", "transparent");
                    $(".modalOkay").css("pointer-events", "all");
                    $(".modalOkay").css("opacity", "1.0");
                });

            $(".modalNo")
                .off("click")
                .on("click", function () {
                    if (inputType === "numeric") {
                        selectedValue = 0;
                    } else {
                        selectedValue = "NO";
                    }
                    $(".modalNo").css("font-weight", "bold");
                    $(".modalNo").css("color", "white");
                    $(".modalNo").css("background-color", "#5Daa35");
                    $(".modalYes").css("font-weight", "normal");
                    $(".modalYes").css("background-color", "transparent");
                    $(".modalYes").css("color", "black");
                    $(".modalOkay").css("pointer-events", "all");
                    $(".modalOkay").css("opacity", "1.0");
                });

            // Normal input case
        } else if (options["input"]) {
            console.log("Detected normal input:", options.input); // Log detection of normal input
            $("#inputVar").val(options["input"]["name"]);
            $("#inputType").val(options["input"]["type"]);
            $("#inputVal").val("");
            $(".modalInput").show();
            $("#inputVal").trigger("focus");
            $(".modalOkay").css("pointer-events", "none");
            $(".modalOkay").css("opacity", "0.5");
        } else {
            console.log("No input detected, hiding modal input."); // Log case where no input is detected
            $("#inputVal").val("");
            $(".modalInput").hide();
            $(".modalOkay").css("pointer-events", "all");
            $(".modalOkay").css("opacity", "1.0");
        }

        // Handle OK button
        if (options.ok && options.okText) {
            $(".modalOkay").show();
            $(".modalOkay").text(options.okText);
            //            $(".modalOkay").css("pointer-events", "none");
            //            $(".modalOkay").css("opacity", "0.5");
            $("#inputVal").on("input", function () {
                $(".modalOkay").css("pointer-events", "all");
                $(".modalOkay").css("opacity", "1.0");
            });
            $(".modalOkay")
                .off("click")
                .on("click", function () {
                    if (options.input?.name && options.input.type && selectedValue) {
                        options.ok(selectedValue); // Pass the selected YES_NO value OR variable value to the OK callback
                    } else {
                        // option needs to pick up the value of the input box
                        let inputValue = $("#inputVal").val(); // Get the value from the input box
                        if (inputValue === undefined || inputValue === null || inputValue.trim() === "") {
                            inputValue = "";
                        }
                        options.ok(inputValue); // Pass a normal input value to the OK callback
                    }
                    $("#inputVal").val("");
                    $(".newModal").hide();
                    $(".modalDim").hide();
                    $(".yes-no-buttons").remove(); // Clean up the yes-no buttons if they were used
                    $(".modalYes").remove(); // Clean up the yes-no buttons if they were used
                    $(".modalNo").remove(); // Clean up the yes-no buttons if they were used
                });
        } else {
            $(".modalOkay").hide();
        }

        // Handle Cancel button
        if (options.cancel && options.cancelText) {
            $(".modalCancel").show();
            $(".modalCancel").text(options.cancelText);
            $(".modalCancel")
                .off("click")
                .on("click", function () {
                    options.cancel();
                    $("#inputVal").val("");
                    $(".newModal").hide();
                    $(".modalDim").hide();
                    $(".yes-no-buttons").remove(); // Clean up the yes-no buttons if they were used
                    $(".modalYes").remove(); // Clean up the yes-no buttons if they were used
                    $(".modalNo").remove(); // Clean up the yes-no buttons if they were used
                });
        } else {
            $(".modalCancel").hide();
        }

        // In the case of both buttons missing, provide a quit to prevent a jam
        if (!options["okText"] && !options["cancelText"]) {
            $(".modalOkay").off();
            $(".modalOkay").show();
            $(".modalOkay").text("Quit");
            $(".modalOkay").on("click", function () {
                options.cancel(); // Use options.cancel() here
                $(".newModal").hide();
                $(".modalDim").hide();
                $(".yes-no-buttons").remove(); // Clean up the yes-no buttons if they were used
                $(".modalYes").remove(); // Clean up the yes-no buttons if they were used
                $(".modalNo").remove(); // Clean up the yes-no buttons if they were used
            });
        }

        if (options["noButton"] === true) {
            $(".modalCancel").hide();
            $(".modalOkay").hide();
        }

        if (options["noLogo"] === true) {
            $(".modalLogo").hide();
        }
    };

    //Hide Modal
    Dashboard.prototype.hideModal = function () {
        $(".modalDim").hide();
        $(".newModal").hide();
        $(".modalOkay").off();
        $(".modalCancel").off();
    };

    // Open and close the right menu
    Dashboard.prototype.bindRightMenu = function (mouv) {
        if ($("#main").hasClass("offcanvas-overlap-left")) {
            if (mouv) {
                this.closeRightMenu();
            } else {
                this.ui.setMenuClosed();
            }
        } else {
            if (mouv) {
                this.openRightMenu();
            } else {
                this.ui.setMenuOpen();
            }
        }
    };

    Dashboard.prototype.notification = function (type, message) {
        switch (type) {
            case "info":
                toastr.info(message);
                break;
            case "success":
                toastr.success(message);
                break;
            case "warning":
                toastr.warning(message);
                break;
            case "error":
                toastr.error(message);
                break;
            default:
                console.error("Unknown type of notification: " + type);
                break;
        }
    };

    Dashboard.prototype.launchApp = function (id, args, callback) {
        this.router.launchApp(id, args, callback);
    };

    Dashboard.prototype.refreshApps = function () {
        context.apps.fetch();
    };

    Dashboard.prototype.submitApps = function (data, options, callback) {
        this.engine.submitApp(
            data,
            data.options,
            function (err, result) {
                context.apps.fetch();

                if (err) {
                    callback(err);
                } else {
                    result.forEach(function (item) {
                        context.markAppForRefresh(item.info.id);
                    });
                    callback(null, result);
                }
            }.bind(this)
        );
    };

    // The dashboard is a singleton which we create here and make available as this module's export.
    var dashboard = new Dashboard();
    return dashboard;
});
