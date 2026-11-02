/*
 * flags.js
 *
 * Named, latching machine condition flags.
 *
 * A flag is a persistent boolean condition defined in the machine config
 * (machine.flags) that gets SET by an input edge, by engine startup, or
 * explicitly (OpenSBP SF command / REST), and stays set until explicitly
 * cleared. While set, a flag either just displays a persistent warning on
 * the dashboard ("warn") or additionally refuses to start job files
 * ("block_runs"). Macros are always allowed to run so that the recovery
 * procedure (typically a homing macro ending in SF,"NAME",0) can execute.
 *
 * Flag definition shape (machine config, machine.flags.<NAME>):
 *   {
 *     "label":   "Driver Fault",                  // short display name
 *     "message": "Re-home the machine ...",       // operator guidance
 *     "action":  "block_runs",                    // or "warn"
 *     "input":   15,                              // optional input binding
 *     "edge":    "on",                            // "on" (inactive->active)
 *                                                 // or "off" (active->inactive)
 *     "set_on_startup": true                      // latch on engine start
 *   }
 *
 * Flag STATE is runtime data, persisted in the instance config so an engine
 * restart cannot launder a latched condition away. Active flags are published
 * to clients as status.flags = { NAME: {label, message, action, at, source} }.
 *
 * A flag bound to an input cannot be cleared while that input is still in
 * its triggering state — clearing requires the physical condition to be gone.
 */
var log = require("./log").logger("flags");
var config = require("./config");

var machine = null; // set by initialize()
var state = {}; // name -> { set: bool, at: ms, source: string }
var lastInputs = {}; // "in<N>" -> 0|1, for edge detection

function definitions() {
    var defs = config.machine ? config.machine.get("flags") : null;
    return defs && typeof defs === "object" ? defs : {};
}

function isSet(name) {
    return !!(state[name] && state[name].set);
}

// Persist flag state in the instance config (best-effort: the instance
// config is only configured when the motion system is connected).
function persist() {
    try {
        if (config.instance && typeof config.instance.update === "function") {
            config.instance.update({ flags: state }, function (err) {
                if (err) {
                    log.warn("Could not persist flag state: " + err);
                }
            });
        }
    } catch (e) {
        log.warn("Could not persist flag state: " + e);
    }
}

// Rebuild status.flags (active flags only) and push a status update.
function publish() {
    if (!machine) {
        return;
    }
    var defs = definitions();
    var active = {};
    Object.keys(defs).forEach(function (name) {
        if (isSet(name)) {
            var def = defs[name] || {};
            active[name] = {
                label: def.label || name,
                message: def.message || "",
                action: def.action === "block_runs" ? "block_runs" : "warn",
                at: state[name].at,
                source: state[name].source,
            };
        }
    });
    machine.status.flags = active;
    machine.emit("status", machine.status);
}

// Set a flag. Returns {} on success or {error: "..."}.
function set(name, source) {
    var def = definitions()[name];
    if (!def) {
        return { error: "No such flag: " + name };
    }
    if (isSet(name)) {
        return {}; // already latched; nothing to do
    }
    state[name] = { set: true, at: Date.now(), source: source || "api" };
    log.warn("Flag SET: " + name + " (" + state[name].source + ")");
    persist();
    // Surface a one-time info message right away; the persistent banner is
    // driven by status.flags on the dashboard side.
    machine.info_id += 1;
    machine.status.info = {
        id: machine.info_id,
        message: (def.label || name) + ": " + (def.message || "Condition flag set."),
    };
    publish();
    return {};
}

// Clear a flag. Refused while the bound input is still in its triggering
// state. Returns {} on success or {error: "..."}.
function clear(name, source) {
    var def = definitions()[name];
    if (!def) {
        return { error: "No such flag: " + name };
    }
    if (!isSet(name)) {
        return {}; // already clear
    }
    if (def.input !== undefined && def.input !== null && machine && machine.driver && machine.driver.status) {
        var cur = machine.driver.status["in" + def.input] ? 1 : 0;
        var triggering = def.edge === "off" ? 0 : 1;
        if (cur === triggering) {
            return {
                error:
                    "Cannot clear flag " +
                    name +
                    ": input " +
                    def.input +
                    " is still " +
                    (triggering ? "active" : "inactive") +
                    ". Resolve the condition first.",
            };
        }
    }
    state[name] = { set: false, at: Date.now(), source: source || "api" };
    log.info("Flag CLEARED: " + name + " (" + state[name].source + ")");
    persist();
    publish();
    return {};
}

// Edge-detect flag-bound inputs across driver status reports. Called from
// the machine's driver "status" handler. The first report only seeds the
// last-seen values so a boot-time active input doesn't count as an edge
// (use set_on_startup for conditions that must latch across a restart).
function checkInputs(stat) {
    var defs = definitions();
    var names = Object.keys(defs);
    if (names.length === 0) {
        return;
    }
    // Compute edges for every watched input first, then update lastInputs,
    // so two flags watching the same input both see the transition.
    var edges = {}; // "in<N>" -> {prev, cur}
    names.forEach(function (name) {
        var def = defs[name];
        if (!def || def.input === undefined || def.input === null) {
            return;
        }
        var key = "in" + def.input;
        if (!(key in stat) || key in edges) {
            return;
        }
        edges[key] = { prev: lastInputs[key], cur: stat[key] ? 1 : 0 };
    });
    Object.keys(edges).forEach(function (key) {
        lastInputs[key] = edges[key].cur;
    });
    names.forEach(function (name) {
        var def = defs[name];
        if (!def || def.input === undefined || def.input === null) {
            return;
        }
        var edge = edges["in" + def.input];
        if (!edge || edge.prev === undefined || edge.prev === edge.cur) {
            return;
        }
        var fires = def.edge === "off" ? edge.cur === 0 : edge.cur === 1;
        if (fires && !isSet(name)) {
            set(name, "input " + def.input);
        }
    });
}

// The first defined, set flag whose action is block_runs — or null.
function getBlockingFlag() {
    var defs = definitions();
    var names = Object.keys(defs);
    for (var i = 0; i < names.length; i++) {
        if (isSet(names[i]) && defs[names[i]].action === "block_runs") {
            var def = defs[names[i]];
            return {
                name: names[i],
                label: def.label || names[i],
                message: def.message || "",
            };
        }
    }
    return null;
}

// Wire up the flags system: restore persisted state, latch any
// set_on_startup flags (engine start = Pi reboot or engine restart —
// positional trust is gone either way), and publish to status.
function initialize(m) {
    machine = m;
    var defs = definitions();
    var saved = {};
    try {
        saved = (config.instance && config.instance.get("flags")) || {};
    } catch (e) {
        saved = {};
    }
    state = {};
    Object.keys(defs).forEach(function (name) {
        if (defs[name] && defs[name].set_on_startup) {
            state[name] = { set: true, at: Date.now(), source: "startup" };
        } else if (saved[name] && saved[name].set) {
            state[name] = saved[name];
        }
    });
    var active = Object.keys(state).filter(isSet);
    if (active.length) {
        log.warn("Flags active at startup: " + active.join(", "));
    }
    persist();
    publish();
}

// Snapshot for the REST route: all definitions plus current state.
function summary() {
    var defs = definitions();
    var out = {};
    Object.keys(defs).forEach(function (name) {
        out[name] = {
            definition: defs[name],
            set: isSet(name),
            at: state[name] ? state[name].at : null,
            source: state[name] ? state[name].source : null,
        };
    });
    return out;
}

exports.initialize = initialize;
exports.checkInputs = checkInputs;
exports.set = set;
exports.clear = clear;
exports.isSet = isSet;
exports.getBlockingFlag = getBlockingFlag;
exports.summary = summary;
