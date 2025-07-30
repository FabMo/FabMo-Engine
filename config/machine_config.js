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

let MAX_INPUTS = 12;

var config = require("../config");
var Config = require("./config").Config;
var log = require("../log").logger("machine_config");
var u = require("../util");

var MachineConfig = function () {
    Config.call(this, "machine");
};
util.inherits(MachineConfig, Config);

MachineConfig.prototype.init = function (machine, callback) {
    this.machine = machine;
    Config.prototype.init.call(this, callback);
};

// Convenience function that rounds a number to the appropriate number of decimals for the current unit type.
function round(number, units) {
    var decimals = units == "mm" ? 100 : 1000;
    return Math.round(number * decimals) / decimals;
}

MachineConfig.prototype.update = function (data, callback, force) {
    var current_units = this.get("units"); // Get BEFORE extending cache
    try {
        u.extend(this._cache, data, force);
    } catch (e) {
        return callback(e);
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
    if (current_units && new_units && current_units !== new_units && !isStartupSequence) {
        var conv = new_units == "mm" ? 25.4 : 1 / 25.4;

        ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"].forEach(
            function (key) {
                this._cache.envelope[key] = round(this._cache.envelope[key] * conv, new_units);
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
        ].forEach(
            function (key) {
                this._cache.manual[key] = round(this._cache.manual[key] * conv, new_units);
            }.bind(this)
        );
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
                case "limit":
                    g2inpAction = 1; // G2 regular stop action
                    break;
                case "faststop":
                    g2inpAction = 2; // G2 fast-stop action
                    break;
            }
            this.machine.driver.command({ ["di" + i + "ac"]: g2inpAction });
        }
    }

    //  Define Envelope for G2
    if ("xmin" in this._cache.envelope) {
        this.machine.driver.command({ xtn: this._cache.envelope["xmin"] });
    }
    if ("xmax" in this._cache.envelope) {
        this.machine.driver.command({ xtm: this._cache.envelope["xmax"] });
    }
    if ("ymin" in this._cache.envelope) {
        this.machine.driver.command({ ytn: this._cache.envelope["ymin"] });
    }
    if ("ymax" in this._cache.envelope) {
        this.machine.driver.command({ ytm: this._cache.envelope["ymax"] });
    }
    if ("zmin" in this._cache.envelope) {
        this.machine.driver.command({ ztn: this._cache.envelope["zmin"] });
    }
    if ("zmax" in this._cache.envelope) {
        this.machine.driver.command({ ztm: this._cache.envelope["zmax"] });
    }

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
