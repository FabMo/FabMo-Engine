/*
 * Tool Status app
 *
 * Displays the machine's tool state — current tool, working offsets, ATC
 * rack — and offers one-press tool commands (change tool, measure, park...).
 *
 * Data sources:
 *   - opensbp persistent variables (config.opensbp.variables): $ATC.* nested
 *     under "ATC" ({TYPE, TOOLIN, NUMCLIPS, ...}), sensor input assignments
 *     (TOOLBAR_SENSOR, TOOL_SENSOR, DRAWBAR_SENSOR), per-tool offset table
 *     (TOOLSUU, dual-unit: {"0": inches, "1": mm}).
 *   - driver config g55x/y/z: working-zero offsets (FabMo runs in G55).
 *   - live status: posx/y/z, inN sensor states, machine state.
 *
 * Commands run the standard ShopBot macros: C9 (tool change dispatcher,
 * reads &Tool), C72 (measure tool), C73 (plate offset), C74 (ATC calibrate),
 * C79 (park). Motion commands confirm first and only enable at idle.
 */
/* global $, FabMoDashboard */
"use strict";

var fabmo = new FabMoDashboard();

// $ATC.Type enum → display label. 0 is the only value with fixed meaning
// (manual change); other codes identify ATC models. Extend as needed.
var ATC_TYPE_LABELS = {
    0: "Manual Tool Change",
    7: "ATC (DT-MAX)",
};

var state = {
    machineState: null,
    unit: "in",
    vars: null, // opensbp variables (uppercase keys)
    g55: { x: 0, y: 0, z: 0 },
    pos: { x: null, y: null, z: null },
    inputs: {}, // inN -> 0/1
};

// ---------------------------------------------------------------------------
// Variable access

function atcVar(name, dflt) {
    // Nested form ($ATC.ToolIn lives at variables.ATC.TOOLIN)
    var vars = state.vars || {};
    var atc = vars.ATC;
    if (atc && typeof atc === "object" && name in atc) return atc[name];
    // Legacy flat form ("ATC.TYPE")
    var flat = vars["ATC." + name];
    if (flat !== undefined) return flat;
    return dflt;
}

function unitIdx() {
    return state.unit === "mm" ? "1" : "0";
}

function toolTable() {
    // TOOLSUU: {unitIdx: {toolNumber: {X, Y, Z, H}}}
    var t = (state.vars || {}).TOOLSUU;
    return (t && t[unitIdx()]) || {};
}

function fmt(v) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return v.toFixed(state.unit === "mm" ? 2 : 3);
}

function isATC() {
    return Number(atcVar("TYPE", 0)) !== 0;
}

// ---------------------------------------------------------------------------
// Rendering

function renderHeader() {
    var type = Number(atcVar("TYPE", 0));
    $("#atc-type-badge").text(ATC_TYPE_LABELS[type] || "ATC (type " + type + ")");
    var st = state.machineState || "—";
    $("#machine-state")
        .text(st)
        .attr("class", "ts-badge ts-state " + st);
}

function renderCurrentTool() {
    var tool = Number(atcVar("TOOLIN", 0));
    var $num = $("#current-tool-number");
    if (tool >= 1) {
        $num.text(tool).removeClass("empty");
        var h = (toolTable()[tool] || {}).H;
        $("#current-tool-caption").text(h ? "measured length " + fmt(Number(h)) : "in spindle");
    } else {
        $num.text("—").addClass("empty");
        $("#current-tool-caption").text(isATC() ? "no tool in spindle" : "current tool not tracked");
    }
}

function renderSensors() {
    var defs = [
        { id: "#sensor-toolbar", input: state.vars && state.vars.TOOLBAR_SENSOR },
        { id: "#sensor-tool", input: state.vars && state.vars.TOOL_SENSOR },
        { id: "#sensor-drawbar", input: state.vars && state.vars.DRAWBAR_SENSOR },
    ];
    defs.forEach(function (d) {
        var n = Number(d.input);
        var $el = $(d.id);
        if (!(n >= 1)) {
            $el.hide();
            return;
        }
        $el.show();
        $el.find(".ts-led").toggleClass("on", !!state.inputs["in" + n]);
    });
}

function renderPosition() {
    ["x", "y", "z"].forEach(function (ax) {
        var pos = state.pos[ax];
        var off = state.g55[ax];
        $("#pos-" + ax).text(fmt(pos));
        $("#off-" + ax).text(fmt(off));
        $("#mach-" + ax).text(typeof pos === "number" ? fmt(pos + off) : "—");
    });
    $("#units-label").text("(" + state.unit + ")");
}

function renderRack() {
    if (!isATC()) {
        $("#card-rack").hide();
        return;
    }
    $("#card-rack").show();
    var clips = Number(atcVar("NUMCLIPS", 0));
    var current = Number(atcVar("TOOLIN", 0));
    var idle = state.machineState === "idle";
    var table = toolTable();
    var $rack = $("#rack").empty();
    for (var n = 1; n <= clips; n++) {
        var h = (table[n] || {}).H;
        var $clip = $(
            '<div class="ts-clip" data-tool="' + n + '">' +
                '<div class="ts-clip-num">' + n + "</div>" +
                '<div class="ts-clip-len">' + (h ? fmt(Number(h)) : "&nbsp;") + "</div>" +
                "</div>"
        );
        if (n === current) $clip.addClass("current");
        else if (!idle) $clip.addClass("disabled");
        $rack.append($clip);
    }
    $("#rack-note").text(idle ? "press a tool to change to it" : "tool change available when idle");
}

var COMMANDS = [
    { label: "Measure Current Tool", macro: 72, atcOnly: true, confirm: "Measure the current tool? The machine will move to the measurement plate." },
    { label: "Park", macro: 79, atcOnly: false, confirm: "Move the tool to the parking location?" },
    { label: "Plate Offset", macro: 73, atcOnly: true, confirm: "Set the measurement plate offset? Follow the prompts." },
    { label: "Calibrate ATC", macro: 74, atcOnly: true, confirm: "Run ATC clip-location calibration? This is a setup routine — continue?" },
];

function renderCommands() {
    var idle = state.machineState === "idle";
    var $c = $("#commands").empty();
    COMMANDS.forEach(function (cmd) {
        if (cmd.atcOnly && !isATC()) return;
        var $btn = $('<button class="ts-cmd"></button>').text(cmd.label).prop("disabled", !idle);
        $btn.on("click", function () {
            if (!window.confirm(cmd.confirm)) return;
            fabmo.runMacro(cmd.macro, function (err) {
                if (err) fabmo.notify("error", err.message || err);
            });
        });
        $c.append($btn);
    });
    $("#commands-note").text(idle ? "" : "Commands are available when the machine is idle.");
}

function renderAll() {
    renderHeader();
    renderCurrentTool();
    renderSensors();
    renderPosition();
    renderRack();
    renderCommands();
}

// ---------------------------------------------------------------------------
// Data refresh

function refreshConfig(callback) {
    fabmo.getConfig(function (err, data) {
        if (err || !data) return callback && callback(err);
        state.vars = (data.opensbp && data.opensbp.variables) || {};
        var d = data.driver || {};
        state.g55 = { x: Number(d.g55x) || 0, y: Number(d.g55y) || 0, z: Number(d.g55z) || 0 };
        renderAll();
        callback && callback(null);
    });
}

fabmo.on("status", function (status) {
    var stateChanged = status.state !== state.machineState;
    state.machineState = status.state;
    state.unit = status.unit || state.unit;
    state.pos = { x: status.posx, y: status.posy, z: status.posz };
    for (var k in status) {
        if (k.substring(0, 2) === "in" && !isNaN(Number(k.substring(2)))) {
            state.inputs[k] = status[k];
        }
    }
    // Cheap live updates on every report; full re-render + config re-read on
    // state transitions (a finished toolchange/measure updates TOOLIN, g55).
    renderPosition();
    renderSensors();
    if (stateChanged) {
        renderHeader();
        refreshConfig();
    }
});

$(document).ready(function () {
    refreshConfig();
    fabmo.requestStatus(function (err, status) {
        if (err || !status) return;
        state.machineState = status.state;
        state.unit = status.unit || state.unit;
        state.pos = { x: status.posx, y: status.posy, z: status.posz };
        renderAll();
    });
    // Backstop: variables can change without a machine state transition
    // (e.g. edited in another app).
    setInterval(refreshConfig, 10000);

    // Tool change from the rack
    $("#rack").on("click", ".ts-clip", function () {
        var tool = Number($(this).data("tool"));
        var current = Number(atcVar("TOOLIN", 0));
        if (tool === current) return;
        if (state.machineState !== "idle") return;
        if (!window.confirm("Change to Tool " + tool + "? The machine will move.")) return;
        fabmo.runSBP("&Tool = " + tool + "\nC9\n", function (err) {
            if (err) fabmo.notify("error", err.message || err);
        });
    });
});
