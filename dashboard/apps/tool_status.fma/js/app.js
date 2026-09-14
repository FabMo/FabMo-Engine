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

// ---------------------------------------------------------------------------
// Tool info ($TOOLINFO.<n> = {TYPE, DIA, LEN, ANG}, written by the tool
// settings modal; values in whatever units they were entered in)

var CUTTER_TYPES = [
    { value: "", label: "—" },
    { value: "flat", label: "Flat" },
    { value: "vbit", label: "V-Bit" },
    { value: "ballnose", label: "Ballnose" },
    { value: "taperball", label: "Tapered Ballnose" },
];
var CUTTER_SHORT = { flat: "Flat", vbit: "V-Bit", ballnose: "Ballnose", taperball: "T-Ball" };
var ANGLE_TYPES = { vbit: true, taperball: true };

function toolInfo(n) {
    var ti = (state.vars || {}).TOOLINFO;
    return (ti && ti[String(n)]) || null;
}

// Concatenated display name, e.g. "0.25 V-Bit 90°". Empty string when the
// tool has no cutter type set (fixJSON can coerce cleared fields to 0, so
// any non-string / falsy TYPE reads as unset).
function nameFromInfo(info) {
    if (!info || typeof info.TYPE !== "string" || !info.TYPE) return "";
    var parts = [];
    var dia = Number(info.DIA);
    if (isFinite(dia) && dia > 0) parts.push(String(dia));
    parts.push(CUTTER_SHORT[info.TYPE] || info.TYPE);
    var ang = Number(info.ANG);
    if (ANGLE_TYPES[info.TYPE] && isFinite(ang) && ang > 0) parts.push(ang + "°");
    return parts.join(" ");
}

function toolName(n) {
    return nameFromInfo(toolInfo(n));
}

// ---------------------------------------------------------------------------
// Dual-unit table access ($xxUU = {"0": inches, "1": mm} — the standard
// macro-variable convention; saves write both slots)

function uuGet(varName, field) {
    var t = (state.vars || {})[varName];
    var slot = t && t[unitIdx()];
    var v = slot && Number(slot[field]);
    return typeof v === "number" && isFinite(v) ? v : null;
}

// Build a full dual-unit table for fields entered in the CURRENT units.
function uuBoth(fields) {
    var toMM = state.unit !== "mm";
    var here = {};
    var there = {};
    for (var k in fields) {
        var v = Number(fields[k]);
        here[k] = v;
        there[k] = Math.round(v * (toMM ? 25.4 : 1 / 25.4) * 10000) / 10000;
    }
    var out = {};
    out[unitIdx()] = here;
    out[unitIdx() === "0" ? "1" : "0"] = there;
    return out;
}

// The Home Z button: optionally lift to safe-Z and jog to the configured
// fixed XY location (new $SB_ZZEROLOCUU / $SB_ZZEROLOC_USE variables)
// before running C2.
function homeZCommand() {
    if (Number((state.vars || {}).SB_ZZEROLOC_USE)) {
        var x = uuGet("SB_ZZEROLOCUU", "X");
        var y = uuGet("SB_ZZEROLOCUU", "Y");
        if (x !== null && y !== null) {
            var parts = [];
            // Lift first unless already at/above safe-Z (JZ is absolute — an
            // unconditional JZ would jog DOWN from a higher position).
            var safeZ = Number((state.vars || {}).SB_SAFE_Z);
            if (isFinite(safeZ) && !(typeof state.pos.z === "number" && state.pos.z >= safeZ)) {
                parts.push("JZ, " + safeZ);
            }
            parts.push("J2, " + x + ", " + y, "C2");
            return parts.join("\n");
        }
    }
    return "C2";
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
        var bits = [];
        var name = toolName(tool);
        if (name) bits.push(name);
        if (h) bits.push("len " + fmt(Number(h)));
        $("#current-tool-caption").text(bits.join(" · ") || "in spindle");
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
        var name = toolName(n);
        var sub = name || (h ? fmt(Number(h)) : "");
        var $clip = $(
            '<div class="ts-clip" data-tool="' + n + '">' + n +
                '<div class="ts-clip-len"></div>' +
                "</div>"
        );
        var $len = $clip.find(".ts-clip-len");
        if (sub) $len.text(sub);
        else $len.html("&nbsp;");
        var tip = [name, h ? "len " + fmt(Number(h)) : ""].filter(Boolean).join(" · ");
        if (tip) $clip.attr("title", tip);
        if (n === current) $clip.addClass("current");
        else if (!idle) $clip.addClass("disabled");
        $rack.append($clip);
    }
    $("#rack-note").text(idle ? "press a tool to load it" : "available when idle");
    $("#btn-measure").prop("disabled", !idle);
}

// ---------------------------------------------------------------------------
// Custom macro buttons ($TS_MACRO_BUTTONS — stored as a JSON string so saves
// replace the whole list atomically; util.extend's index-wise array merge
// would otherwise leave stale entries behind on deletion)

function customButtons() {
    var s = (state.vars || {}).TS_MACRO_BUTTONS;
    if (typeof s !== "string" || !s) return [];
    try {
        var a = JSON.parse(s);
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

function saveCustomButtons(list, callback) {
    fabmo.setConfig(
        { opensbp: { variables: { TS_MACRO_BUTTONS: JSON.stringify(list) } } },
        function (err) {
            if (err) fabmo.notify("error", err.message || err);
            refreshConfig(callback);
        }
    );
}

function renderCustomButtons() {
    var $grid = $("#machine-btn-grid");
    $grid.find(".ts-dyn").remove();
    customButtons().forEach(function (b) {
        var macro = Number(b.macro);
        if (!(macro >= 1)) return;
        var $btn = $('<button class="ts-cmd machine-cmd ts-dyn"></button>')
            .attr("data-cmd", "C" + macro)
            .attr("title", "Run macro " + macro)
            .text(b.label || "Macro " + macro);
        $grid.append($btn);
    });
    $grid.append('<button class="ts-cmd ts-dyn ts-cmd-add" id="btn-add-macro" title="Add a macro button">+ Add</button>');
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

var dragging = false;

function renderJobs() {
    if (dragging) return; // don't rebuild the list out from under a drag
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
                '<div class="ts-job ts-job-sortable' + (i === 0 ? " next" : "") + '">' +
                    '<span class="ts-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>' +
                    '<div class="ts-job-info">' +
                        '<div class="ts-job-name"></div>' +
                        '<div class="ts-job-meta">' + jobMeta(job) + "</div>" +
                    "</div>" +
                    '<button class="ts-iconbtn ts-job-preview" title="Preview"><i class="fa fa-eye"></i></button>' +
                    '<button class="ts-iconbtn ts-job-edit" title="View code (edit)"><i class="fa fa-code"></i></button>' +
                    '<button class="ts-iconbtn ts-job-delete" title="Remove from queue"><i class="fa fa-trash"></i></button>' +
                    "</div>"
            );
            $row.attr("data-id", job._id);
            $row.find(".ts-job-name").text(job.name || "job " + job._id);
            $row.find(".ts-iconbtn").data("id", job._id);
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
        $h.append(historyRow(job));
    });
}

// ---------------------------------------------------------------------------
// USB file browser (below the Jobs card): scrollable list of cuttable files
// (.sbp/.nc/.tap) on any connected USB drive; folders navigable; clicking a
// file adds it to the job queue via /usb/submit.

var USB_FILE_RE = /\.(sbp|nc|tap)$/i;
var usb = {
    devices: [],
    cwd: null, // current directory path, null = drive list (or auto-entered single drive)
    root: null, // root path of the drive we're inside (bounds "up")
};

function fmtSize(bytes) {
    var n = Number(bytes);
    if (!isFinite(n)) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function usbEntry(icon, name, meta) {
    var $e = $(
        '<div class="ts-usb-entry">' +
            '<i class="fa ' + icon + '"></i>' +
            '<span class="ts-usb-name"></span>' +
            '<span class="ts-usb-meta"></span>' +
            "</div>"
    );
    $e.find(".ts-usb-name").text(name);
    $e.find(".ts-usb-meta").text(meta || "");
    return $e;
}

function renderUSBDeviceList() {
    var $list = $("#usb-list").empty();
    $("#usb-crumb").text("");
    usb.devices.forEach(function (dev) {
        var $e = usbEntry("fa-usb", dev.name, "drive");
        $e.on("click", function () {
            enterUSBDir(dev.path, dev.path);
        });
        $list.append($e);
    });
}

function enterUSBDir(path, root) {
    fabmo.getUSBDirectory(path, function (err, res) {
        if (err) return fabmo.notify("error", err.message || err);
        usb.cwd = path;
        usb.root = root;
        var contents = (res && (res.contents || res)) || [];
        var $list = $("#usb-list").empty();

        // Breadcrumb: drive name + relative path
        var rel = path.substring(path.lastIndexOf("/", usb.root.length - 1) + 1);
        $("#usb-crumb").text(rel);

        // Up: to parent dir, or back to the drive list at drive root
        var $up = usbEntry("fa-level-up", "..", "");
        $up.on("click", function () {
            if (usb.cwd === usb.root) {
                usb.cwd = usb.root = null;
                if (usb.devices.length === 1) refreshUSB(true);
                else renderUSBDeviceList();
            } else {
                enterUSBDir(usb.cwd.substring(0, usb.cwd.lastIndexOf("/")), usb.root);
            }
        });
        // Hide "up" when a single auto-entered drive is at its root
        if (!(usb.devices.length === 1 && usb.cwd === usb.root)) $list.append($up);

        contents.forEach(function (entry) {
            if (entry.isDirectory) {
                var $d = usbEntry("fa-folder", entry.name, "");
                $d.on("click", function () {
                    enterUSBDir(entry.path, usb.root);
                });
                $list.append($d);
            } else if (USB_FILE_RE.test(entry.name)) {
                var $f = usbEntry("fa-file-o", entry.name, fmtSize(entry.size));
                $f.attr("title", "Add " + entry.name + " to the job queue");
                $f.on("click", function () {
                    fabmo.submitUSBFile(entry.path, {}, function (err) {
                        if (err) return fabmo.notify("error", err.message || err);
                        fabmo.notify("info", entry.name + " added to the queue");
                        refreshJobs();
                    });
                });
                $list.append($f);
            }
        });
        $("#usb-list").scrollTop(0);
    });
}

// Poll for connected drives; keep the card hidden when there are none.
// `autoEnter` re-enters a single drive's root listing.
function refreshUSB(autoEnter) {
    fabmo.getUSBDevices(function (err, res) {
        if (err) return;
        var devices = (res && (res.devices || res)) || [];
        var changed = JSON.stringify(devices) !== JSON.stringify(usb.devices);
        usb.devices = devices;
        if (!devices.length) {
            usb.cwd = usb.root = null;
            $("#card-usb").hide();
            return;
        }
        $("#card-usb").show();
        if (usb.cwd && !changed && !autoEnter) return; // stay where the user is browsing
        if (devices.length === 1) {
            enterUSBDir(devices[0].path, devices[0].path);
        } else {
            usb.cwd = usb.root = null;
            renderUSBDeviceList();
        }
    });
}

function historyRow(job) {
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
    return $row;
}

function renderAll() {
    renderHeader();
    renderCurrentTool();
    renderSensors();
    renderPosition();
    renderToolRow();
    renderCustomButtons();
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

    // USB drives come and go; poll for presence (cheap fs check engine-side).
    refreshUSB();
    setInterval(refreshUSB, 8000);

    // Machine buttons (SB4 equivalents + user macro buttons; delegated —
    // custom buttons are re-rendered dynamically). Home Z composes an
    // optional jog to the configured fixed Z-zero XY location ahead of C2.
    $("#machine-btn-grid").on("click", ".machine-cmd", function () {
        if (!isIdle()) return;
        var cmd = $(this).attr("data-cmd");
        runCommand(cmd === "C2" ? homeZCommand() : cmd);
    });

    // ---- Add-macro-button modal ----

    var pickedMacro = null;

    $("#machine-btn-grid").on("click", "#btn-add-macro", function () {
        pickedMacro = null;
        $("#macro-btn-label").val("");
        $("#btn-macro-pick-save").prop("disabled", true);
        var $list = $("#macro-pick-list").html('<div class="ts-empty">Loading macros&hellip;</div>');
        fabmo.getMacros(function (err, macros) {
            $list.empty();
            if (err || !macros || !macros.length) {
                $list.append('<div class="ts-empty">No macros found</div>');
                return;
            }
            macros.forEach(function (m) {
                var $row = $(
                    '<div class="ts-pick-entry">' +
                        '<div class="ts-pick-name"></div>' +
                        '<div class="ts-pick-desc"></div>' +
                        "</div>"
                );
                $row.find(".ts-pick-name").text("C" + m.index + " — " + (m.name || "Macro " + m.index));
                $row.find(".ts-pick-desc").text(m.description || "");
                $row.data("macro", m);
                $list.append($row);
            });
        });
        $("#macro-pick-modal").css("display", "flex");
    });

    $("#macro-pick-list").on("click", ".ts-pick-entry", function () {
        $("#macro-pick-list .ts-pick-entry").removeClass("selected");
        $(this).addClass("selected");
        pickedMacro = $(this).data("macro");
        $("#macro-btn-label").val(pickedMacro.name || "Macro " + pickedMacro.index);
        $("#btn-macro-pick-save").prop("disabled", false);
    });

    $("#macro-pick-manager").on("click", function () {
        fabmo.launchApp("macros");
    });

    function closeMacroPick() {
        $("#macro-pick-modal").hide();
    }
    $("#btn-macro-pick-cancel").on("click", closeMacroPick);
    $("#macro-pick-modal").on("click", function (e) {
        if (e.target === this) closeMacroPick();
    });

    $("#btn-macro-pick-save").on("click", function () {
        if (!pickedMacro) return;
        var list = customButtons();
        list.push({
            macro: pickedMacro.index,
            label: ($("#macro-btn-label").val() || "").trim() || pickedMacro.name || "Macro " + pickedMacro.index,
        });
        saveCustomButtons(list, closeMacroPick);
    });

    // ---- Machine routine settings modal ----

    function setNum($el, v) {
        $el.val(v === null ? "" : v);
    }

    $("#btn-machine-settings").on("click", function () {
        setNum($("#ms-homeoff-x"), uuGet("SB_HOMEOFFUU", "X"));
        setNum($("#ms-homeoff-y"), uuGet("SB_HOMEOFFUU", "Y"));
        $("#ms-zzero-use").prop("checked", !!Number((state.vars || {}).SB_ZZEROLOC_USE));
        setNum($("#ms-zzero-x"), uuGet("SB_ZZEROLOCUU", "X"));
        setNum($("#ms-zzero-y"), uuGet("SB_ZZEROLOCUU", "Y"));
        setNum($("#ms-park-x"), uuGet("SB_PARKUU", "X"));
        setNum($("#ms-park-y"), uuGet("SB_PARKUU", "Y"));
        setNum($("#ms-park-z"), uuGet("SB_PARKUU", "Z"));
        var $custom = $("#ms-custom-list").empty();
        var buttons = customButtons();
        if (!buttons.length) {
            $custom.append('<div class="ts-empty">No custom buttons — use + Add on the Machine card</div>');
        }
        buttons.forEach(function (b) {
            var $row = $(
                '<div class="ts-custom-row">' +
                    '<span class="ts-custom-macro">C' + Number(b.macro) + "</span>" +
                    '<input type="text">' +
                    '<button class="ts-iconbtn ms-custom-remove" title="Remove button"><i class="fa fa-trash"></i></button>' +
                    "</div>"
            );
            $row.data("macro", Number(b.macro));
            $row.find("input").val(b.label || "");
            $custom.append($row);
        });
        $("#machine-settings-units").text("dimensions in current units (" + state.unit + ")");
        $("#machine-settings-modal").css("display", "flex");
    });

    $("#ms-custom-list").on("click", ".ms-custom-remove", function () {
        $(this).closest(".ts-custom-row").remove();
        if (!$("#ms-custom-list .ts-custom-row").length) {
            $("#ms-custom-list").append('<div class="ts-empty">No custom buttons — use + Add on the Machine card</div>');
        }
    });

    function closeMachineSettings() {
        $("#machine-settings-modal").hide();
    }
    $("#btn-machine-settings-cancel").on("click", closeMachineSettings);
    $("#machine-settings-modal").on("click", function (e) {
        if (e.target === this) closeMachineSettings();
    });

    $("#btn-machine-settings-save").on("click", function () {
        // Blank/invalid fields fall back to the current stored value (or 0)
        // so a partial edit never writes NaN into a table.
        var read = function (sel, varName, field) {
            var v = parseFloat($(sel).val());
            if (isFinite(v)) return v;
            var cur = uuGet(varName, field);
            return cur === null ? 0 : cur;
        };
        var payload = {
            SB_HOMEOFFUU: uuBoth({
                X: read("#ms-homeoff-x", "SB_HOMEOFFUU", "X"),
                Y: read("#ms-homeoff-y", "SB_HOMEOFFUU", "Y"),
            }),
            SB_ZZEROLOCUU: uuBoth({
                X: read("#ms-zzero-x", "SB_ZZEROLOCUU", "X"),
                Y: read("#ms-zzero-y", "SB_ZZEROLOCUU", "Y"),
            }),
            SB_ZZEROLOC_USE: $("#ms-zzero-use").is(":checked") ? 1 : 0,
            SB_PARKUU: uuBoth({
                X: read("#ms-park-x", "SB_PARKUU", "X"),
                Y: read("#ms-park-y", "SB_PARKUU", "Y"),
                Z: read("#ms-park-z", "SB_PARKUU", "Z"),
            }),
        };
        var buttons = [];
        $("#ms-custom-list .ts-custom-row").each(function () {
            var $row = $(this);
            var macro = Number($row.data("macro"));
            if (!(macro >= 1)) return;
            buttons.push({
                macro: macro,
                label: ($row.find("input").val() || "").trim() || "Macro " + macro,
            });
        });
        payload.TS_MACRO_BUTTONS = JSON.stringify(buttons);
        fabmo.setConfig({ opensbp: { variables: payload } }, function (err) {
            if (err) return fabmo.notify("error", err.message || err);
            closeMachineSettings();
            refreshConfig();
        });
    });

    // Tool row: load tool N via the standard toolchange dispatcher.
    // NB: window.confirm() is silently blocked by the dashboard's sandboxed
    // app iframe (no allow-modals) — confirmation must use fabmo.showModal.
    $("#rack").on("click", ".ts-clip", function () {
        var tool = Number($(this).data("tool"));
        var current = Number(atcVar("TOOLIN", 0));
        if (tool === current || !isIdle()) return;
        var name = toolName(tool);
        fabmo.showModal({
            title: "Tool Change",
            message: "Change to Tool " + tool + (name ? " (" + name + ")" : "") + "?",
            okText: "Change Tool",
            cancelText: "Cancel",
            ok: function () {
                runCommand("&Tool = " + tool + "\nC9");
            },
            cancel: function () {},
        });
    });

    $("#btn-measure").on("click", function () {
        if (!isIdle()) return;
        runCommand("C72");
    });

    // ---- Tool settings modal ----

    function rowInfo($tr) {
        var num = function (v) {
            var x = parseFloat(v);
            return isFinite(x) && x > 0 ? x : 0;
        };
        return {
            TYPE: $tr.find(".tsi-type").val() || "",
            DIA: num($tr.find(".tsi-dia").val()),
            LEN: num($tr.find(".tsi-len").val()),
            ANG: num($tr.find(".tsi-ang").val()),
        };
    }

    function syncRow($tr) {
        var info = rowInfo($tr);
        $tr.find(".tsi-ang").prop("disabled", !ANGLE_TYPES[info.TYPE]);
        $tr.find(".ts-name-cell").text(nameFromInfo(info));
    }

    $("#btn-tool-settings").on("click", function () {
        var clips = Number(atcVar("NUMCLIPS", 0));
        var $rows = $("#tool-settings-rows").empty();
        for (var n = 1; n <= clips; n++) {
            var info = toolInfo(n) || {};
            var opts = CUTTER_TYPES.map(function (t) {
                var sel = info.TYPE === t.value && t.value ? " selected" : "";
                return '<option value="' + t.value + '"' + sel + ">" + t.label + "</option>";
            }).join("");
            var $tr = $(
                '<tr data-tool="' + n + '">' +
                    '<td class="ts-tool-cell">' + n + "</td>" +
                    '<td><select class="tsi-type">' + opts + "</select></td>" +
                    '<td><input class="tsi-dia" type="number" step="any" min="0"></td>' +
                    '<td><input class="tsi-len" type="number" step="any" min="0"></td>' +
                    '<td><input class="tsi-ang" type="number" step="any" min="0" max="180"></td>' +
                    '<td class="ts-name-cell"></td>' +
                    "</tr>"
            );
            if (Number(info.DIA) > 0) $tr.find(".tsi-dia").val(info.DIA);
            if (Number(info.LEN) > 0) $tr.find(".tsi-len").val(info.LEN);
            if (Number(info.ANG) > 0) $tr.find(".tsi-ang").val(info.ANG);
            $rows.append($tr);
            syncRow($tr);
        }
        $("#tool-settings-units").text("dimensions in current units (" + state.unit + ")");
        $("#tool-settings-modal").css("display", "flex");
    });

    $("#tool-settings-rows").on("change input", "select, input", function () {
        syncRow($(this).closest("tr"));
    });

    function closeToolSettings() {
        $("#tool-settings-modal").hide();
    }
    $("#btn-tool-settings-cancel").on("click", closeToolSettings);
    $("#tool-settings-modal").on("click", function (e) {
        if (e.target === this) closeToolSettings();
    });

    $("#btn-tool-settings-save").on("click", function () {
        var toolinfo = {};
        $("#tool-settings-rows tr").each(function () {
            var $tr = $(this);
            toolinfo[String($tr.data("tool"))] = rowInfo($tr);
        });
        fabmo.setConfig({ opensbp: { variables: { TOOLINFO: toolinfo } } }, function (err) {
            if (err) return fabmo.notify("error", err.message || err);
            closeToolSettings();
            refreshConfig();
        });
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

    // Drag-to-reorder (same Sortable + PATCH order flow as the Job Manager;
    // this is the same engine queue the Job Manager shows, so order changes
    // appear in both apps)
    /* global Sortable */
    var sortable = Sortable.create(document.getElementById("job-queue"), {
        draggable: ".ts-job-sortable",
        handle: ".ts-drag-handle",
        ghostClass: "ts-drag-ghost",
        chosenClass: "ts-drag-chosen",
        dataIdAttr: "data-id",
        animation: 150,
        touchDelay: 100,
        onStart: function () {
            dragging = true;
        },
        onEnd: function () {
            dragging = false;
            persistOrder(sortable.toArray());
        },
    });

    function persistOrder(ids) {
        // PATCH each job's order sequentially (1-based, matching the Job
        // Manager), then refresh once.
        var i = 0;
        (function nextPatch() {
            if (i >= ids.length) return refreshJobs();
            var id = Number(ids[i]);
            i++;
            fabmo.updateOrder({ id: id, order: i }, function (err) {
                if (err) fabmo.notify("error", err.message || err);
                nextPatch();
            });
        })();
    }

    $("#job-queue").on("click", ".ts-job-delete", function () {
        var id = $(this).data("id");
        fabmo.deleteJob(id, function (err) {
            if (err) fabmo.notify("error", err.message || err);
            refreshJobs();
        });
    });

    $("#job-queue").on("click", ".ts-job-preview", function () {
        fabmo.launchApp("previewer", { job: $(this).data("id") });
    });

    $("#job-queue").on("click", ".ts-job-edit", function () {
        fabmo.launchApp("editor", { job: $(this).data("id") });
    });

    $("#job-history, #history-list").on("click", ".ts-job-rerun", function () {
        var id = $(this).data("id");
        fabmo.resubmitJob(id, { stayHere: true }, function (err) {
            if (err) fabmo.notify("error", err.message || err);
            else fabmo.notify("info", "Job added to the queue");
            refreshJobs();
        });
    });

    // ---- Full history modal (paged) ----

    var HISTORY_PAGE = 25;
    var historyStart = 0;

    function loadHistoryPage(start) {
        fabmo.getJobHistory({ start: start, count: HISTORY_PAGE }, function (err, res) {
            if (err || !res) return;
            historyStart = start;
            var total = res.total_count || 0;
            var jobs = res.data || [];
            var $list = $("#history-list").empty();
            if (!jobs.length) $list.append('<div class="ts-empty">No jobs in history</div>');
            jobs.forEach(function (job) {
                $list.append(historyRow(job));
            });
            $("#history-page-label").text(
                total ? start + 1 + "–" + Math.min(start + jobs.length, total) + " of " + total : "no jobs"
            );
            $("#btn-history-prev").prop("disabled", start <= 0);
            $("#btn-history-next").prop("disabled", start + HISTORY_PAGE >= total);
            $("#history-modal .ts-modal-body").scrollTop(0);
        });
    }

    $("#btn-full-history").on("click", function () {
        $("#history-modal").css("display", "flex");
        loadHistoryPage(0);
    });
    $("#btn-history-prev").on("click", function () {
        loadHistoryPage(Math.max(0, historyStart - HISTORY_PAGE));
    });
    $("#btn-history-next").on("click", function () {
        loadHistoryPage(historyStart + HISTORY_PAGE);
    });
    function closeHistory() {
        $("#history-modal").hide();
    }
    $("#btn-history-close").on("click", closeHistory);
    $("#history-modal").on("click", function (e) {
        if (e.target === this) closeHistory();
    });
});
