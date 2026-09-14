/*
 * Tool Status app
 *
 * Split layout: a slim job manager on the left (pending queue + run next +
 * recent history), machine/tool commands on the right — SB4's standard
 * buttons (Home XY = C3, Home Z = C2, Jog Home = JH, Jog to Park = C79),
 * plus a tool row (1..$ATC.numClips) for rack-style ATC types and
 * Measure Tool (C72).
 *
 * Data sources:
 *   - opensbp persistent variables (config.opensbp.variables): $ATC.* nested
 *     under "ATC" ({TYPE, TOOLIN, NUMCLIPS, ...}), sensor input assignments
 *     (TOOLBAR_SENSOR, TOOL_SENSOR, DRAWBAR_SENSOR), per-tool offset table
 *     (TOOLSUU, dual-unit: {"0": inches, "1": mm}).
 *   - driver config g55x/y/z: working-zero offsets (FabMo runs in G55).
 *   - live status: posx/y/z, inN sensor states, machine state.
 *   - job queue/history via getQueueAndHistory, refreshed on job_start /
 *     job_end / change events.
 */
/* global $, FabMoDashboard */
"use strict";

var fabmo = new FabMoDashboard();

// $ATC.Type enum → display label.
var ATC_TYPE_LABELS = {
    0: "Manual Tool Change",
    1: "PRS3 ATC",
    2: "PRS4 ATC",
    3: "Desktop ATC",
    4: "Desktop MAX ATC V1",
    5: "5-axis",
    6: "PRS5 ATC",
    7: "Desktop MAX ATC V2",
};

// Types that get the numbered tool row (rack-style ATCs). 0 is manual and
// 5 (5-axis) has its own toolchange flow.
var TOOL_ROW_TYPES = { 1: true, 2: true, 3: true, 4: true, 6: true, 7: true };

var HISTORY_COUNT = 5;

var state = {
    machineState: null,
    unit: "in",
    vars: null, // opensbp variables (uppercase keys)
    g55: { x: 0, y: 0, z: 0 },
    pos: { x: null, y: null, z: null },
    inputs: {}, // inN -> 0/1
    queue: [],
    running: [],
    history: [],
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

function atcType() {
    return Number(atcVar("TYPE", 0));
}

function showToolRow() {
    return !!TOOL_ROW_TYPES[atcType()];
}

function isIdle() {
    return state.machineState === "idle";
}

// ---------------------------------------------------------------------------
// Rendering — status

function renderHeader() {
    var type = atcType();
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
        $("#current-tool-caption").text(h ? "length " + fmt(Number(h)) : "in spindle");
    } else {
        $num.text("—").addClass("empty");
        $("#current-tool-caption").text(showToolRow() ? "no tool in spindle" : "");
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
        $("#pos-" + ax).text(fmt(state.pos[ax]));
        $("#off-" + ax).text(fmt(state.g55[ax]));
    });
    $("#units-label").text(state.unit);
}

function renderToolRow() {
    if (!showToolRow()) {
        $("#card-tools").hide();
        return;
    }
    $("#card-tools").show();
    var clips = Number(atcVar("NUMCLIPS", 0));
    var current = Number(atcVar("TOOLIN", 0));
    var idle = isIdle();
    var table = toolTable();
    var $rack = $("#rack").empty();
    for (var n = 1; n <= clips; n++) {
        var h = (table[n] || {}).H;
        var $clip = $(
            '<div class="ts-clip" data-tool="' + n + '">' + n +
                '<div class="ts-clip-len">' + (h ? fmt(Number(h)) : "&nbsp;") + "</div>" +
                "</div>"
        );
        if (n === current) $clip.addClass("current");
        else if (!idle) $clip.addClass("disabled");
        $rack.append($clip);
    }
    $("#rack-note").text(idle ? "press a tool to load it" : "available when idle");
    $("#btn-measure").prop("disabled", !idle);
}

function renderCommands() {
    $(".machine-cmd").prop("disabled", !isIdle());
}

// ---------------------------------------------------------------------------
// Rendering — jobs

function jobMeta(job) {
    var d = new Date(job.created_at);
    var when =
        d.getMonth() + 1 + "/" + d.getDate() + " " +
        d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2);
    if (job.state === "pending") return when;
    var cls = job.state === "finished" ? "ok" : job.state;
    return when + ' &mdash; <span class="' + cls + '">' + job.state + "</span>";
}

function renderJobs() {
    var $q = $("#job-queue").empty();
    (state.running || []).forEach(function (job) {
        var $row = $(
            '<div class="ts-job next">' +
                '<div class="ts-job-info">' +
                    '<div class="ts-job-name"></div>' +
                    '<div class="ts-job-meta"><span class="ok">running&hellip;</span></div>' +
                "</div>" +
                "</div>"
        );
        $row.find(".ts-job-name").text(job.name || "job " + job._id);
        $q.append($row);
    });
    if (!state.queue.length && !(state.running || []).length) {
        $q.append('<div class="ts-empty">No jobs in queue</div>');
    } else {
        state.queue.forEach(function (job, i) {
            var $row = $(
                '<div class="ts-job' + (i === 0 ? " next" : "") + '">' +
                    '<div class="ts-job-info">' +
                        '<div class="ts-job-name"></div>' +
                        '<div class="ts-job-meta">' + jobMeta(job) + "</div>" +
                    "</div>" +
                    '<button class="ts-iconbtn ts-job-delete" title="Remove from queue">&#10005;</button>' +
                    "</div>"
            );
            $row.find(".ts-job-name").text(job.name || "job " + job._id);
            $row.find(".ts-job-delete").data("id", job._id);
            $q.append($row);
        });
    }
    $("#btn-run-next").prop("disabled", !state.queue.length || !isIdle());

    var $h = $("#job-history").empty();
    if (!state.history.length) {
        $h.append('<div class="ts-empty">No recent jobs</div>');
        return;
    }
    state.history.forEach(function (job) {
        var $row = $(
            '<div class="ts-job">' +
                '<div class="ts-job-info">' +
                    '<div class="ts-job-name"></div>' +
                    '<div class="ts-job-meta">' + jobMeta(job) + "</div>" +
                "</div>" +
                '<button class="ts-iconbtn ts-job-rerun" title="Add to queue again">&#8635;</button>' +
                "</div>"
        );
        $row.find(".ts-job-name").text(job.name || "job " + job._id);
        $row.find(".ts-job-rerun").data("id", job._id);
        $h.append($row);
    });
}

function renderAll() {
    renderHeader();
    renderCurrentTool();
    renderSensors();
    renderPosition();
    renderToolRow();
    renderCommands();
    renderJobs();
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

function refreshJobs() {
    fabmo.getQueueAndHistory({ start: 0, count: HISTORY_COUNT }, function (err, data) {
        if (err || !data) return;
        state.running = data.running || [];
        state.queue = data.pending || [];
        state.history = (data.history && data.history.data) || [];
        renderJobs();
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
    // Cheap live updates on every report; full re-render + config/job
    // re-read on state transitions (a finished toolchange/measure updates
    // TOOLIN and g55; a finished job updates the queue).
    renderPosition();
    renderSensors();
    if (stateChanged) {
        renderHeader();
        renderCommands();
        refreshConfig();
        refreshJobs();
    }
});

fabmo.on("job_start", refreshJobs);
fabmo.on("job_end", refreshJobs);
fabmo.on("change", function (topic) {
    if (topic === "jobs") refreshJobs();
});

function runCommand(cmd) {
    fabmo.runSBP(cmd + "\n", function (err) {
        if (err) fabmo.notify("error", err.message || err);
    });
}

$(document).ready(function () {
    refreshConfig();
    refreshJobs();
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

    // Machine buttons (SB4 equivalents)
    $(".machine-cmd").on("click", function () {
        if (!isIdle()) return;
        runCommand($(this).data("cmd"));
    });

    // Tool row: load tool N via the standard toolchange dispatcher
    $("#rack").on("click", ".ts-clip", function () {
        var tool = Number($(this).data("tool"));
        var current = Number(atcVar("TOOLIN", 0));
        if (tool === current || !isIdle()) return;
        if (!window.confirm("Change to Tool " + tool + "?")) return;
        runCommand("&Tool = " + tool + "\nC9");
    });

    $("#btn-measure").on("click", function () {
        if (!isIdle()) return;
        runCommand("C72");
    });

    // Jobs
    $("#btn-run-next").on("click", function () {
        if (!isIdle()) return;
        fabmo.runNext(function (err) {
            if (err) fabmo.notify("error", err.message || err);
        });
    });

    $("#btn-add-job").on("click", function () {
        $("#job-file-input").trigger("click");
    });
    $("#job-file-input").on("change", function () {
        var files = this.files;
        if (!files || !files.length) return;
        var jobs = [];
        for (var i = 0; i < files.length; i++) {
            jobs.push({ file: files[i] });
        }
        fabmo.submitJob(jobs, { stayHere: true }, function (err) {
            if (err) fabmo.notify("error", err.message || err);
            refreshJobs();
        });
        this.value = "";
    });

    $("#job-queue").on("click", ".ts-job-delete", function () {
        var id = $(this).data("id");
        fabmo.deleteJob(id, function (err) {
            if (err) fabmo.notify("error", err.message || err);
            refreshJobs();
        });
    });

    $("#job-history").on("click", ".ts-job-rerun", function () {
        var id = $(this).data("id");
        fabmo.resubmitJob(id, { stayHere: true }, function (err) {
            if (err) fabmo.notify("error", err.message || err);
            refreshJobs();
        });
    });
});
