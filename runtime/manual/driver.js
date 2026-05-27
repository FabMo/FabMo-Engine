/*
 * runtime/manual/driver.js
 *
 * This module defines ManualDriver, which is a helper object that manages
 * manual control of the machine.  It is the real implementation for the ManualRuntime
 * but exists as a helper so that it can be used inside of other runtimes that need to use the
 * manual state, and want to do it in the same way that the manual runtime does.
 *
 * OVER TIME, Manual has gotten a little crazy because it serves many purposes:
 *  - the Normal Keypad (which is in incremental mode and has relied at different times on
 *      different types of pumping; many acc commands to support keypad extras)
 *      = in the Keypad, the spindle is controlled simply as output 1 (not spph) to avoid interraction with "feedhold"
 *        behaviors; but we still have to turn spph off to prevent feedhold from turnig off the spindle;
 *           this is bad and erratic behavior by g2; a kludge for now
 *  - truly Manual uses for sending individual commands for other purposes, as well as providing
 *      the direct calls for developing other manual motion handlers beyond the normal keypad
 */
var log = require("../../log").logger("manual");
var config = require("../../config");
var util = require("util");
var events = require("events");

// Parameters related to filling the queue, motion, etc.
// These are fussy.
var T_RENEW = 300;
// Per-batch travel = speed × (T_RENEW/60000) × safetyFactor. For button jogs,
// safetyFactor=4 keeps the G2 planner deeply primed so brief timing hiccups
// don't starve motion — but it also stacks ~4 batches of stale path ahead of
// whatever's happening right now, which is invisible for cardinal jogs but
// shows up as multi-second lag when an analog stick sweeps to a new heading.
// For analog motion we run feed ≈ consumption: queue stays ~1 batch deep, so
// ratio updates reach the planner within roughly one T_RENEW window.
var ANALOG_SAFETY_FACTOR = 1.0;
var DEFAULT_SAFETY_FACTOR = 4.0;
// TODO should be in the ManualDriver instance?!
var count = 0;
var RENEW_SEGMENTS = 10;
var DEFAULT_MAX_NUDGES = 3;

// ManualDriver constructor
// The manual driver provides functions for managing the state of the G2 driver while "manually"
// streaming commands to it, as is done when in "pendant" mode or similar
//   drv - The driver instance to manage
//    st - An open stream feeding into an active machining cycle on that driver
function ManualDriver(drv, st, mode) {
    this.stream = st;
    this.driver = drv;
    this.renew_timer = null;
    this.movement_timer = null;
    this.fixedQueue = [];
    this.entered = false;
    this.exited = false;
    this.exiting = false; // Add flag to prevent re-entry
    this.fromFile = false;
    this.gotoModeHold = false;

    // Configurable parameters (read from config in enter(), fall back to defaults)
    this.safetyFactor = DEFAULT_SAFETY_FACTOR;
    this.maxNudges = DEFAULT_MAX_NUDGES;

    // True while the tool is known to be in motion
    this.moving = false;

    // True while the user intends (as far as we know) for the tool to continue moving
    this.keep_moving = false;

    // Set to true to exit the manual state once the current operation is completed
    this.exit_pending = false;
    this.stop_pending = false;

    // Planned position: the endpoint of all queued incremental moves.
    // Used to prevent queuing past the boundary (overshoot prevention).
    // Resynced from status when status overtakes planned (moves consumed).
    this.plannedPos = {};

    // The default mode is "normal" (feed the queue with constant movement along a vector)
    if (mode === "raw") {
        this.mode = "raw";
    } else {
        this.mode = "normal";
    }

    this._atBoundary = false;
    // True once LIM has been signaled (or suppressed) for the current press.
    // Reset on stopMotion so the next press into a known boundary can fire LIM.
    this._limShownThisAttempt = false;

    // Per-axis soft-limit overrides granted via setSoftLimitOverride (bypasses
    // both the boundary clip and the startMotion short-circuit). Cleared
    // automatically on keypad exit since the helper is destroyed.
    this.axisOverrides = {};

    // Per-direction count of consecutive boundary pushes. Drives the LIM →
    // override-prompt escalation. Reset when the user moves to a different
    // vector or override is granted.
    this._limPushCount = {};

    // Current trajectory
    this.current_axis = null;
    this.current_speed = null;
    this.completeCallback = null;
    this.status_handler = this._onG2Status.bind(this);

    // Setup to process status reports from G2
    this.driver.on("status", this.status_handler);

    // Listen for the firmware velocity-jog cycle's exit notification. When
    // the cycle has finished ramping down and exited, clear the in-flight
    // flags so subsequent motions can start cleanly. Without this, a stop()
    // → wait → start() sequence in analog mode would short-circuit on
    // stop_pending because we'd never know the firmware had finished.
    this._jogv_exit_handler = function () {
        if (this.analogMode || this.stop_pending) {
            this.moving        = false;
            this.keep_moving   = false;
            this.stop_pending  = false;
            this.analogMode    = false;
        }
    }.bind(this);
    this.driver.on("jogv_exit", this._jogv_exit_handler);
}
util.inherits(ManualDriver, events.EventEmitter);

// Enter the machining cycle
// This does a little setup too (sets manual state jerk values, etc)
// TODO: Pass the setup stuff in?  (In case runtimes want to do things differently?)
// Returns a promise that resolves on exit
ManualDriver.prototype.enter = function () {
    if (this.entered) {
        return;
    }
    this.driver.manual_hold = true;
    switch (this.mode) {
        case "normal":
            // Retrieve the manual-mode-specific jerk settings and apply them (temporarily) for this manual session
            var jerkXY = config.machine._cache.manual.xy_jerk || 100;
            var jerkZ = config.machine._cache.manual.z_jerk || 100;
            // Read configurable manual control parameters
            this.safetyFactor = config.machine._cache.manual.safety_factor || DEFAULT_SAFETY_FACTOR;
            this.maxNudges = config.machine._cache.manual.max_nudges || DEFAULT_MAX_NUDGES;
            this.stream.write("{xjm:" + jerkXY + "}\n");
            this.stream.write("{yjm:" + jerkXY + "}\n");
            this.stream.write("{zjm:" + jerkZ + "}\n");
            this.stream.write("{spph:false}\n"); // turn off spph so G2 feedhold doesn't turn off spindle
            // Send "dummy" move to prod the machine into issuing a status report
            this.stream.write("M0\nG91\n G0 X0 Y0 Z0\n");
            this.driver.prime();
            break;
        case "raw":
            this.stream.write("M0\n");
            this.driver.prime();
            break;
        default:
            log.warn("Unknown manual drive mode on enter: " + this.mode);
            break;
    }
    this.entered = true;
    var that = this;
    return new Promise(function(resolve, reject) {
        that._promiseResolve = resolve;
        that._promiseReject = reject;
    });
};

// Exit the machining cycle
// This stops motion if it is in progress, and restores the settings changed in enter()
ManualDriver.prototype.exit = function () {
    // Prevent multiple simultaneous exits
    if (this.exiting) {
        log.debug("Exit already in progress - ignoring duplicate exit command");
        return;
    }
    
    if (this.isMoving()) {
        // Don't exit yet - just pend.
        log.debug("Pending the exit");
        this.exit_pending = true;
        this.stopMotion();
    } else {
        log.debug("Executing immediate exit");
        
        // Set flag immediately to prevent re-entry
        this.exiting = true;
        
        this.driver.manual_hold = false;

        // Check if stream exists before trying to write to it
        if (!this.stream) {
            log.warn("Stream already closed during manual exit - skipping stream writes");
            this._done();
            return;
        }

        switch (this.mode) {
            case "normal":
                // Restore the sbp_runtime config settings for jerk
                var jerkXY = config.opensbp._cache.xy_maxjerk || 75;
                var jerkZ = config.opensbp._cache.z_maxjerk || 75;
                this.stream.write("{xjm:" + jerkXY + "}\n");
                this.stream.write("{yjm:" + jerkXY + "}\n");
                this.stream.write("{zjm:" + jerkZ + "}\n");
                this.stream.write("{spph:true}\n");
                
                var feedXY = config.opensbp._cache.movexy_speed || 3;
                var uMult = 1;
                if (config.machine._cache.units === "in") {
                    uMult = 25.4;
                }
                feedXY = feedXY * uMult * 60;
                this.stream.write("M100 ({feed:" + feedXY + "})\n");
                break;
            case "raw":
                break;
            default:
                log.warn("Unknown manual drive mode on exit: " + this.mode);
                break;
        }
        
        this.stream.write("G61\n");
        if (this.fromFile) {
            this.stream.write("M0\n");
        } else {
            this.stream.write("M30\n");
            this.stream.write("{out4:0}\n");
            this.stream.write("{out1:0}\n");
        }
        
        this.driver.removeListener("status", this.status_handler);
        this.driver.removeListener("jogv_exit", this._jogv_exit_handler);
        this.exited = true;

        // Give a brief moment for commands to flush
        setTimeout(() => {
            this._done();
        }, 100);
    }
};

// Start motion on the specified axis (and optional second axis) at the specified speed
// TODO - This function should really just take an arbitrary vector
//           axis - The first axis to move (eg "X")
//          speed - The speed in current units
//    second_axis - The second axis to move
//   second_speed - The second axis speed
ManualDriver.prototype.startMotion = function (axis, speed, second_axis, second_speed, primary_ratio, secondary_ratio) {
    // Two callers:
    //   Dashboard (legacy):  ratios omitted. speed is the F value (toolpath);
    //                        per-axis segments use ±1 from the sign of speed
    //                        and second_speed. Encodes cardinals + 45°.
    //   Pendant analog:      ratios provided. speed is still the F value;
    //                        per-axis segments use the signed ratios (each in
    //                        [-1, +1], with sum-of-squares = 1) so any-angle
    //                        diagonals are possible.
    // Internally we collapse these into the same state: currentDirection and
    // second_currentDirection always hold the signed *ratio* (±1 in the legacy
    // case). _renewMoves multiplies by these ratios when emitting segments.
    var hasRatios = primary_ratio !== undefined;
    var dir = hasRatios ? primary_ratio : (speed < 0 ? -1.0 : 1.0);
    var second_dir = hasRatios ? (secondary_ratio || 0) : (second_speed < 0 ? -1.0 : 1.0);
    speed = Math.abs(speed);
    this.gotoModeHold = false;

    if (this.mode != "normal") {
        throw new Error("Cannot start movement in " + this.mode + " mode.");
    }

    // Analog fast-path. When the caller supplies ratios, drive the firmware's
    // velocity-mode jog cycle directly via {"jgv*":...} commands. The cycle
    // handles its own jerk-limited ramp + watchdog + planner queue depth, so
    // we don't queue G1 segments at all. The pendant's processMotion loop
    // (50 ms cadence) naturally heartbeats inside the firmware watchdog
    // (500 ms default).
    //
    // This runs BEFORE the stop_pending gate because the firmware cycle
    // accepts mid-flight velocity updates — there is no need to wait for a
    // previous stop to finish ramping down. The cycle will simply pick up
    // the new v_target and keep running, which is exactly the behavior we
    // want when the user flicks the stick rapidly between directions.
    //
    // Per-axis velocity = speed × ratio in the host's current display units
    // (in/min if G20, mm/min if G21). The firmware's jgv setter converts to
    // canonical mm/min internally, so units round-trip cleanly.
    if (hasRatios) {
        var vec = {};
        vec[axis.toLowerCase()] = speed * dir;
        if (second_axis) {
            vec[second_axis.toLowerCase()] = speed * second_dir;
        }

        // Soft-limit speed cap for the velocity-jog cycle. The G1 path's
        // planned-position clip in _renewMoves doesn't apply here — JGV is
        // a firmware-side velocity setpoint, not queued segments — so we
        // derive per-axis max velocity directly from the remaining margin
        // and the configured jerk profile, then cap the requested velocity
        // against it.
        //
        // Formula (jerk-limited S-curve stop):
        //   stop_distance(v) ≈ v · √(v / j)   →   v_safe(m) ≈ (m² · j)^(1/3)
        //
        // Units: vec values are in display-units/min (IPM in G20), margin in
        // display-units. Math runs in display-units/s; scale by 60 on the way
        // out. The jerk coefficient scales linearly with xy_jerk so retuning
        // jerk auto-retunes the cap.
        //
        // Lookahead: the formula above is the irreducible physical stop
        // distance, but the cap → firmware → physical-decel loop has ~150ms
        // of round-trip lag. Without compensation the tool travels v·τ past
        // the point where the cap commanded stop. We reserve that distance
        // up front by subtracting toolpath_speed·LOOKAHEAD_S from each
        // axis's margin before applying the formula.
        //
        // Using the toolpath speed (not per-axis |v|) is an empirical fix
        // for diagonals: with per-axis |v|, single-axis 6 IPS stops cleanly
        // but 45° diagonals at 6 IPS total overshoot ~0.25" per axis. The
        // multi-axis JGV path appears to have either longer effective lag
        // or reduced per-axis jerk, and scaling reservation by toolpath
        // speed (which is √2× larger than per-axis on a 45° diagonal)
        // absorbs the difference without affecting single-axis behavior.
        //
        // softlimit_cushion (config) is an additional safety buffer on top
        // of the lookahead. Default 0 → stop right at the soft limit.
        //
        // Per-axis (not toolpath) capping lets the user slide along a wall —
        // push hard into +X, the stick still moves on Y. Skipped when
        // softlimits_on is false or the user has overridden that axis.
        if (config.machine._cache.softlimits_on) {
            var jerk = (config.machine._cache.manual &&
                config.machine._cache.manual.xy_jerk) || 75;
            var buffer = (config.machine._cache.manual &&
                config.machine._cache.manual.softlimit_cushion) || 0;
            var k = jerk * 0.18;
            // Multi-axis JGV has more per-cycle timing jitter than single-
            // axis, so multi-axis gets a slightly larger reservation.
            var activeAxes = 0;
            for (var k1 in vec) { if (vec[k1] !== 0) activeAxes++; }
            var LOOKAHEAD_S = activeAxes > 1 ? 0.18 : 0.15;
            // Don't let the cap park the tool short of the limit. Below this
            // velocity the per-cycle stop distance is < 0.02" so we can ride
            // it right up to the raw boundary safely.
            var CREEP_IPM = 30;  // 0.5 IPS
            // The same round-trip lag that motivates the high-speed lookahead
            // also applies at creep, plus a fixed tail from the firmware's
            // own decel ramp. Empirically the stop-from-creep distance is
            // ~0.14" at CREEP_IPM=30 — pre-empt the zero-check by that much
            // so the actual stop lands at the limit, not past it.
            var creepStopDist = 0.14;
            for (var axisKey in vec) {
                var v = vec[axisKey];
                if (v === 0) continue;
                if (this.axisOverrides[axisKey]) continue;
                var axisUpper = axisKey.toUpperCase();
                var directionSign = v > 0 ? 1 : -1;
                var margin = this._getMargin(axisUpper, directionSign);
                // Only hard-stop when the actual margin (less any cushion
                // and the creep-speed stop tail) is gone. The lookahead just
                // sets when the high-speed cap kicks in — it shouldn't be
                // the parking distance.
                if (margin - buffer - creepStopDist <= 0) {
                    vec[axisKey] = 0;
                    continue;
                }
                var lookahead = (speed / 60) * LOOKAHEAD_S;
                var effectiveMargin = Math.max(margin - buffer - lookahead, 0);
                var vSafeIpm = 60 * Math.cbrt(effectiveMargin * effectiveMargin * k);
                // Floor at creep so the tool keeps inching toward the limit
                // instead of parking 0.5–1" short when the cap collapses.
                if (vSafeIpm < CREEP_IPM) vSafeIpm = CREEP_IPM;
                if (Math.abs(v) > vSafeIpm) {
                    vec[axisKey] = directionSign * vSafeIpm;
                }
            }
        }

        this.driver.jogVelocity(vec);

        // Track minimal state. analogMode is set here AND stays set through
        // any subsequent stopMotion; only the jogv_exit handler clears it,
        // when the firmware actually finishes the cycle. That way a
        // stop→re-engage during ramp-down keeps taking this path.
        this.moving         = true;
        this.keep_moving    = true;
        this.analogMode     = true;
        this.currentAxis    = axis;
        this.currentSpeed   = speed;
        this.currentDirection = dir;
        if (second_axis) {
            this.second_axis = second_axis;
            this.second_currentDirection = second_dir;
        } else {
            this.second_axis = null;
            this.second_currentDirection = null;
        }
        return;
    }

    if (this.stop_pending) {
        return;
    }

    // If already at boundary in the same direction, short-circuit: keep the
    // alive flag set and return without writing to G2.
    // Emit LIM only on the first short-circuit since the last stopMotion —
    // i.e. user is deliberately pushing into a known limit, not just arriving.
    // On the second deliberate push we escalate to an override prompt.
    // (Use sign comparison so analog ratios in [-1, +1] match ±1 legacy state.)
    if (this._atBoundary &&
        axis === this.currentAxis &&
        Math.sign(dir) === Math.sign(this.currentDirection || 0) &&
        !this.axisOverrides[axis.toLowerCase()]) {
        if (!this._limShownThisAttempt) {
            this._limShownThisAttempt = true;
            var dirLabel = this.currentDirection < 0 ? "minimum" : "maximum";
            var key = this.currentAxis.toUpperCase() + (this.currentDirection < 0 ? "-" : "+");
            this._limPushCount[key] = (this._limPushCount[key] || 0) + 1;
            if (this._limPushCount[key] === 1) {
                this.emit("softLimit", {
                    axis: this.currentAxis.toUpperCase(),
                    dir: dirLabel,
                });
            } else if (this._limPushCount[key] === 2) {
                // Once per boundary session — count > 2 stays silent so the
                // user isn't pestered after dismissing the modal.
                this.emit("softLimitOverridePrompt", {
                    axis: this.currentAxis.toUpperCase(),
                    dir: dirLabel,
                });
            }
        }
        this.keep_moving = true;
        return;
    }

    // Improved axis switching without debug logging
    if (this.moving) {
        // In-place ratio update: same axes, same F (toolpath), no sign flip on
        // either component. Just refresh currentDirection / second_currentDirection
        // and let the already-scheduled renew_timer pick up the new ratios on
        // its next natural fire. Queuing fresh segments here (on every stick
        // tick at PROCESS_HZ) stacked the G2 planner faster than it could
        // drain, leaving multiple batches of stale direction queued ahead of
        // the user's new direction. Sign flips and axis swaps still fall
        // through to the stop-restart path below.
        var sameAxes = (axis === this.currentAxis) &&
                       ((second_axis || null) === (this.second_axis || null));
        var oldDir = this.currentDirection || 0;
        var oldSecondDir = this.second_currentDirection || 0;
        var primaryFlip = oldDir !== 0 && dir !== 0 && Math.sign(dir) !== Math.sign(oldDir);
        var secondaryFlip = oldSecondDir !== 0 && second_dir !== 0 && Math.sign(second_dir) !== Math.sign(oldSecondDir);
        if (sameAxes && Math.abs(speed - this.currentSpeed) < 0.5 && !primaryFlip && !secondaryFlip) {
            this.currentDirection = dir;
            if (second_axis) this.second_currentDirection = second_dir;
            this.keep_moving = true;
            return;
        }
        // Smooth axis transitions
        if (this._atBoundary) {
            this._atBoundary = false;
            this._limShownThisAttempt = false;
            this._limPushCount = {};
            this.emit("softLimitClear");
        }
        this.plannedPos = {};

        if (this.renew_timer) {
            clearTimeout(this.renew_timer);
            this.renew_timer = null;
        }

        this.currentAxis = axis;
        this.currentSpeed = speed;
        this.currentDirection = dir;

        if (second_axis) {
            this.second_axis = second_axis;
            this.second_currentDirection = second_dir;
        } else {
            this.second_axis = null;
            this.second_currentDirection = null;
        }

        this.renewDistance = speed * (T_RENEW / 60000) * (this.analogMode ? ANALOG_SAFETY_FACTOR : this.safetyFactor);
        this.stream.write("G91 F" + this.currentSpeed.toFixed(3) + "\n");
        this._renewMoves("axis_change");
        return;
    } else {
        // Fresh motion start
        if (this._atBoundary) {
            this._atBoundary = false;
            this._limPushCount = {};
            this.emit("softLimitClear");
        }
        this.plannedPos = {};
        if (second_axis) {
            this.second_axis = second_axis;
            this.second_currentDirection = second_dir;
        } else {
            this.second_axis = null;
            this.second_currentDirection = null;
        }

        this.currentAxis = axis;
        this.currentSpeed = speed;
        this.currentDirection = dir;
        this.moving = this.keep_moving = true;
        this.renewDistance = speed * (T_RENEW / 60000) * (this.analogMode ? ANALOG_SAFETY_FACTOR : this.safetyFactor);
        
        this.stream.write("G91 F" + this.currentSpeed.toFixed(3) + "\n" + "G61" + "\n");
        this._renewMoves("start");
    }
};

// Set the flag that indicates to this driver that motion is still requested along the current heading
// This function only has any effect if the machine is already moving
ManualDriver.prototype.maintainMotion = function () {
    if (this.moving) {
        this.keep_moving = true;
    }
};

// Stop all movement
ManualDriver.prototype.stopMotion = function () {
    // Analog (firmware velocity-jog cycle) path: emit jogStop and let the
    // firmware cycle ramp down on its own decel. Don't set stop_pending —
    // the cycle accepts mid-flight velocity updates, so if the user
    // re-engages the stick during the ramp-down we want subsequent
    // startMotion calls to flow straight through to a fresh jogVelocity.
    // The jogv_exit handler will clear analogMode/moving/keep_moving when
    // the cycle actually exits.
    if (this.analogMode) {
        this.driver.jogStop();
        this.keep_moving = false;
        this._limShownThisAttempt = false;
        return;
    }

    // Legacy (cardinal/keypad) path: feedhold + queue flush.
    this.stop_pending = true;
    this.keep_moving = false;
    this.plannedPos = {};
    // Don't reset _atBoundary here — releasing the button at a limit doesn't
    // change the fact that we're at the limit. It's cleared by startMotion
    // when motion in a different direction begins.
    // Reset _limShownThisAttempt so the next press into a known boundary
    // re-fires the LIM indicator.
    this._limShownThisAttempt = false;
    if (this.renew_timer) {
        clearTimeout(this.renew_timer);
    }
    this.driver.feedHold();
    if (!this.gotoModeHold) {
        this.driver.queueFlush(
            function () {
                this.driver._write("%\n"); // Will send flush as callback
            }.bind(this)
        );
    }
};

// Stop all movement (also? TODO: What's this all about?)
ManualDriver.prototype.quitMove = function () {
    this.keep_moving = false;
    this.driver.queueFlush(
        function () {
            this.driver._write("%\n"); // Will send flush as callback
        }.bind(this)
    );
    if (this.moving) {
        this.stop_pending = true;
        this.driver.quit();
        this.driver.queueFlush();
    } else {
        this.stop_pending = false;
    }
};

ManualDriver.prototype.resumeMove = function () {
    this.driver.manual_hold = false;
    this.keep_moving = true;
    this.stop_pending = false;
    this.emit("manual");
    this.driver.manualResume();
    this.keep_moving = true;
    if (this.moving) {
        this.driver.resume();
    } else {
        this.stop_pending = false;
    }
};

ManualDriver.prototype.runGCode = function (code) {
    if (this.mode == "raw") {
        ////## section for betaInsert
        log.debug("... possibly converting special codes in betaInsert");
        code = code.replace(/&/g, "\n"); // for use in creating multiple lines
        code = code.replace("^", "\x04\n"); // to insert a kill
        code = code.replace("!", "\x21\n"); // to insert a hold
        code = code.replace("~", "\x7E\n"); // to insert a resume
        code = code.replace("#", "\x18\n"); // to insert RESET-G2
        ////## Not really working right yet if you do a hold
        if (this.moving) {
            log.debug("writing gcode while moving"); ////##
            this.stream.write(code.trim() + "\n");
            this.maintainMotion();
        } else {
            log.debug("writing gcode while static");
            this.moving = true;
            this.stream.write(code.trim() + "\n");
            this.maintainMotion();
            this._renewMoves("start");
        }
    } else {
        throw new Error("Cannot run gcode when in " + this.mode + " mode.");
    }
};

// Go to a specified absolute position
//   pos - Position vector as an object, eg: {"X":10, "Y":5, "F":60} Speed is optionally added
// The speed will be vectored based on the current speed setting on the slider; but limited to axis maximums
ManualDriver.prototype.goto = function (pos) {
    // We may want to consider whether GOTOs are moves or jogs; for now, they're moves w/speed set by slider (safer)
    var hasZABC = false;
    var of_ZABC = "";
    var move = "G90\nG1 ";
    for (var key in pos) {
        if (Object.prototype.hasOwnProperty.call(pos, key)) {
            move += key + pos[key] + " ";
            if (key === "Z" || key === "A" || key === "B" || key === "C") {
                // To see if we should set a lower speed; check to see is this special axis is actually a move given the current location of the axis
                var testa = this.driver.status["pos" + key.toLowerCase()];
                var testb = pos[key];
                if (Math.abs(testa - testb) > 0.001) {
                    hasZABC = true;
                    of_ZABC = key;
                }
            }
        }
    }
    if (hasZABC) {  // If we have a special axis move use appropriate speed (not controlled by slider, user sets manually in configs)
        switch (of_ZABC) {
            case "Z":
                move += "F" + 60 * config.machine._cache.manual.z_fast_speed;
                break;
            case "A":
                move += "F" + 60 * config.opensbp._cache.movea_speed;
                break;
            case "B":
                move += "F" + 60 * config.opensbp._cache.moveb_speed;
                break;
            case "C":
                move += "F" + 60 * config.opensbp._cache.movec_speed;
                break;
        }
    } else {
        move += "F" + 60 * config.machine._cache.manual.xy_speed;
    }
    this.gotoModeHold = true;
    move += "\nM0\nG91\n";
    this.driver.prime();
    this.stream.write(move);
};

// This function was created to turn outputs on and off from inside the manual runtime
// ... however, output 1 in the Keypad is the only one we are currently handling
// ... for a spindle. We do not use M3 and spc because we don't want the spph spindle handling
// ... because feedholds are used to manage the key action in the Keypad. So we just toggle output 1.
// [NOTE: That in anycase, spph: false may not be working correctly in G2 at this time.]
// Toggle an output in manual [currenting only doing output1 for spindle]so
//   out - Output as a state, eg: {"1":1} or {"1":0} (i.e. using g-code json format)
//   ... such that the short hand version looks like {out1:1}
ManualDriver.prototype.output = function (out, val) {
    var newOut = "";

    newOut = "{out" + out + ":" + val + "}\n";

    log.info("ManualDriver.output called with: " + newOut);
    this.mode = "raw"; // or this.driver.mode = "raw"
    this.stream.write(newOut);
    this.mode = "normal"; // or this.driver.mode = "normal";
};

// Set the machine position to the specified "location"
// TODO: Is it possible that timing could produce an inaccurate position update here???
//   pos - New position vector as an object,  eg: {"X":10, "Y":5}
ManualDriver.prototype.set = function (pos) {
    var toSet = {};
    var unitConv;
    if (this.driver.status.unit === "in") {
        // inches
        unitConv = 0.039370079;
    } else {
        unitConv = 1;
    }
    // Deal with unit conversion for ABC which can be rotary(1);linear(2);radius(3) [these are ints!]
    if (config.driver._cache.aam === 1) {
        var unitConvA = 1; //never a converion for rotary
    } else {
        unitConvA = unitConv; // linear use current units
    }
    if (config.driver._cache.bam === 1) {
        var unitConvB = 1;
    } else {
        unitConvB = unitConv;
    }
    if (config.driver._cache.cam === 1) {
        var unitConvC = 1;
    } else {
        unitConvC = unitConv;
    }

    if (this.mode === "normal") {
        // var gc = 'G10 L20 P2 ';
        this.driver.get(
            "mpo",
            function (err, MPO) {
                Object.keys(pos).forEach(
                    function (key) {
                        log.debug(key);
                        switch (key) {
                            case "X":
                                toSet.g55x = Number((MPO.x * unitConv - pos[key]).toFixed(5));
                                break;
                            case "Y":
                                toSet.g55y = Number((MPO.y * unitConv - pos[key]).toFixed(5));
                                break;
                            case "Z":
                                toSet.g55z = Number((MPO.z * unitConv - pos[key]).toFixed(5));
                                break;
                            case "A":
                                toSet.g55a = Number((MPO.a * unitConvA - pos[key]).toFixed(5));
                                break;
                            case "B":
                                toSet.g55b = Number((MPO.b * unitConvB - pos[key]).toFixed(5));
                                break;
                            case "C":
                                toSet.g55c = Number((MPO.c * unitConvC - pos[key]).toFixed(5));
                                break;
                            default:
                                log.error("don't understand axis");
                        }
                    }.bind(this)
                );
                config.driver.setMany(
                    toSet,
                    // eslint-disable-next-line no-unused-vars
                    function (err, value) {
                        //total hack to update the positions
                        this.stream.write("G91\nG0\nX0\nG91");
                        this.driver.prime();
                        config.driver.reverseUpdate(
                            ["g55x", "g55y", "g55z", "g55a", "g55b", "g55c"],
                            // eslint-disable-next-line no-unused-vars
                            function (err, data) {}
                        );
                    }.bind(this)
                );
            }.bind(this)
        );
    } else {
        throw new Error("Can't set from " + this.mode + " mode.");
    }
};

// Internal function for handling nudges. (This function called "Fixed" moves in Sb3; there, nudges were
// moves inserted at a Stop in the middle of a file; G2 could allow implementation of this behavior.)
// Nudges are little fixed incremental moves that are usually initiated by a short tap on one of the
// direction keys on a pendant display, or by pressing the direction keys in a specified "fixed" mode
// and executed at the end of the current move.  This is the function that dequeues and executes them.
// Nudges are made fixed and individual by G61.1.
// TODO: Like start above, nudges should be arbritrary vectors rather than axis, second_axis
// Snap a nudge to the next grid line in its direction of motion. The grid
// is defined by the nudge increment relative to work zero — e.g. a 0.100"
// nudge from 26.241" lands on 26.300", then 26.400", etc. Already on grid
// counts as off — advance by one full increment to avoid no-ops.
function snapNudgeDistance(currentPos, distance, increment) {
    if (!increment || distance === 0) return distance;
    var EPSILON = 1e-6;
    var posInGrid = currentPos / increment;
    var line;
    if (distance > 0) {
        line = Math.ceil(posInGrid);
        if (Math.abs(line - posInGrid) < EPSILON) line += 1;
    } else {
        line = Math.floor(posInGrid);
        if (Math.abs(line - posInGrid) < EPSILON) line -= 1;
    }
    return line * increment - currentPos;
}

// Returns the number of nudges
ManualDriver.prototype._handleNudges = function () {
    count = this.fixedQueue.length;

    if (this.fixedQueue.length > 0) {
        // Track planned position across queued nudges so back-to-back
        // taps advance multiple grid lines instead of all snapping to
        // the same one.
        var snapPos = {};
        while (this.fixedQueue.length > 0) {
            var move = this.fixedQueue.shift();
            var axis = move.axis.toUpperCase();

            // Snap-to-grid: rewrite distance so the move lands on the next
            // grid line (multiple of the nudge increment) in the direction
            // of motion, relative to work zero. Runs before the soft-limit
            // clip so the boundary check still applies to the snapped move.
            if ("XYZABC".indexOf(axis) >= 0) {
                var axisLower = axis.toLowerCase();
                var increment = Math.abs(move.distance);
                var basePos = (snapPos[axisLower] !== undefined)
                    ? snapPos[axisLower]
                    : this.driver.status["pos" + axisLower];
                if (basePos !== undefined && basePos !== null && increment > 0) {
                    move.distance = snapNudgeDistance(basePos, move.distance, increment);
                    snapPos[axisLower] = basePos + move.distance;
                }
                if (move.second_axis && move.second_distance) {
                    var secondLower = move.second_axis.toLowerCase();
                    var secondInc = Math.abs(move.second_distance);
                    var secondBase = (snapPos[secondLower] !== undefined)
                        ? snapPos[secondLower]
                        : this.driver.status["pos" + secondLower];
                    if (secondBase !== undefined && secondBase !== null && secondInc > 0) {
                        move.second_distance = snapNudgeDistance(secondBase, move.second_distance, secondInc);
                        snapPos[secondLower] = secondBase + move.second_distance;
                    }
                }
            }

            // Soft-limit gate for nudges. Without this a quick tap could
            // bypass the boundary check that startMotion/_renewMoves enforce.
            // Same escalation as continuous jog: silent clip → LIM → prompt.
            // (Second-axis nudges only check the primary axis, matching
            // _renewMoves; a mixed-override two-axis nudge is a rare case.)
            if ("XYZ".indexOf(axis) >= 0
                && config.machine._cache.envelope
                && config.machine._cache.softlimits_on
                && !this.axisOverrides[axis.toLowerCase()]) {
                var dir = move.distance < 0 ? -1 : 1;
                var distAbs = Math.abs(move.distance);
                var margin = this._getMargin(axis, dir);
                var key = axis + (dir < 0 ? "-" : "+");
                var dirLabel = dir < 0 ? "minimum" : "maximum";

                if (margin <= 0) {
                    // Already at boundary — block the nudge and escalate.
                    this._limPushCount[key] = (this._limPushCount[key] || 0) + 1;
                    this._atBoundary = true;
                    this.currentAxis = axis;
                    this.currentDirection = dir;
                    if (this._limPushCount[key] === 1) {
                        this.emit("softLimit", { axis: axis, dir: dirLabel });
                    } else if (this._limPushCount[key] === 2) {
                        this.emit("softLimitOverridePrompt", { axis: axis, dir: dirLabel });
                    }
                    continue;
                }
                if (distAbs > margin) {
                    // Silent first arrival — clip the nudge to the boundary.
                    move.distance = dir * margin;
                    this._atBoundary = true;
                    this.currentAxis = axis;
                    this.currentDirection = dir;
                } else if (this._atBoundary) {
                    // Nudge fits with headroom — left the boundary.
                    this._atBoundary = false;
                    this._limPushCount = {};
                    this.emit("softLimitClear");
                }
            }

            this.moving = true;
            this.keep_moving = false;

            if ("XYZABC".indexOf(axis) >= 0) {
                var moves = ["G91 G61.1"]; // set to exact fixed distance
                if (move.second_axis) {
                    var second_axis = move.second_axis.toUpperCase();
                    if (move.speed) {
                        moves.push(
                            "G1 " +
                                axis +
                                move.distance.toFixed(5) +
                                " " +
                                second_axis +
                                move.second_distance.toFixed(5) +
                                " F" +
                                move.speed.toFixed(3)
                        );
                    } else {
                        moves.push(
                            "G0 " +
                                axis +
                                move.distance.toFixed(5) +
                                " " +
                                move.second_axis.toUpperCase +
                                move.second_distance.toFixed(5) +
                                " F" +
                                move.speed.toFixed(3)
                        );
                    }
                } else {
                    if (move.speed) {
                        moves.push("G1 " + axis + move.distance.toFixed(5) + " F" + move.speed.toFixed(3));
                    } else {
                        moves.push("G0 " + axis + move.distance.toFixed(5) + " F" + move.speed.toFixed(3));
                    }
                }
                moves.forEach(
                    function (move) {
                        this.stream.write(move + "\n");
                    }.bind(this)
                );
            }
        }
        this.driver.prime();
    } else {
        this.moving = this.keep_moving = false;
    }
    return count;
};

// Issue a nudge (small fixed move).
// Don't queue more than maxNudges (configurable), to keep the machines behavior from running away.
// (TODO: Might consider making this a typematic sort of thing where after a time you get a machine gun effect.)
// ie: You shoudln't be allowed to queue 50 nudges during a long slow move, and see them execute at the end.
//              axis - The first axis to move (eg "X")
//             speed - The speed in current units
//          distance - The length of the nudge
//       second_axis - The second axis to move
//   second_distance - The second axis speed
ManualDriver.prototype.nudge = function (axis, speed, distance, second_axis, second_distance) {
    if (this.fixedQueue.length >= this.maxNudges) {
        log.warn("fixedMove(): Move queue is already full!");
        return;
    }
    if (second_axis) {
        this.fixedQueue.push({
            axis: axis,
            speed: speed,
            distance: distance,
            second_axis: second_axis,
            second_distance: second_distance,
        });
    } else {
        this.fixedQueue.push({ axis: axis, speed: speed, distance: distance });
    }
    if (this.moving) {
        log.warn("fixedMove(): Queueing move, due to already moving.");
    } else {
        this._handleNudges();
    }
};

// Grant a temporary soft-limit override for the given axis. Bypasses both
// directions of the axis so the user can also reverse out of any over-travel
// they create. Cleared on keypad exit (the helper itself goes away).
//   axis - Axis letter (e.g. "X")
ManualDriver.prototype.setSoftLimitOverride = function (axis) {
    if (!axis) return;
    var axisLower = String(axis).toLowerCase();
    this.axisOverrides[axisLower] = true;
    log.info("Soft limit override granted for axis " + axisLower.toUpperCase() +
             " (clears on keypad exit)");
    // Drop boundary state so the next press flows through normal motion.
    this._atBoundary = false;
    this._limShownThisAttempt = false;
    this._limPushCount = {};
    this.emit("softLimitClear");
};

// Return true if the machine is moving
ManualDriver.prototype.isMoving = function () {
    return this.moving;
};

// Return the available margin (distance to boundary) for a given axis and direction.
// Reads envelope (table coords) and G55 offset live so it always reflects the
// current zero — no stale cached bounds if the user re-zeroes mid-session.
//   axis - Axis letter (e.g. "x", "X")
//   direction - Sign of motion: -1 or +1
//   pos - (optional) work position to check from; defaults to status position
ManualDriver.prototype._getMargin = function (axis, direction, pos) {
    var envelope = config.machine._cache.envelope;
    if (!envelope) return Infinity;
    var axisLower = axis.toLowerCase();
    var currentPos = (pos !== undefined) ? pos : this.driver.status["pos" + axisLower];
    if (currentPos === undefined) return Infinity;

    var offset = config.driver.get("g55" + axisLower) || 0;
    if (envelope[axisLower + "min"] === undefined || envelope[axisLower + "max"] === undefined) return Infinity;
    // Envelope is in table (G53) coords; convert to work coords by subtracting g55 offset.
    var workMin = envelope[axisLower + "min"] - offset;
    // Z ceiling is fixed at machine_z = 0 (homed top of travel) regardless of
    // envelope.zmax — work-Z zero shifts every bit change, so the only stable
    // ceiling is the invariant table-base top.
    var zmaxTable = (axisLower === "z") ? 0 : envelope[axisLower + "max"];
    var workMax = zmaxTable - offset;

    var margin;
    if (direction < 0) {
        margin = currentPos - workMin;
    } else {
        margin = workMax - currentPos;
    }
    return Math.max(margin, 0);
};

// Internal function called to "pump" moves into the queue
// This function is called periodically until a == stop is requested ==,
// or the users intent to continue moving evaporates ////##??.
// The idea behind this function is that it is called at an interval that outpaces the
// reason - The reason this functon is being called (used for -debug- purposes)
// eslint-disable-next-line no-unused-vars
ManualDriver.prototype._renewMoves = function (reason) {
    if (this.mode === "normal") {
        if (this.keep_moving && (this.moving || reason === "start")) {
            if (global.CLIENT_DISCONNECTED) {
                this.keep_moving = false;
                return;
            }

            if (reason === "start") {
                this.moving = true;
            }

            var segment = this.currentDirection * (this.renewDistance / RENEW_SEGMENTS);
            var second_segment = this.second_currentDirection * (this.renewDistance / RENEW_SEGMENTS);
            var segmentCount = RENEW_SEGMENTS;

            // --- Planned-position tracking for overshoot prevention ---
            // plannedPos tracks the endpoint of all queued incremental moves.
            // We clip against plannedPos (not status) so moves already in the
            // G2 planner buffer are accounted for.
            // Initialize once from status, then only accumulate — never resync
            // from status during motion (G2 can report transient position spikes
            // during acceleration that would corrupt the margin calculation).
            // Explicit resets in startMotion/stopMotion handle re-initialization.
            var axisLower = this.currentAxis.toLowerCase();
            if (this.plannedPos[axisLower] === undefined) {
                var statusPos = this.driver.status["pos" + axisLower];
                this.plannedPos[axisLower] = (statusPos !== undefined && statusPos !== null) ? statusPos : 0;
            }

            if (this.second_axis) {
                var secondLower = this.second_axis.toLowerCase();
                if (this.plannedPos[secondLower] === undefined) {
                    var secondStatus = this.driver.status["pos" + secondLower];
                    this.plannedPos[secondLower] = (secondStatus !== undefined && secondStatus !== null) ? secondStatus : 0;
                }
            }

            // Clip batch to work-coordinate bounds using plannedPos.
            // Skip the whole block if the primary axis has an override granted —
            // multi-axis jogs with mixed override are rare enough that letting
            // the secondary axis through unclipped is acceptable.
            if (config.machine._cache.envelope && config.machine._cache.softlimits_on
                && !this.axisOverrides[axisLower]) {
                var batchDistance = Math.abs(segment) * segmentCount;
                var margin = this._getMargin(this.currentAxis, this.currentDirection, this.plannedPos[axisLower]);

                if (this.second_axis) {
                    var secondMargin = this._getMargin(this.second_axis, this.second_currentDirection, this.plannedPos[secondLower]);
                    var secondBatch = Math.abs(second_segment) * segmentCount;
                    var scale = 1;
                    if (batchDistance > 0 && margin < batchDistance) {
                        scale = Math.min(scale, margin / batchDistance);
                    }
                    if (secondBatch > 0 && secondMargin < secondBatch) {
                        scale = Math.min(scale, secondMargin / secondBatch);
                    }
                    if (scale <= 0) {
                        margin = 0;
                    } else if (scale < 1) {
                        segment = segment * scale;
                        second_segment = second_segment * scale;
                    }
                } else {
                    if (batchDistance > 0 && margin < batchDistance && margin > 0) {
                        segment = this.currentDirection * (margin / segmentCount);
                    }
                }

                if (margin <= 0) {
                    // Planned endpoint has reached the boundary — stop queuing
                    // new moves, but keep the renew timer alive.
                    // Only emit the softLimit indicator when the actual machine
                    // position (status) is within 0.5 units of the boundary,
                    // not when the queued endpoint reaches it (which can be
                    // many inches ahead due to planner buffering).
                    var statusMargin = this._getMargin(this.currentAxis, this.currentDirection);
                    if (!this._atBoundary && statusMargin <= 0.5) {
                        // First arrival at the boundary in this press session —
                        // silent stop. LIM only shows if the user releases and
                        // pushes again (handled in startMotion's short-circuit).
                        this._atBoundary = true;
                        this._limShownThisAttempt = true;
                        var axisName = this.currentAxis.toUpperCase();
                        var dir = this.currentDirection < 0 ? "minimum" : "maximum";
                        log.info("Soft limit reached (silent): axis=" + axisName + " dir=" + dir);
                    }
                    this.renew_timer = setTimeout(
                        function () {
                            this._renewMoves("timeout");
                        }.bind(this),
                        T_RENEW
                    );
                    return;
                }
            }

            var moves = [];

            if (this.second_axis) {
                for (var i = 0; i < segmentCount; i++) {
                    var move =
                        "G1" +
                        this.currentAxis +
                        segment.toFixed(4) +
                        this.second_axis +
                        second_segment.toFixed(4) +
                        "\n";
                    moves.push(move);
                }
            } else {
                for (var i = 0; i < segmentCount; i++) {
                    var move = "G1" + this.currentAxis + segment.toFixed(4) + "\n";
                    moves.push(move);
                }
            }

            this.stream.write(moves.join(""));
            this.driver.prime();

            // Advance planned position by queued batch
            this.plannedPos[axisLower] += segment * segmentCount;
            if (this.second_axis) {
                this.plannedPos[secondLower] += second_segment * segmentCount;
            }

            this.renew_timer = setTimeout(
                function () {
                    this._renewMoves("timeout");
                }.bind(this),
                T_RENEW
            );
        } else {
            if (this.moving && !this.keep_moving) {
                this.stopMotion();
            }
            if (this.renew_timer) {
                clearTimeout(this.renew_timer);
                this.renew_timer = null;
            }
        }
    } else {
        // Raw mode unchanged
        if (!(this.moving && this.keep_moving)) {
            // TODO:  Why is this disabled?
            //this.stopMotion();
        } else {
            this.renew_timer = setTimeout(
                function () {
                    this._renewMoves("timeout");
                }.bind(this),
                T_RENEW
            );
        }
    }
};

// Status handler
ManualDriver.prototype._onG2Status = function (status) {
    if (this.movement_timer) {
        clearTimeout(this.movement_timer);
    }

    this.movement_timer = setTimeout(function () {
        this.moving = false;
    }, 2000);

    switch (status.stat) {
        case this.driver.STAT_INTERLOCK:
        case this.driver.STAT_SHUTDOWN:
        case this.driver.STAT_PANIC:
            this.emit("crash");
            break;
        case this.driver.STAT_ALARM:
            // no handler in manual
            break;
        case this.driver.STAT_RUNNING:
            this.moving = true;
            break;
        case this.driver.STAT_STOP:
            this.stop_pending = false;
        // Fall through is intended here, do not add a break
        case this.driver.STAT_END:
        case this.driver.STAT_HOLDING:
            // Handle nudges once we've come to a stop
            if (this._handleNudges()) {
                // Nudges got handled
            } else {
                // extra flushes may be coming from here
                this.stop_pending = false;
                if (!this.driver.pause_hold && this.driver.status.hold === 0) {
                    this.driver._write("%\n"); // flush feed-hold and get stat
                }
                if (this.exit_pending) {
                    this.exit();
                }
            }
            break;
    }
};

// Internal call that is issued when manual mode is done
// Resolves the promise created by the enter() function and resets internal state
ManualDriver.prototype._done = function () {
    this.moving = false;
    this.keep_moving = false;
    this.stream = null;
    this.entered = false;
    this.exiting = false; // Reset the flag
    if (this._promiseResolve) {
        this._promiseResolve();
        this._promiseResolve = null;
        this._promiseReject = null;
    }
};

module.exports = ManualDriver;
