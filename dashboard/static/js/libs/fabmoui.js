/* eslint-disable no-redeclare */
/* eslint-disable no-unused-vars */

const { last } = require("underscore");

/* eslint-disable no-undef */
(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd) define(factory);
    /* Browser global */ else root.FabMoUI = factory();
})(this, function () {
    "use strict";

    var MAX_INPUTS = 12;
    var MAX_OUTPUTS = 12;
    var currentUnits = null;
    var inProbeOn = false;
    var mouseX;
    var mouseY;
    $(document).on("mousemove touchmove", function (e) {
        mouseX = e.pageX;
        mouseY = e.pageY;
    });

    function FabMoUI(tool, options) {
        this.progress = 0;

        this.event_handlers = {
            error: [],
            message: [],
            status: [],
            disconnect: [],
            reconnect: [],
        };
        this.tool = tool;
        // the tool we need to check for

        this.prefix = "";
        // useful if several tools in the same app.

        this.refresh = 125;
        // define the status refresh time.

        this.keypad = true;
        // able or disable the keypad.

        //1 step of keypad, in inches

        this.file_control = true;

        //display move speed from slider
        $("#manual-move-speed").on("mouseenter", function (e) {
            $(".speed_read_out").show();
            $(".speed_read_out").html($("#manual-move-speed").val());
        });
        $("#manual-move-speed").on("input", function (e) {
            $(".speed_read_out").html($("#manual-move-speed").val());
        });
        $("#manual-move-speed").on("mouseleave", function (e) {
            $(".speed_read_out").hide();
            $(this).blur();
        });

        $("#right-position-container").on("click", function () {
            if (!$("#right-position-container").hasClass("dropped")) {
                $(".dro-dropdown").removeClass("dropped");
                setTimeout(function () {
                    $("#right-position-container").removeClass("dropped");
                }, 200);
                $("#icon_DROin-out").attr("src", "../img/icon_DROout.png");
                $("#dro-tab").attr("title", "Click to open larger Info Display");
            } else {
                $(".dro-dropdown").addClass("dropped");
                $("#right-position-container").addClass("dropped");
                $("#icon_DROin-out").attr("src", "../img/icon_DROin.png");
                $("#dro-tab").attr("title", "Click to close large Display");
            }
        });

        if (options) {
            this.prefix = options.prefix ? options.prefix + "-" : "";
            this.refresh = options.refresh || 100;
            this.keypad = options.keypad === false ? false : true;
            this.file_control = options.file_control === false ? false : true;
        }

        this.status_div_selector = ".fabmo-" + this.prefix + "status";
        this.keypad_div_selector = ".fabmo-" + this.prefix + "keypad";
        this.file_control_selector = ".fabmo-" + this.prefix + "file-control";

        this.posX_selector = this.status_div_selector + " .posx";
        this.posY_selector = this.status_div_selector + " .posy";
        this.posZ_selector = this.status_div_selector + " .posz";
        this.posA_selector = this.status_div_selector + " .posa";
        this.posB_selector = this.status_div_selector + " .posb";
        this.posC_selector = this.status_div_selector + " .posc";

        this.state_selector = this.status_div_selector + " .state";
        this.file_info_div_selector = this.status_div_selector + " .file-info";
        this.filename_selector = this.file_info_div_selector + " .filename";
        this.progress_selector = this.file_info_div_selector + " .progress";

        this.manual_controls_selector = ".fabmo-manual-control";

        this.stop_button_selector = this.file_control_selector + " .stopJob";
        this.resume_button_selector = this.file_control_selector + " .resumeJob";
        this.pause_button_selector = this.file_control_selector + " .pauseJob-wrapper";

        this.units_selector = ".units";

        if (this.keypad) {
            this.my_keypad = this.Keypad;
            //		this.Keypad();
        }

        if (this.file_control) {
            this.my_file_control = this.FileControl;
            this.FileControl();
        }

        this.tool.on(
            "status",
            function (status_report) {
                this.updateStatusContent(status_report);
            }.bind(this)
        );

        // Update status every sec to cover potential missed updates and config changes
        setInterval(
            function () {
                // if not already running and updating status
                if (this.tool.status.state !== "running") {
                    this.updateStatus();
                }
            }.bind(this),
            1000
            //this.refresh
        );
    }

    FabMoUI.prototype.on = function (evt, handler) {
        if (evt in this.event_handlers) {
            this.event_handlers[evt].push(handler);
        }
        if (evt === "error") {
            if (this.tool.status.state === "stopped") {
                if (this.tool.status.info.error) {
                    handler(this.tool.status.info.error);
                }
            }
        }
    };

    FabMoUI.prototype.emit = function (type, evt) {
        if (type in this.event_handlers) {
            for (var i in this.event_handlers[type]) {
                var handler = this.event_handlers[type][i];
                handler(evt);
            }
        }
    };

    FabMoUI.prototype.lock = function () {
        this.right = false;
        this.left = false;
        this.up = false;
        this.down = false;
        this.page_up = false;
        this.page_down = false;
    };

    FabMoUI.prototype.setMenuOpen = function () {
        this.menu_open = true;
    };

    FabMoUI.prototype.setMenuClosed = function () {
        this.menu_open = false;
    };

    FabMoUI.prototype.allowKeypad = function () {
        this.keypad_allow = true;
        $(this.keypad_div_selector).show();
        $("#keypad").addClass("hidden");
    };

    FabMoUI.prototype.forbidKeypad = function () {
        this.keypad_allow = false;
        $(this.keypad_div_selector).hide();
        $("#keypad").removeClass("hidden");
    };

    FabMoUI.prototype.statusKeypad = function () {
        return this.keypad_allow;
    };

    FabMoUI.prototype.updateText = function (control, txt) {
        var t = control.text();
        var v = control.val();
        if (t != txt) {
            control.text(txt);
        }
        if (v != txt) {
            control.val(txt);
        }
    };

    FabMoUI.prototype.updateStatusContent = function (status) {
        var that = this;
        var prev_state = that.tool.state;
        that.tool.state = status.state;
        if (prev_state !== status.state) {
            if (status.state === "stopped") {
                if (status.info) {
                    if (status.info.error) {
                        this.emit("error", status.info.error);
                    }
                }
            } else if (status.state === "paused") {
                if (status.info) {
                    if (status.info.message) {
                        this.emit("message", status.info.message);
                    }
                }
            }
        }

        var unit = status.unit || "??";
        var digits = 3;
        $("#manual-move-speed").attr("step", 0.1);
        if (unit === "mm") {
            digits = 2;
            $("#manual-move-speed").attr("step", 1);
        }

        if (unit !== currentUnits) {
            currentUnits = unit;
            that.updateText($(that.units_selector), unit);
        }

        // Set the degree symbol in the main app for ABC
        if (this.tool.config.driver.aam === 1) {
            $(".a-rotunits").html("o&nbsp");
        } else {
            $(".a-rotunits").html("&nbsp");
        }
        if (this.tool.config.driver.bam === 1) {
            $(".b-rotunits").html("o&nbsp");
        } else {
            $(".b-rotunits").html("&nbsp");
        }
        if (this.tool.config.driver.cam === 1) {
            $(".c-rotunits").html("o&nbsp");
        } else {
            $(".c-rotunits").html("&nbsp");
        }

        // What follows is a bit of a kludge to make sure key display items keep updated
        // Keypad DRO display stuff
        ["x", "y", "z", "a", "b", "c"].forEach(function (axis) {
            var pos = "pos" + axis;
            if (pos in status) {
                if (axis === "b") {
                    $(".x_pos.y_pos").hide();
                    $(".b_pos").show();
                    $(".x_pos.y_neg").hide();
                    $(".b_neg").show();
                } else if (axis === "a") {
                    $(".x_neg.y_pos").hide();
                    $(".a_pos").show();
                    $(".x_neg.y_neg").hide();
                    $(".a_neg").show();
                } else {
                    $(".x_neg.y_pos").show();
                    $(".x_neg.y_neg").show();
                    $(".x_pos.y_pos").show();
                    $(".a_pos").hide();
                    $(".b_pos").hide();
                    $(".x_pos.y_neg").show();
                    $(".b_neg").hide();
                    $(".a_neg").hide();
                }
                $("." + axis + "axis").show();
                try {
                    var posText = ""; // fix the z display jumping from "-"'s
                    if (axis === "z" && status[pos] >= 0) {
                        posText = " ";
                    }
                    posText = posText + status[pos].toFixed(digits); // <================ LOCATION DISPLAY
                } catch (e) {
                    var posText = (pos + "." + pos + pos + pos).toUpperCase();
                }
                that.updateText($("." + pos), posText);
            } else {
                $("." + axis + "axis").hide();
            }
        });

        // Update big DRO Speed Display (Feedrate and Override)
        if (status.state != "idle") {
            const feedrate = Number(status.feed) * Number(status.fro);
            $("#fr-inp").css("color", "#42e6f5");
            if (status.unit === "mm") {
                $(".feedrate-unit").text("mm/sec");
                const displayValue = (feedrate / 60).toFixed(2);
                $("#fr-inp").val(displayValue);
            } else {
                $(".feedrate-unit").text("in/sec");
                const displayValue = (feedrate / 1524).toFixed(2);
                $("#fr-inp").val(displayValue);
            }
        } else {
            var speed = 0;
            $("#fr-inp").css("color", "black");
            speed = this.tool.config.opensbp["movexy_speed"].toFixed(2);
            if (status.unit === "mm") {
                $(".feedrate-unit").text("mm/sec");
                $("#fr-inp").val(speed);
            } else {
                $(".feedrate-unit").text("in/sec");
                $("#fr-inp").val(speed);
            }
        }

        var cur_req_fro = 100;
        // Feed rate override color displays
        if (status.state === "idle") {
            $("#override").removeClass("blinking-text");
            $("#override").val(100);
            cur_req_fro = 100;
            $("#override").css("color", "gray");
        } else {
            var cur_fro = (status.fro * 100).toFixed(0);
            cur_req_fro = $("#override").val();
            /* do the blink */
            if (cur_req_fro == cur_fro) {
                $("#override").removeClass("blinking-text");
            } else {
                $("#override").addClass("blinking-text");
            }
            /* do the color */
            if (cur_req_fro > 100) {
                $("#override").css("color", "yellow");
                $("#fr-inp").css("color", "yellow");
            } else if (cur_req_fro < 100) {
                $("#override").css("color", "blue");
                $("#fr-inp").css("color", "blue");
            } else {
                $("#override").css("color", "gray");
            }
        }

        // Update Spindle Speed Display from status
        // ... first making sure this field will handle string or number
        function updateSpindleSpeed(value) {
            const inputField = $(".spindle-speed input");
            if (typeof value === "string") {
                inputField.attr("type", "text");
                inputField.val(value);
            } else if (typeof value === "number") {
                inputField.attr("type", "number");
                inputField.val(value);
            }
        }
        if (status.spindle && status.spindle.vfdEnabled) {
            const spindleSpeedInput = $(".spindle-speed input");
            if (!spindleSpeedInput.is(":focus")) {
                if (status.spindle.vfdAchvFreq !== 0) {
                    $(".spindle-speed input").css("color", "#42e6f5");
                    $(".spindle-power input").css("color", "black");
                    updateSpindleSpeed(status.spindle.vfdAchvFreq);
                } else {
                    $(".spindle-speed input").css("color", "gray");
                    $(".spindle-power input").css("color", "gray");
                    if (status.spindle.vfdDesgFreq < 0) {
                        updateSpindleSpeed("- disabled -  ");
                    } else {
                        updateSpindleSpeed(status.spindle.vfdDesgFreq);
                    }
                }
                var pwrDraw = status.spindle.vfdAmps;
                var formattedDraw = (pwrDraw * 0.01).toFixed(2);
                if (status.spindle.vfdAmps !== 0) {
                    $(".spindle-power input").css("color", "black");
                }
                $(".spindle-power input").val(formattedDraw);
                $("#dro-addon-3").css("visibility", "visible");
            }
        } else {
            updateSpindleSpeed("- No VFD/USB -  ");
            $(".spindle-speed input").css("color", "gray");
            $(".spindle-power input").css("color", "gray");
            // hide display when no VFD
            $("#dro-addon-3").css("visibility", "hidden");
        }

        //Current File or job
        if (status.job) {
            var time_in_ms = status.server_ts - status.job.started_at;
            var time_elapsed_ms = time_in_ms % 1000;
            var time_in_s = Math.floor(time_in_ms / 1000);
            var time_elapsed_s = time_in_s % 60;
            var time_in_m = Math.floor(time_in_s / 60);
            var time_elapsed_m = time_in_m % 60;
            var time_in_h = Math.floor(time_in_m / 60);
            var time_elapsed_h = time_in_h;
            var time_elapsed_text =
                (time_elapsed_h ? time_elapsed_h + "h " : "") +
                (time_elapsed_m ? time_elapsed_m + "m " : "") +
                (time_elapsed_s ? time_elapsed_s + "s" : "");

            $(".startNextContainer").hide();
            $(that.file_info_div_selector).removeClass("hide");
            $(".currentJobTitle").text(status.job.name);
            $(that.filename_selector).html(status.job.name);
            var transform_styles = ["-webkit-transform", "-ms-transform", "transform"];
            var prog = ((status.line / status.nb_lines) * 100).toFixed(2);
            if (prog > 100) {
                prog = 100;
            }
            if (isNaN(prog)) {
                prog = 0;
            }
            var percent = Math.round(prog);

            // Enforce monotonicity of progress
            if (percent <= this.progress) {
                percent = this.progress;
            }
            this.progress = percent;

            //Status.line does not show the line being ran, it is off by 19 lines for some reason
            var comped_line = status.line - 19;

            //If the comp makes line go below zero, say its 0
            if (comped_line <= 0) {
                comped_line = 0;
            }

            $(".radial_progress").hide();
            $(".load_container").show();
            $(".percent_comp").text(percent + "%");
            $(".horizontal_fill").css("width", percent + "%");
            $(".elapsed_time_text").text(time_elapsed_text);
            $(".line_number_text").text(comped_line);
            $(that.progress_selector).css("width", prog.toString() + "%");
        } else {
            $(that.file_info_div_selector).addClass("hide");
            $(".load_container").hide();
            $("#loadbar").hide();
            $(".radial_progress").hide();
            $(that.filename_selector).empty();
            $(that.progress_selector).empty();
            $(".currentJobTitle").text("");
            $(".horizontal_fill").css("width", "0%");
            this.progress = 0;
        }

        // Update inputs and set the small DRO display depending on input definitions
        let stopIsOn = false; // ... at least one is already on
        let intIsOn = false;
        let limitIsOn = false;
        for (var i = 1; i < MAX_INPUTS + 1; i++) {
            let iname = "in" + i;
            if (iname in status) {
                let idisp = "off";
                let selector = that.status_div_selector + " .in" + i;
                let ival = status[iname];
                // get the assigned action for this input from the machine config
                // ... sometimes we are hitting this at startup before the machine config is loaded
                // ... not sure why ... could be a problem area
                let assignedAction = "none";
                if (
                    this.tool.config.machine !== undefined &&
                    this.tool.config.machine["di" + i + "ac"] !== undefined &&
                    typeof that.tool.config.machine["di" + i + "ac"] === "string"
                ) {
                    assignedAction = that.tool.config.machine["di" + i + "ac"];
                }
                if (ival) {
                    // input is ON
                    idisp = "on";
                    if (assignedAction === "stop" || assignedAction === "faststop") {
                        idisp = "stopOn";
                        stopIsOn = true;
                        $("#inp-stop").css("visibility", "visible");
                    }
                    if (assignedAction === "interlock") {
                        idisp = "interlockOn";
                        intIsOn = true;
                        $("#inp-interlock").css("visibility", "visible");
                    }
                    if (assignedAction === "limit") {
                        if (status.state === "probing") {
                            inProbeOn = true;
                        } else if (inProbeOn) {
                            console.log("limit used for probing");
                        } else {
                            idisp = "limitOn";
                            limitIsOn = true;
                            $("#inp-limit").css("visibility", "visible");
                        }
                    }
                    $(selector).removeClass("off").addClass(idisp);
                } else if (ival === 0) {
                    // input is OFF ... cleanup
                    if (assignedAction === "stop" || assignedAction === "faststop") {
                        if (!stopIsOn) {
                            $("#inp-stop").css("visibility", "hidden");
                        }
                    }
                    if (assignedAction === "interlock") {
                        if (!intIsOn) {
                            $("#inp-interlock").css("visibility", "hidden");
                        }
                    }
                    if (assignedAction === "limit") {
                        if (!limitIsOn) {
                            $("#inp-limit").css("visibility", "hidden");
                            inProbeOn = false;
                        }
                    }
                    $(selector).removeClass("on stopOn interlockOn limitOn").addClass("off");
                } else {
                    // input is disabled  ... not picking up at moment because all reported
                    $(selector).removeClass("on off stopOn interlockOn").addClass("disabled");
                }
            } else {
                break;
            }
        }

        ///update outputs
        for (var i = 1; i < MAX_OUTPUTS + 1; i++) {
            var outname = "out" + i;
            if (outname in status) {
                var selector = that.status_div_selector + " .out" + i;
                if (status[outname] == 1) {
                    $(selector).removeClass("off").addClass("on");
                } else if (status[outname] == 0) {
                    $(selector).removeClass("on").addClass("off");
                } else {
                    $(selector).removeClass("on off").addClass("disabled");
                }
            } else {
                break;
            }
        }

        //// TODO: How to Handle 2 Spindles via g2
        //// TODO: Consider whether to modify g2 to report spc status during feedhold
        ////## -- Currently removing check for spc to just use out1 status for spindle notification
        ////##      because g2 not reporting spindle off during feedhold
        // ///update spc on output1
        // if ('spc' in status) {
        // 	var selector = that.status_div_selector + ' .out1';
        // 	if(status['spc'] == 1) {
        // 		$(selector).removeClass('off').addClass('on');
        // 	} else if(status['spc'] == 0) {
        // 		$(selector).removeClass('on').addClass('off');
        // 	} else {
        // 		$(selector).removeClass('on off').addClass('disabled');
        // 	}
        // }

        $(that.status_div_selector).trigger("statechange", status.state);

        var statename = status.state.charAt(0).toUpperCase() + status.state.slice(1);

        if (status.state != "manual") {
            $(".tab-bar").removeClass("manual");
        }
        if (status.state === "idle") {
            that.allowKeypad();
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).removeClass("fabmo-status-idle");
            $(".tools-current > li a").removeClass("paus err disc");
            $(that.state_selector).html(statename);
            $(".exit-button").hide();
            $(that.pause_button_selector + " div div:first-child").removeClass("spinner red");

            if (that.file_control) {
                $(that.stop_button_selector).hide();
                $(that.resume_button_selector).hide();
                $(that.pause_button_selector).hide();
            }
        } else if (
            status.state === "running" ||
            status.state === "homing" ||
            status.state === "probing" || // probing and manual are here to provide the same graphics as regular moves
            status.state === "manual"
        ) {
            that.forbidKeypad();
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).removeClass("fabmo-status-running");
            $(".tools-current > li a").removeClass("paus disc").addClass("err");
            $(that.state_selector).html(statename);
            if (that.file_control) {
                $(that.stop_button_selector).hide();
                $(that.pause_button_selector).show();
                $(that.resume_button_selector).hide();
                $(that.resume_button_selector + " div:first-child").removeClass("spinner green");
                $(that.stop_button_selector + " div:first-child").removeClass("spinner red");
            }
        } else if (status.state === "paused") {
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).removeClass("fabmo-status-paused");
            $(".tools-current > li a").removeClass("paus disc err").addClass("paus");
            $(that.state_selector).html(statename);
            $(".exit-button").hide();
            if (that.file_control) {
                // When FabMo is in feedhold, display resume button IF fully stopped
                if (status.inFeedHold && (status.hold === 10)) {  // only when fully stopped
                    $(that.stop_button_selector).show();
                    $(that.pause_button_selector).hide();
                    $(that.resume_button_selector).show();
                    // Clear spinners only when fully stopped and ready for Resume/Quit
                    $(that.resume_button_selector + " div:first-child").removeClass("spinner green");
                    $(that.pause_button_selector + " div div:first-child").removeClass("spinner red");
                }
                // While FabMo is resuming from feedhold, display pause button (acts as stop)
                else if (status.resumeFlag) {
                    $(that.stop_button_selector).hide();
                    $(that.pause_button_selector).show();
                    $(that.resume_button_selector).hide();
                    // Don't clear pause button spinner - it may have been clicked during resume
                }
                // If stopping in progress (hold > 0 but < 10), show pause button with spinner
                else if (status.inFeedHold && status.hold > 0 && status.hold < 10) {
                    $(that.stop_button_selector).hide();
                    $(that.pause_button_selector).show();
                    $(that.resume_button_selector).hide();
                    // Keep the spinner visible during the stopping process
                    // Don't clear it here - let it persist from the click handler
                }
            }
        } else if (status.state === "passthrough") {
            that.forbidKeypad();
            $(".tools-current > li a").removeClass("paus disc err").addClass("paus");
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).addClass("fabmo-status-passthrough");
            $(that.state_selector).html("passthrough");
            $(that.stop_button_selector).hide();
            $(that.pause_button_selector).hide();
            $(that.resume_button_selector).hide();
            $(".exit-button").hide();
        } else if (status.state == "limit") {
            that.forbidKeypad();
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).removeClass("fabmo-status-error");
            $(".tools-current > li a").removeClass("paus err").addClass("disc");
            $(that.state_selector).html(status.state);
            $(".exit-button").hide();

            if (that.file_control  && (status.hold === 10)) { // only when fully stopped
                $(that.pause_button_selector).hide();
                $(that.resume_button_selector).show();
                $(that.stop_button_selector).hide();
            }
        } else if (status.state == "not_ready" || status.state == "dead") {
            statename = "Unavailable";
            that.forbidKeypad();
            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).addClass("fabmo-status-error");
            $(that.state_selector).html(statename);
            $(".exit-button").hide();

            if (that.file_control) {
                $(that.pause_button_selector).hide();
                $(that.resume_button_selector).hide();
                $(that.stop_button_selector).hide();
            }
        } else if (status.state == "stopped") {
            that.forbidKeypad();
            $(".exit-button").hide();

            $(that.status_div_selector).removeClass(
                "fabmo-status-running fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
            );
            $(that.status_div_selector).addClass("fabmo-status-paused");
            $(that.state_selector).html(statename);
            if (that.file_control) {
                $(that.pause_button_selector).hide();
                $(that.resume_button_selector).hide();
                $(that.stop_button_selector).hide();
            }
        } /*else if (status.state === "armed") {}*/ else {
            $(".tools-current > li a").removeClass("paus err").addClass("disc");
            console.warn("Unknown status" + JSON.stringify(status));
        }

        if (status.state === "idle" || status.state === "manual") {
            $(that.manual_controls_selector).removeClass("hide");
        } else {
            $(that.manual_controls_selector).addClass("hide");
        }

        this.emit("status", status);
    };

    FabMoUI.prototype.updateStatus = function () {
        var that = this;
        that.tool.getStatus(function (err, status) {
            if (!err) {
                that.updateStatusContent(status);
                that.emit("reconnect");
            } else {
                $(".tools-current > li a").removeClass("paus err").addClass("disc");
                delete this;
                $(that.posX_selector).html("X.XXX");
                $(that.posY_selector).html("X.XXX");
                $(that.posZ_selector).html("X.XXX");
                $(that.status_div_selector).removeClass(
                    "fabmo-status-running fabmo-status-paused fabmo-status-error fabmo-status-disconnected fabmo-status-idle fabmo-status-passthrough"
                );
                $(that.status_div_selector).removeClass("fabmo-status-disconnected");
                $(that.state_selector).html("Unknown Error");
                $(that.status_div_selector).trigger("statechange", "Error");
                if (that.file_control) {
                    $(that.stop_button_selector).hide();
                    $(that.pause_button_selector).hide();
                    $(that.resume_button_selector).hide();
                }
            }
        });
    };

    FabMoUI.prototype.pause = function () {
        var that = this;
        that.tool.pause(function (err, data) {
            if (err) {
                console.error(err);
            } else {
                that.tool.getStatus(function (err, data) {
                    if (err) {
                        console.log(err);
                    } else {
                        if (data.state === "running" || data.state === "probing") {
                            that.pause();
                        }
                    }
                });
            }
        });
    };

    FabMoUI.prototype.FileControl = function () {
        var that = this;
        //    console.log("ADD red spinner pause_button");
        $(that.pause_button_selector).click(function (e) {
            // debug: log selector counts to confirm we are targeting the right element
            try {
                console.debug("Pause click selectors:", that.pause_button_selector, $(that.pause_button_selector).length, $(that.pause_button_selector + " div div:first-child").length);
            } catch (err) {}
            $(that.pause_button_selector + " div div:first-child").addClass("spinner red");
            that.pause();
        });

        $(that.resume_button_selector).click(function (e) {
            $(that.resume_button_selector + " div:first-child").addClass("spinner green");
            that.tool.resume(function (err, data) {
                if (err) {
                    console.error(err);
                }
            });
        });

        $(that.stop_button_selector).click(function (e) {
            $(that.stop_button_selector + " div:first-child").addClass("spinner red");
            that.tool.quit(function (err, data) {
                if (err) {
                    console.error(err);
                }
            });
        });
    };

    // Add centralized spinner clear method
    FabMoUI.prototype.clearSpinners = function () {
        try {
            $(this.resume_button_selector + " div:first-child").removeClass("spinner green");
            $(this.stop_button_selector + " div:first-child").removeClass("spinner red");
            $(this.pause_button_selector + " div div:first-child").removeClass("spinner red");
            // also attempt a more generic cleanup in case DOM structure differs
            $(this.file_control_selector).find(".spinner").removeClass("spinner green red");
        } catch (e) {
            console.debug("clearSpinners error", e);
        }
    };

    return FabMoUI;
});
