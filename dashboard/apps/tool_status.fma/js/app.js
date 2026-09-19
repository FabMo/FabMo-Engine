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

var HISTORY_COUNT = 3;

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
    usbDrive: null,
};

// ---------------------------------------------------------------------------
// Themes (ShopBot Labs token themes — css/themes.css + css/theme-bridge.css).
// A theme-<id> class on <body> activates one; no class = the app's default
// look from style.css. Choice is per-browser (localStorage), same as the
// labs ui_testbed, since a theme is a display preference, not a machine
// setting. Preview colors mirror each theme's bg/accent/text tokens so the
// picker swatches are accurate without applying the theme.

var THEME_KEY = "tool-status-theme";

var THEMES = [
    { id: "", label: "Default", bg: "#f4f5f7", accent: "#2980b9", text: "#2c3e50" },
    { id: "shopbot1", label: "ShopBot 1.0", bg: "#000000", accent: "#f09040", text: "#a05818" },
    { id: "shopbot-light", label: "ShopBot Light", bg: "#ffffff", accent: "#333333", text: "#111111" },
    { id: "shopbot-color", label: "ShopBot Color", bg: "#ffffff", accent: "#d05820", text: "#222222" },
    { id: "binbows", label: "Binbows XP", bg: "#ECE9D8", accent: "#0054E3", text: "#000000" },
    { id: "sbweb", label: "ShopBot Web", bg: "#e6e4d3", accent: "#a5ce42", text: "#171b60" },
    { id: "devdark", label: "SBcode", bg: "#1e1e1e", accent: "#569cd6", text: "#d4d4d4" },
    { id: "shopbot3", label: "ShopBot 3", bg: "#fef9c3", accent: "#00acc1", text: "#000000" },
    { id: "sb4", label: "SB4 Console", bg: "#979696", accent: "#008000", text: "#333333" },
    { id: "config", label: "Configuration", bg: "#ffffff", accent: "#313366", text: "#222222" },
    { id: "toolpath-net", label: "toolpath.net", bg: "#85847f", accent: "#d68a2e", text: "#f4f4f1" },
    { id: "ai-ya", label: "AI-YA!", bg: "#f7f6f2", accent: "#1b2a6b", text: "#22263a" },
];

function currentTheme() {
    try {
        return localStorage.getItem(THEME_KEY) || "";
    } catch (e) {
        return "";
    }
}

function applyTheme(id) {
    document.body.className = document.body.className.replace(/\btheme-\S+/g, "").trim();
    if (id) document.body.classList.add("theme-" + id);
    try {
        if (id) localStorage.setItem(THEME_KEY, id);
        else localStorage.removeItem(THEME_KEY);
    } catch (e) {
        /* private mode etc. — theme just won't persist */
    }
    $("#theme-grid .ts-theme-swatch").each(function () {
        $(this).toggleClass("selected", $(this).data("theme") === id);
    });
}

// Apply the saved theme immediately (script runs at end of body).
applyTheme(currentTheme());

// ---------------------------------------------------------------------------
// Card layout: order across the two panes plus user show/hide, draggable by
// the ⋮⋮ grip in each card title. Stored per-browser like the theme — layout
// is a display preference, not a machine setting. Availability (USB drive
// present, rack-style ATC) composes with the user's choice: a card shows
// only when it's both enabled in App Settings AND applicable to the machine.

var LAYOUT_KEY = "tool-status-layout";

var CARDS = [
    { id: "jobs", label: "Jobs" },
    { id: "usb", label: "USB Drive", note: "shown when a drive is plugged in" },
    { id: "console", label: "Console" },
    { id: "shortcuts", label: "App Shortcuts" },
    { id: "current", label: "Current Tool" },
    { id: "machine", label: "Machine" },
    { id: "shoptools", label: "Shop Tools" },
    { id: "tools", label: "Tools", note: "shown for rack-style ATCs" },
];

var DEFAULT_LAYOUT = { left: ["jobs", "usb", "console", "shortcuts"], right: ["current", "machine", "shoptools", "tools"], hidden: [] };

// Cards whose availability is machine-driven start unavailable until the
// first status/config arrives (they carry display:none in the markup).
var cardAvail = { usb: false, tools: false };

function loadLayout() {
    var raw = null;
    try {
        raw = JSON.parse(localStorage.getItem(LAYOUT_KEY));
    } catch (e) {
        /* missing/corrupt — fall through to default */
    }
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    var known = {};
    CARDS.forEach(function (c) {
        known[c.id] = true;
    });
    var out = { left: [], right: [], hidden: [] };
    var placed = {};
    ["left", "right"].forEach(function (side) {
        (Array.isArray(raw[side]) ? raw[side] : []).forEach(function (id) {
            if (known[id] && !placed[id]) {
                out[side].push(id);
                placed[id] = true;
            }
        });
    });
    (Array.isArray(raw.hidden) ? raw.hidden : []).forEach(function (id) {
        if (known[id] && out.hidden.indexOf(id) === -1) out.hidden.push(id);
    });
    // Cards missing from a stored layout (added in an app update) land at
    // their default position instead of vanishing.
    ["left", "right"].forEach(function (side) {
        DEFAULT_LAYOUT[side].forEach(function (id) {
            if (!placed[id]) {
                out[side].push(id);
                placed[id] = true;
            }
        });
    });
    return out;
}

var layout = loadLayout();

function saveLayout() {
    try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch (e) {
        /* private mode etc. — layout just won't persist */
    }
}

function isCardHidden(id) {
    return layout.hidden.indexOf(id) !== -1;
}

function updateCardVisibility(id) {
    var show = cardAvail[id] !== false && !isCardHidden(id);
    $('[data-card-id="' + id + '"]').toggle(show);
}

function setCardAvailable(id, avail) {
    cardAvail[id] = avail;
    updateCardVisibility(id);
}

// Move each card node into its pane in saved order. Moving nodes preserves
// their event handlers, so this is safe to re-run (e.g. on layout reset).
function applyLayout() {
    var panes = { left: "#pane-jobs", right: "#pane-controls" };
    Object.keys(panes).forEach(function (side) {
        var $pane = $(panes[side]);
        layout[side].forEach(function (id) {
            $pane.append($('[data-card-id="' + id + '"]'));
        });
    });
    CARDS.forEach(function (c) {
        updateCardVisibility(c.id);
    });
}

applyLayout();

// ---------------------------------------------------------------------------
// App shortcuts card: launcher tiles for other installed dashboard apps,
// reusing the same icons and background colors the dashboard app menu shows
// (fabmo.getApps → icon_url / icon_background_color; fabmo.launchApp opens
// one). The chosen set is per-browser (localStorage) like the theme and
// layout — which shortcuts are useful depends on the display.

var SHORTCUTS_KEY = "tool-status-shortcuts";
var OWN_APP_ID = "tool_status";

var shortcuts = (function () {
    try {
        var a = JSON.parse(localStorage.getItem(SHORTCUTS_KEY));
        return Array.isArray(a)
            ? a.filter(function (id) {
                  return typeof id === "string";
              })
            : [];
    } catch (e) {
        return [];
    }
})();

function saveShortcuts() {
    try {
        localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
    } catch (e) {
        /* private mode etc. — shortcuts just won't persist */
    }
}

var appsList = null; // last fabmo.getApps result

function refreshApps(callback) {
    fabmo.getApps(function (err, apps) {
        if (!err && Array.isArray(apps)) appsList = apps;
        renderShortcuts();
        callback && callback();
    });
}

function appById(id) {
    var apps = appsList || [];
    for (var i = 0; i < apps.length; i++) {
        if (apps[i].id === id) return apps[i];
    }
    return null;
}

function renderShortcuts() {
    var $grid = $("#shortcut-grid").empty();
    var shown = 0;
    shortcuts.forEach(function (id) {
        var app = appById(id);
        if (!app) return; // uninstalled since it was added
        shown++;
        var $tile = $(
            '<div class="ts-shortcut"><img alt=""><div class="ts-shortcut-label"></div></div>'
        );
        $tile.attr("data-app", app.id).attr("title", "Open " + app.name);
        $tile.find("img").attr("src", "/" + app.icon_url).css("background-color", app.icon_background_color || "");
        $tile.find(".ts-shortcut-label").text(app.name || app.id);
        $grid.append($tile);
    });
    if (!shown) {
        $grid.append('<div class="ts-empty">Shortcuts to apps installed on this tool</div>');
    }
    $grid.append(
        '<div class="ts-shortcut ts-shortcut-add" id="btn-add-shortcut" title="Add app shortcuts">' +
            '<span class="ts-shortcut-plus">+</span><div class="ts-shortcut-label">Add</div></div>'
    );
}

// ---------------------------------------------------------------------------
// Shop Tools card: familiar shop machines built from CNC primitives. The
// card shows one tile per tool; clicking a tile swaps the picker for that
// tool's mini interface inside the card frame. v1 implements the drill
// press (spindle on → plunge to the set depth below Z zero → retract to
// safe Z → spindle off); table saw and planer are placeholder tiles.
// Settings are per-display (localStorage) like the other display prefs,
// remembered with their units so an in/mm switch converts instead of
// silently reinterpreting the number.

var SHOPTOOLS_KEY = "tool-status-shoptools";

function shopToolPrefs() {
    try {
        var p = JSON.parse(localStorage.getItem(SHOPTOOLS_KEY));
        return p && typeof p === "object" ? p : {};
    } catch (e) {
        return {};
    }
}

function saveShopToolPref(tool, value) {
    var p = shopToolPrefs();
    p[tool] = value;
    try {
        localStorage.setItem(SHOPTOOLS_KEY, JSON.stringify(p));
    } catch (e) {
        /* private mode etc. — setting just won't persist */
    }
}

// A stored dimension entered in other units gets converted on recall.
function inCurrentUnits(value, unit) {
    var v = Number(value);
    if (!isFinite(v)) return null;
    if (unit && unit !== state.unit) {
        v = v * (state.unit === "mm" ? 25.4 : 1 / 25.4);
        v = Math.round(v * 10000) / 10000;
    }
    return v;
}

function showShopTool(tool) {
    $("#st-picker").toggle(!tool);
    $(".ts-st-panel").hide();
    if (tool) $("#st-panel-" + tool).show();
}

// ---- Drill press model ----
// depth = how deep the hole goes into the material, measured from the
// material's top surface — regardless of where Z was zeroed. The Z-zero
// radio tells us where Z=0 physically is so the machine target can be
// computed: zeroed on material → MZ,-depth; zeroed on table → the
// material top sits at Z=+thickness, so MZ,(thickness - depth).
var stDrill = {
    depth: 0.25,
    thickness: 0.75,
    zzero: "material", // "material" | "table"
};

// Array mode: DRILL produces an xn × yn grid of holes stepping +X/+Y from
// the current position. Mode is a session toggle (Array button); the
// numbers persist with the other drill prefs.
var stArrayMode = false;
var stArray = { xn: 2, yn: 2, xs: 1, ys: 1 };

function stDefaults() {
    return state.unit === "mm"
        ? { depth: 6, thickness: 18, slack: 12, space: 25 }
        : { depth: 0.25, thickness: 0.75, slack: 0.5, space: 1 };
}

function stCount(v) {
    v = Math.round(Number(v));
    return isFinite(v) && v >= 1 ? Math.min(v, 50) : 1;
}

// Cut geometry: how much of the hole lands in material vs table. Depth is
// always from the material top, so this is independent of the Z-zero
// location — only overshoot past the thickness reaches the table.
function stCuts() {
    var t = stDrill.thickness;
    var d = stDrill.depth;
    return { material: Math.min(d, t), table: Math.max(0, d - t), through: d >= t };
}

// Envelope map: machine envelope rectangle with its outside dimensions
// labeled below (X) and to the right (Y), a crosshair at the current
// position with leader lines to the X=0 and Y=0 edges, and the DRO
// coordinates alongside. Rebuilt on every status while the panel is open
// (it's one small SVG; churn is negligible at status rate). The rect is
// fitted to the container's live width so the pane never clips it.
function renderStEnv() {
    var svg = document.getElementById("st-env-svg");
    if (!svg) return;
    var env = state.envelope || {};
    var xspan = Number(env.xmax) - (Number(env.xmin) || 0);
    var yspan = Number(env.ymax) - (Number(env.ymin) || 0);
    if (!(xspan > 0) || !(yspan > 0)) {
        // No envelope configured — just leave an empty frame.
        svg.setAttribute("width", 150);
        svg.setAttribute("height", 110);
        svg.innerHTML = '<rect x="1" y="1" width="148" height="108" fill="#f7f8f9" stroke="#d5dbdb"/>' +
            '<text x="75" y="58" text-anchor="middle" font-size="10" fill="#95a5a6">no envelope</text>';
        return;
    }
    // Margins reserved for the dimension labels. The rect size depends
    // only on the envelope's aspect ratio (within fixed caps), never on
    // the container — so the map doesn't shift when the controls beside
    // it change between drill and array modes.
    var MB = 13; // below the rect: X dimension
    var MR = 13; // right of the rect: Y dimension (rotated)
    var maxRW = 240 - MR - 2;
    var maxRH = 150 - MB - 2;
    var rw = maxRW;
    var rh = (rw * yspan) / xspan;
    if (rh > maxRH) {
        rh = maxRH;
        rw = (rh * xspan) / yspan;
    }
    rw = Math.round(rw);
    rh = Math.round(rh);
    var W = rw + MR + 2;
    var H = rh + MB + 2;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    // Crosshair position in machine coordinates (work pos + G55 offset),
    // clamped into the envelope so a lost/unzeroed position still draws.
    var mxr = (Number(state.pos.x) || 0) + state.g55.x - (Number(env.xmin) || 0);
    var myr = (Number(state.pos.y) || 0) + state.g55.y - (Number(env.ymin) || 0);
    var mx = Math.max(0, Math.min(xspan, mxr));
    var my = Math.max(0, Math.min(yspan, myr));
    var px = (mx / xspan) * rw + 1;
    var py = 1 + rh - (my / yspan) * rh; // machine Y+ is up

    // Array preview: one dot per additional hole, stepping +X/+Y from the
    // (unclamped) current position; holes that would land outside the
    // envelope are simply not drawn.
    var dots = "";
    if (stArrayMode) {
        for (var j = 0; j < stArray.yn; j++) {
            for (var i = 0; i < stArray.xn; i++) {
                if (!i && !j) continue; // first hole is the crosshair itself
                var hx = mxr + i * stArray.xs;
                var hy = myr + j * stArray.ys;
                if (hx < 0 || hx > xspan || hy < 0 || hy > yspan) continue;
                dots +=
                    '<circle cx="' + ((hx / xspan) * rw + 1) + '" cy="' + (1 + rh - (hy / yspan) * rh) +
                    '" r="2.5" fill="#c0392b" fill-opacity="0.8"/>';
            }
        }
    }

    var label = fmt(state.pos.x) + ", " + fmt(state.pos.y);
    // Label sits below-right of the crosshair (array holes step up and to
    // the right on screen, so that corner stays clear); flip sides only
    // when jammed against the right/bottom edges.
    var tx = px + 6;
    var ty = py + 13;
    var anchor = "start";
    if (px > rw - 60) { tx = px - 6; anchor = "end"; }
    if (py > rh - 14) ty = py - 7;

    // Outside dimensions, trimmed to at most one decimal
    var dim = function (v) { return String(Math.round(v * 10) / 10); };

    svg.innerHTML =
        '<rect x="1" y="1" width="' + rw + '" height="' + rh + '" fill="#f4f1ea" stroke="#a8a49a"/>' +
        dots +
        '<line x1="1" y1="' + py + '" x2="' + px + '" y2="' + py + '" stroke="#2980b9" stroke-width="1" stroke-dasharray="3,2"/>' +
        '<line x1="' + px + '" y1="' + (1 + rh) + '" x2="' + px + '" y2="' + py + '" stroke="#2980b9" stroke-width="1" stroke-dasharray="3,2"/>' +
        '<line x1="' + (px - 5) + '" y1="' + py + '" x2="' + (px + 5) + '" y2="' + py + '" stroke="#c0392b" stroke-width="1.5"/>' +
        '<line x1="' + px + '" y1="' + (py - 5) + '" x2="' + px + '" y2="' + (py + 5) + '" stroke="#c0392b" stroke-width="1.5"/>' +
        '<circle cx="' + px + '" cy="' + py + '" r="2" fill="none" stroke="#c0392b"/>' +
        '<text x="' + tx + '" y="' + ty + '" text-anchor="' + anchor + '" font-size="10" font-weight="600" fill="#2c3e50">' + label + "</text>" +
        '<text x="' + (1 + rw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" font-size="9" fill="#7f8c8d">' + dim(xspan) + " " + state.unit + "</text>" +
        '<text x="' + (W - 3) + '" y="' + (1 + rh / 2) + '" text-anchor="middle" font-size="9" fill="#7f8c8d" transform="rotate(-90 ' + (W - 3) + " " + (1 + rh / 2) + ')">' + dim(yspan) + "</text>";
}

// Cross-section: table layer with the material on top, Z-zero radios lined
// up with dashed leader lines to their surface, and a red bar showing where
// the plunge actually cuts. Material is drawn at a height scaled per
// thickness (clamped so extremes stay readable); the red bar uses the same
// scale so proportions are honest.
function renderStXsec() {
    var svg = document.getElementById("st-xsec-svg");
    if (!svg) return;
    var W = 68;
    var H = 126;
    var LX = 14; // stack left edge (leader lines run 0..LX)
    var LW = W - LX - 6;
    var TABLE_H = 30;
    var yTable = 92; // table surface
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    var t = stDrill.thickness > 0 ? stDrill.thickness : stDefaults().thickness;
    // Floor keeps the gap between the surface lines tall enough for the
    // thickness label + input parked between the radios (which the label
    // now overlaps horizontally), even at 1/16" stock.
    var matPx = Math.max(50, Math.min(64, t * (state.unit === "mm" ? 3 : 76)));
    var scale = matPx / t;
    var yMat = yTable - matPx; // material surface
    var cuts = stCuts();
    var matCutPx = Math.min(cuts.material, t) * scale;
    var tableCutPx = Math.min(cuts.table * scale, TABLE_H - 4);
    var cx = LX + LW / 2;
    var barW = 10;

    var zzMat = stDrill.zzero === "material";
    var parts = [
        // table slab with the material on top
        '<rect x="' + LX + '" y="' + yTable + '" width="' + LW + '" height="' + TABLE_H + '" fill="#b8c2c2" stroke="#8d9a9a"/>',
        '<rect x="' + LX + '" y="' + yMat + '" width="' + LW + '" height="' + matPx + '" fill="#d4b585" stroke="#a8834f"/>',
    ];
    if (stDrill.depth > 0) {
        if (matCutPx > 0.5) {
            parts.push('<rect x="' + (cx - barW / 2) + '" y="' + yMat + '" width="' + barW + '" height="' + matCutPx + '" fill="#c0392b"/>');
        }
        if (tableCutPx > 0.5) {
            parts.push('<rect x="' + (cx - barW / 2) + '" y="' + yTable + '" width="' + barW + '" height="' + tableCutPx + '" fill="#7b241c"/>');
        }
    }
    svg.innerHTML = parts.join("");

    // Radios ride their leader lines (7px ≈ half a radio's height), which
    // run from beside the radio across the gutter to the slab edge; the
    // selected surface's line goes solid + accent.
    $("#st-zz-material").css("top", yMat - 7 + "px").prop("checked", zzMat);
    $("#st-zz-table").css("top", yTable - 7 + "px").prop("checked", !zzMat);
    function zzline(id, y, selected) {
        $(id).css({
            top: y - (selected ? 1 : 0.5) + "px",
            borderTop: selected ? "2px solid #2980b9" : "1px dashed #b2bec3",
        });
    }
    zzline("#st-zzline-material", yMat, zzMat);
    zzline("#st-zzline-table", yTable, !zzMat);

    // Thickness label + input, centered as one block in the span between
    // the two surface lines (the min slab height keeps this from ever
    // touching them).
    var $mat = $("#st-material");
    var $tl = $("#st-thicklabel");
    var lh = $tl.outerHeight() || 10;
    var blockTop = Math.round((yMat + yTable) / 2 - (lh + 1 + ($mat.outerHeight() || 22)) / 2);
    $tl.css("top", blockTop + "px");
    $mat.css("top", blockTop + lh + 1 + "px");
}

// Depth slider bounds follow the material: a bit past through-cut is as
// deep as ever makes sense from either Z zero.
function stSyncInputs(fromSlider) {
    var d = stDefaults();
    var max = (stDrill.thickness > 0 ? stDrill.thickness : d.thickness) + d.slack;
    var $slider = $("#st-drill-slider");
    $slider.attr("max", max).attr("step", state.unit === "mm" ? 1 : 0.1);
    if (!fromSlider) $slider.val(Math.min(stDrill.depth, max));
    $("#st-drill-depth").val(stDrill.depth > 0 ? stDrill.depth : "");
    $("#st-material").val(stDrill.thickness > 0 ? stDrill.thickness : "");
}

function stSaveDrill() {
    saveShopToolPref("drill", {
        depth: stDrill.depth,
        thickness: stDrill.thickness,
        zzero: stDrill.zzero,
        unit: state.unit,
        array: { xn: stArray.xn, yn: stArray.yn, xs: stArray.xs, ys: stArray.ys },
    });
}

function renderStDrill(fromSlider) {
    stSyncInputs(fromSlider);
    renderStXsec();
    renderStEnv();
}

// ---------------------------------------------------------------------------
// Console card: an SBP command line plus the Sb4-style teal window. Typed
// commands are echoed and run via runSBP; while a file runs, each executing
// line scrolls by — the file is fetched once per job from /job/<id>/file
// and indexed by the 1-based status.line, same as Sb4's file display.

var CONSOLE_MAX_LINES = 400;

function consoleLog(text, cls) {
    var $out = $("#console-output");
    if (!$out.length) return;
    var $line = $("<div>").text(text);
    if (cls) $line.addClass(cls);
    $out.append($line);
    while ($out.children().length > CONSOLE_MAX_LINES) $out.children().first().remove();
    $out.scrollTop($out[0].scrollHeight);
}

var consoleFile = { jobId: null, lines: null, loading: false, lastLine: null };

function consoleTrackRun(status) {
    if (status.state !== "running" && status.state !== "paused") {
        consoleFile.jobId = null;
        consoleFile.lines = null;
        consoleFile.lastLine = null;
        return;
    }
    var jobId = status.job && status.job._id;
    if (jobId && jobId !== consoleFile.jobId) {
        // One fetch attempt per job; on failure the run just scrolls nothing.
        consoleFile.jobId = jobId;
        consoleFile.lines = null;
        consoleFile.lastLine = null;
        if (!consoleFile.loading) {
            consoleFile.loading = true;
            $.get("/job/" + jobId + "/file")
                .done(function (data) {
                    consoleFile.lines = String(data).split("\n");
                })
                .always(function () {
                    consoleFile.loading = false;
                });
        }
    }
    if (!consoleFile.lines || typeof status.line !== "number") return;
    if (status.line === consoleFile.lastLine) return;
    consoleFile.lastLine = status.line;
    var text = consoleFile.lines[status.line - 1];
    if (typeof text === "string" && text.trim() !== "") {
        consoleLog(status.line + "  " + text, "ts-console-dim");
    }
}

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

// Sensor LEDs are driven by the per-input Type assignments from the
// configuration app's Inputs tab (machine.di<N>type); machines with no
// types assigned fall back to the legacy sensor-number variables.
var INPUT_TYPE_LABELS = {
    x_limit: "X Limit",
    y_limit: "Y Limit",
    z_limit: "Z Limit",
    a_limit: "A Limit",
    b_limit: "B Limit",
    c_limit: "C Limit",
    zzero_plate: "Z Plate",
    toolbar_present: "Toolbar",
    toolbar_up: "Toolbar Up",
    drawbar_open: "Drawbar",
    tool_present: "Tool",
};

function sensorDefs() {
    var defs = [];
    var types = state.diTypes || {};
    Object.keys(types)
        .sort(function (a, b) {
            return a - b;
        })
        .forEach(function (n) {
            var label = INPUT_TYPE_LABELS[types[n]];
            if (label) defs.push({ input: Number(n), label: label });
        });
    if (defs.length) return defs;
    // Legacy fallback: hand-set sensor-number variables
    var vars = state.vars || {};
    [
        { input: Number(vars.TOOLBAR_SENSOR), label: "Toolbar" },
        { input: Number(vars.TOOL_SENSOR), label: "Tool" },
        { input: Number(vars.DRAWBAR_SENSOR), label: "Drawbar" },
    ].forEach(function (d) {
        if (d.input >= 1) defs.push(d);
    });
    return defs;
}

// Rebuild the LED row only when the set of sensors changes (renderSensors
// runs on every status report; DOM churn at 10Hz would be wasteful).
var sensorLayoutKey = null;

function renderSensorLayout() {
    var defs = sensorDefs();
    var key = JSON.stringify(defs);
    if (key === sensorLayoutKey) return;
    sensorLayoutKey = key;
    var $row = $("#sensor-row").empty();
    defs.forEach(function (d) {
        var $s = $(
            '<div class="ts-sensor" data-input="' + d.input + '">' +
                '<span class="ts-led"></span><span class="ts-sensor-label"></span>' +
                "</div>"
        );
        $s.attr("title", d.label + " (input " + d.input + ")");
        $s.find(".ts-sensor-label").text(d.label);
        $row.append($s);
    });
}

function renderSensors() {
    renderSensorLayout();
    $("#sensor-row .ts-sensor").each(function () {
        var n = $(this).data("input");
        $(this)
            .find(".ts-led")
            .toggleClass("on", !!state.inputs["in" + n]);
    });
}

function renderPosition() {
    ["x", "y", "z"].forEach(function (ax) {
        $("#pos-" + ax).text(fmt(state.pos[ax]));
        $("#off-" + ax).text(fmt(state.g55[ax]));
    });
    $("#units-label").text(state.unit);
    $(".st-units").text(state.unit);
    if ($("#st-panel-drill").is(":visible")) renderStEnv();
}

function renderToolRow() {
    setCardAvailable("tools", showToolRow());
    if (!showToolRow()) return;
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
        var clip = table[n] || {};
        var clipLoc =
            isFinite(Number(clip.X)) && Number(clip.X) !== 0
                ? "clip " + fmt(Number(clip.X)) + ", " + fmt(Number(clip.Y))
                : "";
        var tip = [name, h ? "len " + fmt(Number(h)) : "", clipLoc].filter(Boolean).join(" · ");
        if (tip) $clip.attr("title", tip);
        if (n === current) $clip.addClass("current");
        else if (!idle) $clip.addClass("disabled");
        $rack.append($clip);
    }
    $("#rack-note").text(idle ? "press a tool to load it" : "available when idle");
    $(".ts-btn-grid-tools .ts-cmd").prop("disabled", !idle);
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
// USB drive (below the Jobs card): presence comes from status.usbDrive
// (the engine's 5s drive checker — same signal the Job Manager uses);
// browsing/selection uses the standard dashboard-level USB file browser
// (fabmo.showUSBFileBrowser), whose default flow submits the picked file
// as a job and posts updateQueueEvent back to the active app.

function renderUSB() {
    var drive = state.usbDrive;
    setCardAvailable("usb", !!drive);
    if (drive) $("#usb-crumb").text(String(drive).replace(/^.*\//, ""));
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
        state.envelope = (data.machine && data.machine.envelope) || null;
        var d = data.driver || {};
        state.g55 = { x: Number(d.g55x) || 0, y: Number(d.g55y) || 0, z: Number(d.g55z) || 0 };
        // Per-input semantic types (machine.di<N>type) drive the sensor LEDs
        state.diTypes = {};
        var m = data.machine || {};
        for (var k in m) {
            var match = /^di(\d+)type$/.exec(k);
            if (match && m[k] && m[k] !== "none") state.diTypes[match[1]] = m[k];
        }
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
    if (stateChanged && state.machineState !== null) {
        consoleLog("— " + status.state + " —", "ts-console-dim");
    }
    consoleTrackRun(status);
    state.machineState = status.state;
    state.unit = status.unit || state.unit;
    state.pos = { x: status.posx, y: status.posy, z: status.posz };
    if (status.usbDrive !== state.usbDrive) {
        state.usbDrive = status.usbDrive;
        renderUSB();
    }
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
    refreshApps();
    fabmo.requestStatus(function (err, status) {
        if (err || !status) return;
        state.machineState = status.state;
        state.unit = status.unit || state.unit;
        state.pos = { x: status.posx, y: status.posy, z: status.posz };
        state.usbDrive = status.usbDrive;
        renderAll();
        renderUSB();
    });
    // Backstop: variables can change without a machine state transition
    // (e.g. edited in another app).
    setInterval(refreshConfig, 10000);

    // USB: open the standard dashboard file browser (tree view, same as the
    // Job Manager); its default flow submits the selection as a job.
    $("#btn-usb-browse").on("click", function () {
        fabmo.showUSBFileBrowser({}, function () {});
    });

    // The dashboard posts updateQueueEvent to the active app after the USB
    // browser submits a job.
    window.addEventListener("message", function (e) {
        if (e.data && e.data.type === "updateQueueEvent") refreshJobs();
    });

    // Machine buttons (SB4 equivalents + user macro buttons; delegated —
    // custom buttons are re-rendered dynamically). Home Z composes an
    // optional jog to the configured fixed Z-zero XY location ahead of C2.
    $("#machine-btn-grid").on("click", ".machine-cmd", function () {
        if (!isIdle()) return;
        var cmd = $(this).attr("data-cmd");
        runCommand(cmd === "C2" ? homeZCommand() : cmd);
    });

    // ---- App shortcuts: launch tiles + picker modal ----

    $("#shortcut-grid").on("click", ".ts-shortcut", function () {
        var id = $(this).attr("data-app");
        if (id) fabmo.launchApp(id);
    });

    function openShortcutPicker() {
        var $list = $("#shortcut-pick-list").html('<div class="ts-empty">Loading apps&hellip;</div>');
        // Re-fetch so a just-installed app shows up without reloading
        refreshApps(function () {
            $list.empty();
            // Same visibility rule as the dashboard app menu, minus this app
            var apps = (appsList || []).filter(function (a) {
                return a.id !== OWN_APP_ID && a.icon_display !== "none";
            });
            if (!apps.length) {
                $list.append('<div class="ts-empty">No other apps installed</div>');
                return;
            }
            apps.forEach(function (a) {
                var $row = $(
                    '<label class="ts-shortcut-pick-row">' +
                        '<input type="checkbox"><img alt=""><span class="ts-pick-name"></span>' +
                        "</label>"
                );
                $row.find("input").attr("data-app", a.id).prop("checked", shortcuts.indexOf(a.id) !== -1);
                $row.find("img").attr("src", "/" + a.icon_url).css("background-color", a.icon_background_color || "");
                $row.find(".ts-pick-name").text(a.name || a.id);
                $list.append($row);
            });
        });
        $("#shortcut-pick-modal").css("display", "flex");
    }

    $("#btn-shortcut-settings").on("click", openShortcutPicker);
    $("#shortcut-grid").on("click", "#btn-add-shortcut", openShortcutPicker);

    function closeShortcutPicker() {
        $("#shortcut-pick-modal").hide();
    }
    $("#btn-shortcut-pick-cancel").on("click", closeShortcutPicker);
    $("#shortcut-pick-modal").on("click", function (e) {
        if (e.target === this) closeShortcutPicker();
    });

    $("#btn-shortcut-pick-save").on("click", function () {
        var checked = {};
        $("#shortcut-pick-list input").each(function () {
            if (this.checked) checked[$(this).attr("data-app")] = true;
        });
        // Keep the existing order for tiles that stay; append new ones
        var next = shortcuts.filter(function (id) {
            return checked[id];
        });
        $("#shortcut-pick-list input").each(function () {
            var id = $(this).attr("data-app");
            if (this.checked && next.indexOf(id) === -1) next.push(id);
        });
        shortcuts = next;
        saveShortcuts();
        renderShortcuts();
        closeShortcutPicker();
    });

    // ---- Add-macro-button modal ----

    var pickedMacro = null;

    $("#btn-add-macro").on("click", function () {
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

    $(".ts-btn-grid-tools").on("click", "[data-cmd]", function () {
        if (!isIdle()) return;
        runCommand($(this).attr("data-cmd"));
    });

    // ---- Shop Tools card ----

    $("#st-picker").on("click", ".ts-shoptool", function () {
        if ($(this).hasClass("soon")) return;
        var tool = $(this).data("tool");
        if (tool === "drill") {
            var p = shopToolPrefs().drill || {};
            var d = stDefaults();
            var depth = inCurrentUnits(p.depth, p.unit);
            var thickness = inCurrentUnits(p.thickness, p.unit);
            stDrill.depth = depth !== null && depth > 0 ? depth : d.depth;
            stDrill.thickness = thickness !== null && thickness > 0 ? thickness : d.thickness;
            stDrill.zzero = p.zzero === "table" ? "table" : "material";
            var d2 = stDefaults();
            var arr = p.array || {};
            stArray.xn = stCount(arr.xn || 2);
            stArray.yn = stCount(arr.yn || 2);
            var xs = inCurrentUnits(arr.xs, p.unit);
            var ys = inCurrentUnits(arr.ys, p.unit);
            stArray.xs = xs !== null && xs !== 0 ? xs : d2.space;
            stArray.ys = ys !== null && ys !== 0 ? ys : d2.space;
            setArrayMode(false);
            // Show first so the envelope map can measure its real width
            showShopTool(tool);
            renderStDrill();
            return;
        }
        showShopTool(tool);
    });

    // ---- Array mode: swap the depth/cross-section controls for the grid
    // fields; the envelope map previews the holes.

    function setArrayMode(on) {
        stArrayMode = on;
        $("#btn-st-array").toggleClass("active", on);
        $(".ts-st-depthcol, .ts-st-xseccol").toggle(!on);
        $("#st-array-panel").toggle(on);
        if (on) {
            $("#st-arr-xn").val(stArray.xn);
            $("#st-arr-yn").val(stArray.yn);
            $("#st-arr-xs").val(stArray.xs);
            $("#st-arr-ys").val(stArray.ys);
        }
    }

    $("#btn-st-array").on("click", function () {
        setArrayMode(!stArrayMode);
        renderStEnv();
    });

    $("#st-array-panel").on("change", "input", function () {
        stArray.xn = stCount($("#st-arr-xn").val());
        stArray.yn = stCount($("#st-arr-yn").val());
        var xs = parseFloat($("#st-arr-xs").val());
        var ys = parseFloat($("#st-arr-ys").val());
        if (isFinite(xs)) stArray.xs = xs;
        if (isFinite(ys)) stArray.ys = ys;
        $("#st-arr-xn").val(stArray.xn);
        $("#st-arr-yn").val(stArray.yn);
        stSaveDrill();
        renderStEnv();
    });

    $(".ts-st-back").on("click", function () {
        showShopTool(null);
    });

    // Slider drags update live; the number field mirrors it. Persist on
    // change-end rather than every drag tick.
    $("#st-drill-slider").on("input", function () {
        stDrill.depth = parseFloat($(this).val()) || 0;
        renderStDrill(true);
    });
    $("#st-drill-slider").on("change", stSaveDrill);

    $("#st-drill-depth").on("change", function () {
        var v = parseFloat($(this).val());
        stDrill.depth = v > 0 ? v : 0;
        renderStDrill();
        stSaveDrill();
    });

    $("#st-material").on("change", function () {
        var v = parseFloat($(this).val());
        stDrill.thickness = v > 0 ? v : 0;
        renderStDrill();
        stSaveDrill();
    });

    $('input[name="st-zzero"]').on("change", function () {
        stDrill.zzero = this.value === "table" ? "table" : "material";
        renderStDrill();
        stSaveDrill();
    });

    $("#btn-st-drill").on("click", function () {
        if (!isIdle()) return;
        var depth = stDrill.depth;
        if (!(depth > 0)) {
            fabmo.notify("warning", "Set a drilling depth first.");
            return;
        }
        // Depth is into the material from its top; where Z=0 sits decides
        // the machine target for that same hole.
        var zzTable = stDrill.zzero === "table";
        if (zzTable && !(stDrill.thickness > 0)) {
            fabmo.notify("warning", "Set the material thickness — with Z zeroed on the table it locates the material surface.");
            return;
        }
        var targetZ = zzTable ? stDrill.thickness - depth : -depth;
        targetZ = Math.round(targetZ * 10000) / 10000;
        stSaveDrill();
        // Retract target: the shared safe-Z; a plain fallback clearance if
        // the machine has none set.
        var safeZ = Number((state.vars || {}).SB_SAFE_Z);
        if (!isFinite(safeZ) || safeZ <= 0) safeZ = state.unit === "mm" ? 25 : 1;
        // Zeroed on the table, the material top is at +thickness — keep
        // the same clearance above the material, not above Z zero.
        if (zzTable) safeZ = Math.round((stDrill.thickness + safeZ) * 10000) / 10000;

        var r4 = function (v) { return Math.round(v * 10000) / 10000; };
        var lines = ["'Shop Tools: drill press", "SO,1,1", "PAUSE 2"];
        var logMsg;
        if (stArrayMode && stArray.xn * stArray.yn > 1) {
            if ((stArray.xn > 1 && !stArray.xs) || (stArray.yn > 1 && !stArray.ys)) {
                fabmo.notify("warning", "Set the array spacing first.");
                return;
            }
            // Grid steps +X/+Y from the current position, row by row, with
            // a safe-Z retract before every move between holes.
            var bx = Number(state.pos.x) || 0;
            var by = Number(state.pos.y) || 0;
            for (var j = 0; j < stArray.yn; j++) {
                for (var i = 0; i < stArray.xn; i++) {
                    lines.push("JZ, " + safeZ);
                    lines.push("J2, " + r4(bx + i * stArray.xs) + ", " + r4(by + j * stArray.ys));
                    lines.push("MZ, " + targetZ);
                }
            }
            logMsg = "> drill array: " + stArray.xn + "×" + stArray.yn + " holes, " + depth + " " + state.unit + " into material (Z to " + targetZ + ")";
        } else {
            lines.push("MZ, " + targetZ);
            logMsg = "> drill: " + depth + " " + state.unit + " into material (Z to " + targetZ + ")";
        }
        lines.push("JZ, " + safeZ);
        lines.push("SO,1,0");
        consoleLog(logMsg);
        runCommand(lines.join("\n"));
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

    // ---- Card layout: drag between/within panes, show/hide in settings ----

    function paneCardIds(sel) {
        return $(sel)
            .children("[data-card-id]")
            .map(function () {
                return $(this).attr("data-card-id");
            })
            .get();
    }

    function saveLayoutFromDOM() {
        layout.left = paneCardIds("#pane-jobs");
        layout.right = paneCardIds("#pane-controls");
        saveLayout();
    }

    // Cards are fixed in place until the pencil in the header enables edit
    // mode, which reveals the ⋮⋮ grips and arms the sortables — so a stray
    // touch on a shop machine can never shuffle the layout.
    var cardSortables = ["pane-jobs", "pane-controls"].map(function (paneId) {
        return Sortable.create(document.getElementById(paneId), {
            group: "ts-cards",
            draggable: ".ts-card",
            handle: ".ts-card-grip",
            ghostClass: "ts-drag-ghost",
            chosenClass: "ts-drag-chosen",
            animation: 150,
            touchDelay: 100,
            disabled: true,
            onEnd: saveLayoutFromDOM,
        });
    });

    function setEditingLayout(on) {
        document.body.classList.toggle("ts-editing", on);
        $("#btn-edit-layout").toggleClass("active", on);
        cardSortables.forEach(function (s) {
            s.options.disabled = !on;
        });
    }

    $("#btn-edit-layout").on("click", function () {
        setEditingLayout(!document.body.classList.contains("ts-editing"));
    });

    function renderCardToggles() {
        var $list = $("#card-toggle-list").empty();
        CARDS.forEach(function (c) {
            var $row = $('<label class="ts-check-row"><input type="checkbox"><span></span></label>');
            $row.find("input").prop("checked", !isCardHidden(c.id)).attr("data-card", c.id);
            $row.find("span").text(c.label);
            if (c.note) $row.append($('<span class="ts-note-inline">').text(c.note));
            $list.append($row);
        });
    }

    $("#card-toggle-list").on("change", "input", function () {
        var id = $(this).attr("data-card");
        var i = layout.hidden.indexOf(id);
        if (this.checked && i !== -1) layout.hidden.splice(i, 1);
        if (!this.checked && i === -1) layout.hidden.push(id);
        saveLayout();
        updateCardVisibility(id);
    });

    $("#btn-layout-reset").on("click", function () {
        layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
        saveLayout();
        applyLayout();
        renderCardToggles();
    });

    // ---- Console card: command entry with arrow-key history ----

    var cmdHistory = [];
    var cmdHistoryIdx = -1; // -1 = live (unsubmitted) entry

    $("#console-input").on("keydown", function (e) {
        var $in = $(this);
        if (e.key === "Enter") {
            var cmd = $in.val().trim();
            if (!cmd) return;
            if (cmd !== cmdHistory[cmdHistory.length - 1]) cmdHistory.push(cmd);
            cmdHistoryIdx = -1;
            $in.val("");
            consoleLog("> " + cmd);
            fabmo.runSBP(cmd + "\n", function (err) {
                if (err) consoleLog(String(err.message || err), "ts-console-err");
            });
        } else if (e.key === "ArrowUp") {
            if (!cmdHistory.length) return;
            e.preventDefault();
            if (cmdHistoryIdx === -1) cmdHistoryIdx = cmdHistory.length;
            if (cmdHistoryIdx > 0) cmdHistoryIdx--;
            $in.val(cmdHistory[cmdHistoryIdx]);
        } else if (e.key === "ArrowDown") {
            if (cmdHistoryIdx === -1) return;
            e.preventDefault();
            cmdHistoryIdx++;
            if (cmdHistoryIdx >= cmdHistory.length) {
                cmdHistoryIdx = -1;
                $in.val("");
            } else {
                $in.val(cmdHistory[cmdHistoryIdx]);
            }
        }
    });

    // ---- App settings modal (theme picker) ----

    var $grid = $("#theme-grid");
    THEMES.forEach(function (t) {
        var $btn = $(
            '<button class="ts-theme-swatch">' +
                '<span class="ts-swatch-preview"><span></span><span></span><span></span></span>' +
                '<span class="ts-swatch-label"></span>' +
                "</button>"
        );
        $btn.data("theme", t.id);
        $btn.find(".ts-swatch-label").text(t.label);
        var $dots = $btn.find(".ts-swatch-preview");
        $dots.css("background", t.bg);
        $dots.children().eq(0).css("background", t.accent);
        $dots.children().eq(1).css("background", t.text);
        $dots.children().eq(2).css("background", t.bg === "#ffffff" ? "#e1e4e8" : "#ffffff");
        $btn.on("click", function () {
            applyTheme(t.id);
        });
        $grid.append($btn);
    });

    $("#btn-app-settings").on("click", function () {
        applyTheme(currentTheme()); // refresh selected highlight
        renderCardToggles();
        $("#app-settings-modal").css("display", "flex");
    });
    function closeAppSettings() {
        $("#app-settings-modal").hide();
    }
    $("#btn-app-settings-close").on("click", closeAppSettings);
    $("#app-settings-modal").on("click", function (e) {
        if (e.target === this) closeAppSettings();
    });
});
