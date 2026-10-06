/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/*
 * machine_config.js
 *
 * Covers "machine" settings.  Separate from engine settings, which are settings related to how
 *  the server software works specifically.
 * The MACHINE configuration stores information about the tool as a CNC machine - settings related
 *  to speeds, tool dimensions, how things are setup. Some of this information is shared with and used by
 *  the G2 firmware and must be kept "harmonized". In some cases, the shared data is just copied (e.g. envelope values);
 *  in other cases, it is modified for use in G2 (e.g. input definitions in machine {di#ac} are converted to action
 *  definitions {di#ac} in G2). This action all happens in: MachineConfig.prototype.update.
 *  [Note that there are a few similar shares between the openSBP runtime and G2].
 *  [Also note that some values that are used in the manual runtime are managed here even though not really conceptually consistent.]
 */

let MAX_INPUTS = 15;

var fs = require("fs");
var config = require("../config");
var Config = require("./config").Config;
var log = require("../log").logger("machine_config");
var u = require("../util");

var MachineConfig = function () {
    Config.call(this, "machine");
};
util.inherits(MachineConfig, Config);

// Client config posts arrive form-encoded, so arrays round-trip as
// numeric-keyed objects ({"0": ..., "1": ...}). Rebuild the keepout
// arrays — zones, each poly's pts, and each pt's [x, y] pair — so the
// stored shape always matches what bounds.checkAgainstZones and the
// apps expect. Applied to incoming updates and, at init, to data a
// pre-fix engine already stored in the mangled shape.
function normalizeKeepout(keepout) {
    function toArray(v) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === "object") {
            return Object.keys(v)
                .filter(function (k) {
                    return /^\d+$/.test(k);
                })
                .sort(function (a, b) {
                    return a - b;
                })
                .map(function (k) {
                    return v[k];
                });
        }
        return [];
    }
    if (!keepout || typeof keepout !== "object") return { zones: [] };
    var zones = toArray(keepout.zones)
        .filter(function (z) {
            return z && (z.type === "rect" || z.type === "poly");
        })
        .map(function (z) {
            if (z.type === "poly") {
                z.pts = toArray(z.pts).map(function (p) {
                    var pair = toArray(p);
                    return [Number(pair[0]) || 0, Number(pair[1]) || 0];
                });
            }
            return z;
        });
    return { zones: zones, savedAt: keepout.savedAt };
}

MachineConfig.prototype.init = function (machine, callback) {
    this.machine = machine;
    // Capture whether the saved user config predates machine.features
    // BEFORE the base init runs -- init merges in the defaults and saves,
    // so afterwards the file always has the key. Used by the one-time
    // ATC migration below. Treat a missing/corrupt user file as a fresh
    // install (no migration; the profile's own config carries the flag).
    var savedHadFeatures = true;
    // Envelope block of the saved user config, captured for the same
    // reason: base init merges profile defaults for missing keys, so by
    // the time the callback runs we can no longer tell which envelope
    // size fields the user's file actually had. null = fresh install.
    var savedEnvelope = null;
    try {
        var savedCfg = JSON.parse(fs.readFileSync(this.getConfigFile(), "utf8"));
        savedHadFeatures = "features" in savedCfg;
        savedEnvelope = savedCfg.envelope || {};
    } catch (e) {
        // fresh install or unreadable file - no migration needed
    }
    Config.prototype.init.call(
        this,
        function (err) {
            // Seed any newly-added top-level fields so util.extend's
            // "only-existing-keys" rule accepts client updates. For installs
            // predating this field, the cache wouldn't have it and POSTs to
            // /config would silently drop it.
            if (this._cache && this._cache.keepout) {
                this._cache.keepout = normalizeKeepout(this._cache.keepout);
            }
            // Seed per-axis table sizes (envelope.xsize/ysize/zsize).
            // min/max are soft limits and include overtravel, so max - min
            // overstates the physical table; the table itself spans machine
            // 0..size and the previewer/AR draw that. Sizes are display-only:
            // they are never pushed to G2 (soft limits stay on min/max).
            //
            // On a fresh install the profile's sizes are already correct.
            // On an existing install (savedEnvelope captured above) base
            // init has just merged the PROFILE's sizes in over the user's
            // envelope — wrong for any machine whose envelope differs from
            // the profile. Overwrite any size the user's file didn't have
            // with that machine's own span, so nothing changes on-screen
            // until the true size is entered.
            if (this._cache && this._cache.envelope) {
                var env = this._cache.envelope;
                var sizesChanged = false;
                [
                    ["xsize", "xmin", "xmax"],
                    ["ysize", "ymin", "ymax"],
                    ["zsize", "zmin", "zmax"],
                ].forEach(function (axis) {
                    var missing = savedEnvelope ? !(axis[0] in savedEnvelope) : !(axis[0] in env);
                    if (missing) {
                        var lo = Number(env[axis[1]]) || 0;
                        var hi = Number(env[axis[2]]) || 0;
                        var span = Math.max(0, hi - lo);
                        if (env[axis[0]] !== span) {
                            env[axis[0]] = span;
                            sizesChanged = true;
                        }
                    }
                });
                if (sizesChanged) {
                    this.save(function () {});
                }
            }
            if (this._cache && !("cameraCalibration" in this._cache)) {
                // util.extend only descends through existing keys; seed the
                // full nested shape so client updates merge cleanly.
                this._cache.cameraCalibration = {
                    corners: {
                        tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 },
                        br: { x: 0, y: 0 }, bl: { x: 0, y: 0 },
                    },
                    port: 0,
                    savedAt: 0,
                    calibrated: false,
                };
            }
            // Seed machine feature flags (ATC, laser, drag knife). These
            // gate which feature-specific macro sets the startup assembler
            // (macros.js installProfileMacros) installs from
            // profiles/default/macros/<feature>/.
            if (this._cache && !("features" in this._cache)) {
                this._cache.features = {
                    atc: false,
                    laser: false,
                    knife: false,
                };
            }
            // One-time migration for ATC machines already in the field:
            // their saved machine.json predates machine.features, so the
            // default (atc: false) wins even though their profile ships
            // the ATC macro set -- the profile's own machine.json (which
            // now carries atc: true) is only consulted on a profile
            // re-apply, not on update. Detect "field ATC machine that
            // hasn't seen this feature yet" as: the saved user config had
            // no features block before this boot (captured above) AND the
            // current profile name ends in "atc" (true of every ATC
            // profile's display and directory name).
            try {
                var profileName = Config.getCurrentProfile() || "";
                if (this._cache && !savedHadFeatures && /atc$/i.test(profileName.trim())) {
                    log.info("ATC profile detected on first boot with machine.features - enabling features.atc");
                    this._cache.features.atc = true;
                    this.save(function () {});
                }
            } catch (e) {
                log.warn("Could not check for ATC feature migration: " + e.message);
            }
            // Seed soft-limit safety buffer for the JGV (analog/velocity-jog)
            // path on installs predating this field. The value is an extra
            // distance subtracted from the raw margin before computing v_safe,
            // i.e. the tool stops with at least this much margin remaining.
            // Default 0 → stop right at the soft limit; the jerk-derived
            // v_safe formula in runtime/manual/driver.js handles deceleration
            // distance automatically.
            if (this._cache && this._cache.manual && !("softlimit_cushion" in this._cache.manual)) {
                this._cache.manual.softlimit_cushion = 0;
            }
            // Seed layout-orientation fields so the Configuration > Layout tab
            // can persist its assignments. util.extend only descends through
            // existing keys, so without these seeds a client POST silently
            // drops the new fields and the user's selection won't survive a
            // page refresh.
            if (this._cache && this._cache.manual && !("layout_mapping" in this._cache.manual)) {
                this._cache.manual.layout_mapping = {
                    "X+": "→",
                    "X-": "←",
                    "Y+": "↑",
                    "Y-": "↓"
                };
            }
            if (this._cache && this._cache.manual && !("layout_origin_corner" in this._cache.manual)) {
                this._cache.manual.layout_origin_corner = "bl";
            }
            if (this._cache && !("outputs" in this._cache)) {
                // Outputs 1, 2, 4 have hardcoded labels and runtime ignores
                // their policy. The other rows are configurable in the
                // configuration app's Outputs tab.
                var hardcoded = { "1": "Spindle 1", "2": "Spindle 2", "4": "Arm Motion" };
                this._cache.outputs = {};
                for (var i = 1; i <= 12; i++) {
                    this._cache.outputs[String(i)] = {
                        label: hardcoded[i] || ("Output " + i),
                        // Output 4 (Arm Motion) goes on at file start; everything
                        // else stays manual. All outputs auto-off at file end.
                        on_mode: i === 4 ? "file_start" : "command",
                        off_mode: "file_end",
                        on_seconds: 0,
                        off_seconds: 0,
                        notify_on: "never",
                        notify_off: "never",
                        notify_on_message: "",
                        notify_off_message: "",
                        on_position: { axis: "z", side: "below", value: 0 },
                        off_position: { axis: "z", side: "above", value: 0 },
                        on_input: { input: 1, state: "on" },
                        off_input: { input: 1, state: "off" },
                    };
                }
            }
            this._normalizeOutputNotify();
            this._normalizeOutputPosition();
            this._normalizeOutputInput();
            this._normalizeInputTypes();
            if (typeof callback === "function") callback(err);
        }.bind(this)
    );
};

// Convenience function that rounds a number to the appropriate number of decimals for the current unit type.
function round(number, units) {
    var decimals = units == "mm" ? 100 : 1000;
    return Math.round(number * decimals) / decimals;
}

// Normalize the per-output notify fields (machine.outputs.<n>.notify_on/
// notify_off + *_message). Called at init (older configs predate the fields
// or hold the early boolean form) and after every update (the /config route
// runs values through util.fixJSON, whose Number() coercion turns a cleared
// text field — "" — into 0).
MachineConfig.prototype._normalizeOutputNotify = function () {
    if (!this._cache || !this._cache.outputs) return;
    var normNotify = function (v) {
        if (v === "once" || v === "always") return v;
        if (v === true || v === 1) return "always";
        return "never";
    };
    for (var j = 1; j <= 12; j++) {
        var out = this._cache.outputs[String(j)];
        if (!out) continue;
        out.notify_on = normNotify(out.notify_on);
        out.notify_off = normNotify(out.notify_off);
        if (typeof out.notify_on_message !== "string") out.notify_on_message = "";
        if (typeof out.notify_off_message !== "string") out.notify_off_message = "";
    }
};

// Normalize/backfill the per-output position-trigger fields
// (machine.outputs.<n>.on_position/off_position: { axis, side, value }).
// Called at init (older configs predate the fields — and util.extend's
// only-existing-keys rule means client updates are dropped unless the nested
// shape exists in the cache) and after every update (fixJSON coercion).
MachineConfig.prototype._normalizeOutputPosition = function () {
    if (!this._cache || !this._cache.outputs) return;
    var normPos = function (p, defSide) {
        if (!p || typeof p !== "object") p = {};
        var axis = String(p.axis || "z").toLowerCase();
        if (axis.length !== 1 || "xyzabc".indexOf(axis) === -1) axis = "z";
        var side = p.side === "above" ? "above" : "below";
        if (p.side !== "above" && p.side !== "below") side = defSide;
        var value = Number(p.value);
        if (!isFinite(value)) value = 0;
        return { axis: axis, side: side, value: value };
    };
    for (var j = 1; j <= 12; j++) {
        var out = this._cache.outputs[String(j)];
        if (!out) continue;
        out.on_position = normPos(out.on_position, "below");
        out.off_position = normPos(out.off_position, "above");
    }
};

// Normalize/backfill the per-output input-trigger fields
// (machine.outputs.<n>.on_input/off_input: { input, state }). Same rationale
// as _normalizeOutputPosition: older configs predate the fields, and the
// nested shape must exist in the cache for client updates to merge.
MachineConfig.prototype._normalizeOutputInput = function () {
    if (!this._cache || !this._cache.outputs) return;
    var normInput = function (p, defState) {
        if (!p || typeof p !== "object") p = {};
        var input = Math.round(Number(p.input));
        if (!(input >= 1 && input <= 12)) input = 1;
        var state = p.state === "on" || p.state === "off" ? p.state : defState;
        return { input: input, state: state };
    };
    for (var j = 1; j <= 12; j++) {
        var out = this._cache.outputs[String(j)];
        if (!out) continue;
        out.on_input = normInput(out.on_input, "on");
        out.off_input = normInput(out.off_input, "off");
    }
};

// Valid values for the per-input "type" (semantic role) setting,
// machine.di<N>type — what the switch physically is, so apps/routines can
// find an input by role rather than hardcoded number.
var INPUT_TYPES = {
    none: true,
    x_limit: true,
    y_limit: true,
    z_limit: true,
    a_limit: true,
    b_limit: true,
    c_limit: true,
    zzero_plate: true,
    toolbar_present: true,
    toolbar_up: true,
    drawbar_open: true,
    tool_present: true,
};
var INPUT_TYPE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15];

// Seed/normalize machine.di<N>type. Seeding matters because util.extend's
// only-existing-keys rule silently drops client updates for keys absent
// from the cache; normalization guards against fixJSON coercion.
MachineConfig.prototype._normalizeInputTypes = function () {
    if (!this._cache) return;
    INPUT_TYPE_NUMBERS.forEach(
        function (n) {
            var key = "di" + n + "type";
            if (!INPUT_TYPES[this._cache[key]]) this._cache[key] = "none";
        }.bind(this)
    );
};

// Normalize machine.features.* to booleans. fixJSON's Number() coercion
// turns a posted boolean true/false into 1/0, and the config app's
// checkbox pattern posts the strings "true"/"false".
MachineConfig.prototype._normalizeFeatures = function () {
    if (!this._cache || !this._cache.features) return;
    var features = this._cache.features;
    Object.keys(features).forEach(function (k) {
        features[k] = features[k] === true || features[k] === 1 || features[k] === "true";
    });
};

MachineConfig.prototype.update = function (data, callback, force) {
    var current_units = this.get("units"); // Get BEFORE extending cache
    // Stringify BEFORE extending -- get() returns a reference into the
    // cache, so the object itself mutates in place during extend.
    var old_features = JSON.stringify(this.get("features") || {});
    try {
        // keepout holds an ARRAY of user-drawn zones, which util.extend
        // can't handle: it only updates keys that already exist, so new
        // array indices (and the key itself, on installs predating the
        // field) are silently dropped. Replace it wholesale instead.
        if (data && Object.prototype.hasOwnProperty.call(data, "keepout")) {
            this._cache.keepout = normalizeKeepout(data.keepout);
            data = Object.assign({}, data);
            delete data.keepout;
        }
        u.extend(this._cache, data, force);
        this._normalizeOutputNotify();
        this._normalizeOutputPosition();
        this._normalizeOutputInput();
        this._normalizeInputTypes();
        this._normalizeFeatures();
    } catch (e) {
        return callback(e);
    }

    // When a feature flag (machine.features.atc/laser/knife) changes from
    // the dashboard, install that feature's shipped macros right away so
    // the user doesn't need a restart. userConfigLoaded distinguishes
    // runtime updates from the startup load sequence, where the installer
    // runs from engine.js once everything is up. Install is additive
    // (copy-if-not-exists); disabling a feature leaves its macros in place.
    if (this.userConfigLoaded && JSON.stringify(this._cache.features || {}) !== old_features) {
        var macros = require("../macros");
        macros.installProfile(function (err) {
            if (err) {
                return log.warn("Feature-macro install failed: " + err);
            }
            macros.load(function (err) {
                if (err) {
                    log.warn("Macro reload after feature change failed: " + err);
                }
            });
        });
    }
    var new_units = this.get("units"); // Get AFTER extending cache

    // Skip conversion if file is a default profile config OR if we're loading an actual config just after a default
    var isStartupSequence =
        this._filename &&
        (this._filename.includes("/profiles/default/") ||
            (this._filename.includes("/opt/fabmo/config/") && this._lastLoadWasDefault));

    if (this._filename && this._filename.includes("/profiles/default/")) {
        this._lastLoadWasDefault = true;
    } else if (this._filename && this._filename.includes("/opt/fabmo/config/")) {
        this._lastLoadWasDefault = false;
    }

    // Convert internal values for machine that are in length units back and forth between the two unit
    // systems if the unit systems has changed.
    //
    // IMPORTANT: Only convert values that were NOT explicitly supplied in `data`.  When a value is
    // present in the incoming data alongside a units change (e.g. during a full config restore from a
    // .fmc backup), the supplied value is already in the target unit system and must not be converted
    // again.  Only cache values that were carried over from the old unit system (i.e. NOT in `data`)
    // need the multiplier applied.
    if (current_units && new_units && current_units !== new_units && !isStartupSequence) {
        // Always record the pre-update unit as last_units so that apply() →
        // setPreferredUnits() sees a genuine mismatch and syncs G2's gun
        // register.  Without this, a full config restore where the backup
        // already has last_units == units (e.g. both "mm") causes
        // setPreferredUnits to skip the G2 unit change entirely, leaving G2
        // in the old unit while machine.json reflects the new one.
        this._cache.last_units = current_units;

        var conv = new_units == "mm" ? 25.4 : 1 / 25.4;
        var incomingEnvelope = (data && data.envelope) ? data.envelope : {};
        var incomingManual   = (data && data.manual)   ? data.manual   : {};

        ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax", "xsize", "ysize", "zsize"].forEach(
            function (key) {
                if (!(key in incomingEnvelope) && key in this._cache.envelope) {
                    this._cache.envelope[key] = round(this._cache.envelope[key] * conv, new_units);
                }
            }.bind(this)
        );

        [
            "xy_speed",
            "z_speed",
            "xy_increment",
            "z_increment",
            "abc_increment",
            "xy_min",
            "xy_max",
            "xy_jerk",
            "z_jerk",
            "z_fast_speed",
            "z_slow_speed",
            "softlimit_cushion",
        ].forEach(
            function (key) {
                if (!(key in incomingManual)) {
                    this._cache.manual[key] = round(this._cache.manual[key] * conv, new_units);
                }
            }.bind(this)
        );

        // Position-trigger thresholds are lengths for the linear axes; leave
        // rotary (a/b/c, degrees) values alone.
        var incomingOutputs = (data && data.outputs) || {};
        if (this._cache.outputs) {
            for (var n = 1; n <= 12; n++) {
                var out = this._cache.outputs[String(n)];
                if (!out) continue;
                ["on_position", "off_position"].forEach(function (key) {
                    var p = out[key];
                    if (!p || "xyz".indexOf(p.axis) === -1) return;
                    var incoming = incomingOutputs[String(n)];
                    if (incoming && incoming[key] && "value" in incoming[key]) return;
                    p.value = round(Number(p.value) * conv, new_units);
                });
            }
        }
    } else if (isStartupSequence) {
        log.debug("Skipping unit conversion during startup sequence");
    }

    ////## Re: Rob's 'Harmonize' Project -- These are 'machine' settings that are shared to G2 and maintained here

    //  Define Inputs for G2 -- Input functionality in FabMo and G2 overlap but differ in detail.
    //      For G2 use, the actions are simplified as none, stop, or fast-stop and current G2 values are set here.
    for (let i = 1; i < MAX_INPUTS + 1; i++) {
        let diDef = "di" + i + "ac";
        if (diDef in this._cache) {
            let g2inpAction = 0; // G2 action defaults to none
            switch (this._cache[diDef]) {
                case "stop":
                case "interlock":
                    g2inpAction = 1; // G2 regular stop action
                    break;
                case "driverFault":
                    g2inpAction = 1; // G2 feedhold action (same as interlock)
                    break;
                case "limit":
                case "faststop":
                    g2inpAction = 2; // G2 fast-stop action
                    break;
                case "halt":
                    g2inpAction = 3; // G2 immediate stop action (feedhold instant)
                    break;
                case "none":
                default:
                    g2inpAction = 0; // G2 none action    
            }
            this.machine.driver.command({ ["di" + i + "ac"]: g2inpAction });
        }
    }

    //  Define Envelope for G2 (G2 stores travel limits in mm internally)
    var envConv = this._cache.units === "in" ? 25.4 : 1;
    if ("xmin" in this._cache.envelope) {
        this.machine.driver.command({ xtn: this._cache.envelope["xmin"] * envConv });
    }
    if ("xmax" in this._cache.envelope) {
        this.machine.driver.command({ xtm: this._cache.envelope["xmax"] * envConv });
    }
    if ("ymin" in this._cache.envelope) {
        this.machine.driver.command({ ytn: this._cache.envelope["ymin"] * envConv });
    }
    if ("ymax" in this._cache.envelope) {
        this.machine.driver.command({ ytm: this._cache.envelope["ymax"] * envConv });
    }
    if ("zmin" in this._cache.envelope) {
        this.machine.driver.command({ ztn: this._cache.envelope["zmin"] * envConv });
    }
    if ("zmax" in this._cache.envelope) {
        this.machine.driver.command({ ztm: this._cache.envelope["zmax"] * envConv });
    }
    if ("limits_on" in this._cache) {
        this.machine.driver.command({ lim: this._cache.limits_on ? 1 : 0 });
    }
    // FabMo handles manual-mode soft limits; ensure G2's are off so they don't
    // double-fire alarms during jogs.
    this.machine.driver.command({ sl: 0 });

    this.save(function (err, result) {
        if (err) {
            callback(err);
        } else {
            callback(null, data);
        }
    });
};

// Apply this configuration.
//   callback - Called once everything has been applied, or with error.
MachineConfig.prototype.apply = function (callback) {
    // If we disable authorization, authorize indefinitely.  If we enabled it, revoke it.
    if (this.get("auth_timeout") === 0) {
        this.machine.authorize();
    } else {
        this.machine.deauthorize();
    }

    // Apply units (The machine will only apply these if there was an actual change)
    this.machine.setPreferredUnits(this.get("units"), this.get("last_units"), callback);
};

exports.MachineConfig = MachineConfig;
