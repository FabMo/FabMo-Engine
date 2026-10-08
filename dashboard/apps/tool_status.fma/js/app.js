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

// t() with a fallback for dynamically-built keys (machine states, sensor
// roles): a missing key comes back as the key itself — show the raw
// value instead of "tool_status.states.weird".
function tOr(key, fallback) {
    var out = typeof window.t === "function" ? window.t(key) : key;
    return out === key ? fallback : out;
}

// Most JS-built text re-renders on every status tick and self-heals once
// the dictionary arrives; the sensor row is memoized, so kick it (and the
// header) explicitly when translations load. The shortcuts card is outside
// renderAll/the 10 s refresh entirely (repaints only on picker-save), and
// renderJobs' empty() throws away its data-i18n fallback node — re-run
// both here so a pre-dict first paint can't strand raw keys.
if (window.i18nReady) {
    window.i18nReady.then(function () {
        // Independent guards: a pre-first-status throw in one repaint
        // must not skip the others
        try {
            sensorLayoutKey = null;
            renderSensors();
            renderHeader();
        } catch (e) { /* pre-first-status — the status handler covers it */ }
        try { renderShortcuts(); } catch (e) { /* covered by picker-save */ }
        try { renderJobs(); } catch (e) { /* covered by the jobs refresh */ }
    });
}

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
        $tile.attr("data-app", app.id).attr("title", window.t("tool_status.shortcuts.open_app", { name: app.name }));
        $tile.find("img").attr("src", "/" + app.icon_url).css("background-color", app.icon_background_color || "");
        $tile.find(".ts-shortcut-label").text(app.name || app.id);
        $grid.append($tile);
    });
    if (!shown) {
        $grid.append($('<div class="ts-empty">').text(window.t("tool_status.shortcuts.empty")));
    }
    $grid.append(
        '<div class="ts-shortcut ts-shortcut-add" id="btn-add-shortcut" title="' + window.t("tool_status.shortcuts.add_title") + '">' +
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
    // Spiral bore: with bit > 0 and hole > bit, DRILL helixes the bit
    // center around a circle of radius (hole - bit)/2 instead of
    // plunging straight. 0 = unset → classic straight plunge.
    bit: 0,
    hole: 0,
    zzero: "material", // "material" | "table"
    // Envelope-relative machine coords of where DRILL should go; null =
    // drill at the machine position (classic in-place behavior). Session
    // state, deliberately not persisted.
    target: null,
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

// Bit-center orbit radii that clear a hole of stDrill.hole with a bit of
// stDrill.bit, inner ring first. The innermost ring's sweep must reach
// the hole's center (orbit ≤ bit/2) or a core pillar would be left
// standing to break loose; outward rings step ≤ bit/2 (50% stepover) and
// the last lands exactly on (hole - bit)/2, the finished wall.
function stSpiralRings() {
    var rcOuter = (stDrill.hole - stDrill.bit) / 2;
    var step = stDrill.bit / 2;
    var rings = [];
    for (var r = Math.min(rcOuter, step); r < rcOuter - 1e-9; r += step) {
        rings.push(Math.round(r * 10000) / 10000);
    }
    rings.push(Math.round(rcOuter * 10000) / 10000);
    return rings;
}

// SBP for one spiral-bored hole centered at (cwx, cwy) in work coords.
// Each ring: jog to the circle's west point just above the surface, then
// a CG option-4 helix — full circles descending plg per revolution, with
// a bottom clean-up circle at final depth — then retract to just above
// the surface for the hop to the next ring. CCW (climb for an inside cut
// with a CW spindle), plunging ~half the bit diameter per revolution,
// spread evenly so the bottom pass lands exactly on targetZ.
function stSpiralLines(cwx, cwy, surfZ, targetZ, safeZ) {
    var r4 = function (v) { return Math.round(v * 10000) / 10000; };
    var clear = state.unit === "mm" ? 0.5 : 0.02;
    var startZ = r4(surfZ + clear);
    var reps = Math.max(1, Math.ceil((startZ - targetZ) / (stDrill.bit / 2)));
    var plg = Math.round(((targetZ - startZ) / reps) * 1e6) / 1e6;
    var sy = r4(cwy);
    var lines = ["JZ, " + safeZ];
    stSpiralRings().forEach(function (rc, i) {
        var sx = r4(cwx - rc);
        lines.push("J2, " + sx + ", " + sy);
        if (i === 0) lines.push("JZ, " + startZ);
        lines.push("CG, , " + sx + ", " + sy + ", " + rc + ", 0, , 2, " + plg + ", " + reps + ", , , 4");
        lines.push("JZ, " + startZ);
    });
    lines.push("JZ, " + safeZ);
    return lines;
}

// Width available to an envelope map: whatever the row has left after
// its fixed-width control columns (plus flex gaps), floored for
// readability and capped at the classic full size. Below the floor the
// panel flips to stacked mode — the map drops under the controls and
// gets the whole row to itself. The decision depends only on the row
// width and the (constant) control widths, so the map's own re-render
// can't flip it back and forth.
var ST_ENV_MIN = 130;
var ST_ENV_MAX = 240;
function stEnvCap(svgId) {
    // AR copy renders at a fixed boosted size — no DOM measuring, and no
    // touching the panel's stacked class (that belongs to the rail copy).
    if (stArRender) return ST_AR_RENDER_W;
    var svg = document.getElementById(svgId);
    var envEl = svg && svg.parentNode;   // .ts-st-env
    var row = envEl && envEl.parentNode; // .ts-st-drill-row
    var panel = row && row.parentNode;   // .ts-st-panel
    if (!panel) return ST_ENV_MAX;
    var rowW = row.clientWidth;
    if (!rowW) return ST_ENV_MAX; // panel hidden — nothing to measure
    var used = 0;
    Array.prototype.forEach.call(row.children, function (el) {
        if (el === envEl || !el.offsetParent) return; // self / display:none
        used += el.offsetWidth + 6; // column + its flex gap
    });
    var avail = rowW - used;
    var stacked = avail < ST_ENV_MIN;
    panel.classList.toggle("ts-st-stacked", stacked);
    return Math.min(ST_ENV_MAX, Math.max(ST_ENV_MIN, stacked ? rowW : avail));
}

// Header action buttons: centered over the span of the visible control
// columns (not the envelope map), clamped between the title and the
// panel's right edge. Called after each map render, so mode swaps,
// stacking, and card resizes all re-place them.
function stPlaceBtns(panelId) {
    var panel = document.getElementById(panelId);
    var btns = panel && panel.querySelector(".ts-st-btncol");
    var row = panel && panel.querySelector(".ts-st-drill-row");
    if (!btns || !row) return;
    var envEl = panel.querySelector(".ts-st-env");
    var panelBox = panel.getBoundingClientRect();
    if (!panelBox.width) return; // hidden — leave as-is
    var lo = Infinity, hi = -Infinity;
    Array.prototype.forEach.call(row.children, function (el) {
        if (el === envEl || !el.offsetParent) return;
        var b = el.getBoundingClientRect();
        lo = Math.min(lo, b.left);
        hi = Math.max(hi, b.right);
    });
    if (lo > hi) { // no control columns visible — fall back to flush right
        btns.style.left = "";
        btns.style.right = "";
        return;
    }
    var w = btns.offsetWidth;
    var title = panel.querySelector(".ts-st-title");
    var minLeft = title ? title.getBoundingClientRect().right - panelBox.left + 10 : 0;
    var left = (lo + hi) / 2 - panelBox.left - w / 2;
    left = Math.max(minLeft, Math.min(panelBox.width - w, left));
    btns.style.left = Math.round(left) + "px";
    btns.style.right = "auto";
}

// Origin badge for a table map's bottom-left corner (machine 0,0): X/Y
// axis arrows + labels, near-black with a white halo (paint-order on the
// text/arrowheads, an underlay path on the axes) so it never sinks into
// a toolpath or crosshair drawn beneath it. Callers pass the corner
// point, inset a few px inside the table rect, and draw it last.
function stOriginBadge(ox, oy) {
    var oc = "#1a252f";
    var axisD = "M" + ox + " " + (oy - 17) + " L" + ox + " " + oy + " L" + (ox + 17) + " " + oy;
    var halo = 'paint-order="stroke" stroke="#fff" stroke-width="2.5" font-weight="700" fill="' + oc + '"';
    return (
        '<path d="' + axisD + '" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>' +
        '<path d="' + axisD + '" fill="none" stroke="' + oc + '" stroke-width="1.75"/>' +
        '<path d="M' + (ox + 17) + " " + oy + ' l-5.5 -3.5 v7 z" fill="' + oc + '" stroke="#fff" stroke-width="1" paint-order="stroke"/>' +
        '<path d="M' + ox + " " + (oy - 17) + ' l-3.5 5.5 h7 z" fill="' + oc + '" stroke="#fff" stroke-width="1" paint-order="stroke"/>' +
        '<text x="' + (ox + 21) + '" y="' + (oy + 3) + '" font-size="8" ' + halo + ">X</text>" +
        '<text x="' + (ox - 3) + '" y="' + (oy - 21) + '" font-size="8" ' + halo + ">Y</text>" +
        '<text x="' + (ox + 6) + '" y="' + (oy - 6) + '" font-size="8" ' + halo + ">0,0</text>"
    );
}

// ---- AR projection ----
// Projects the active tool's envelope map onto the live table camera,
// reusing the four-corner calibration the previewer saves in
// machine.cameraCalibration (corner fractions of the video frame, TL =
// machine (xmin, ymax) — same convention as the previewer's overhead
// mode). The map is re-rendered at boosted size into #st-ar-svg and a
// CSS matrix3d maps its envelope rect onto the calibrated quad. Table-
// plane geometry — which is all these previews are — projects exactly.
var stAr = {
    tool: null,     // "drill" | "tablesaw" | "planer" while the stage is open
    camPort: null,  // camera with a live stream (1 | 2), null = none found
    cal: null,      // machine.cameraCalibration from config
    _home: null,    // where the docked panel goes back on exit
    _syncing: false,
};
var stArRender = false;      // render fns size for the AR copy when set
var ST_AR_RENDER_W = 720;    // boosted logical size: crisp under the warp,
var ST_AR_RENDER_H = 450;    // labels/handles proportionally small on it
var ST_AR_SVGS = { drill: "st-env-svg", tablesaw: "sts-env-svg", planer: "stp-env-svg" };
var ST_AR_RENDERS = { drill: renderStEnv, tablesaw: renderStsEnv, planer: renderStpEnv };
var SVG_NS = "http://www.w3.org/2000/svg";

// 4-point homography, cribbed from the previewer (viewer.js): H maps
// src quad → dst quad via the unit square, closed form.
function _h_squareToQuad(p) {
    var dx1 = p[1][0] - p[2][0], dx2 = p[3][0] - p[2][0], sx = p[0][0] - p[1][0] + p[2][0] - p[3][0];
    var dy1 = p[1][1] - p[2][1], dy2 = p[3][1] - p[2][1], sy = p[0][1] - p[1][1] + p[2][1] - p[3][1];
    var det = dx1 * dy2 - dx2 * dy1;
    var g = (sx * dy2 - dx2 * sy) / det;
    var h = (dx1 * sy - sx * dy1) / det;
    return [
        [p[1][0] - p[0][0] + g * p[1][0], p[3][0] - p[0][0] + h * p[3][0], p[0][0]],
        [p[1][1] - p[0][1] + g * p[1][1], p[3][1] - p[0][1] + h * p[3][1], p[0][1]],
        [g, h, 1],
    ];
}
function _h_inverse3(m) {
    var a = m[0][0], b = m[0][1], c = m[0][2];
    var d = m[1][0], e = m[1][1], f = m[1][2];
    var g = m[2][0], h = m[2][1], i = m[2][2];
    var det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    return [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ];
}
function _h_mul3(a, b) {
    var r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++)
        for (var j = 0; j < 3; j++)
            r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    return r;
}
function _h_quadToQuad(src, dst) {
    return _h_mul3(_h_squareToQuad(dst), _h_inverse3(_h_squareToQuad(src)));
}
function _h_toMatrix3d(H) {
    return "matrix3d(" + [
        H[0][0], H[1][0], 0, H[2][0],
        H[0][1], H[1][1], 0, H[2][1],
        0, 0, 1, 0,
        H[0][2], H[1][2], 0, H[2][2],
    ].map(function (n) { return n.toFixed(8); }).join(",") + ")";
}

// The physical table rect in machine coords: 0..size when per-axis
// envelope sizes are configured; envelope min/max (soft limits, which
// include overtravel) remain the fallback for configs predating sizes.
// All Shop Tools map math — rendering, drags, and the map-relative →
// work-coord conversion in the job generators — goes through this.
function stTableRect() {
    var env = state.envelope || {};
    var xsize = Number(env.xsize), ysize = Number(env.ysize);
    var x0 = xsize > 0 ? 0 : (Number(env.xmin) || 0);
    var y0 = ysize > 0 ? 0 : (Number(env.ymin) || 0);
    return {
        x0: x0,
        y0: y0,
        xspan: xsize > 0 ? xsize : Number(env.xmax) - x0,
        yspan: ysize > 0 ? ysize : Number(env.ymax) - y0,
    };
}

function stArAvailable() {
    var c = stAr.cal;
    var t = stTableRect();
    return !!(stAr.camPort &&
        c && c.calibrated && c.corners &&
        c.corners.tl && c.corners.tr && c.corners.br && c.corners.bl &&
        t.xspan > 0 && t.yspan > 0);
}

function stArRefreshBtns() {
    $(".ts-st-arbtn").toggle(stArAvailable());
}

// Probe for a live camera stream, preferring the one the calibration was
// made against. Ports match the previewer: camera 1 → 3141, 2 → 3142.
function stArDetect() {
    if (!window.FabMoVideo) return;
    var preferred = (stAr.cal && stAr.cal.port === 2) ? 2 : 1;
    var other = preferred === 2 ? 1 : 2;
    window.FabMoVideo.detectCamera(preferred).then(function (ok) {
        if (ok) return stArSetPort(preferred);
        return window.FabMoVideo.detectCamera(other).then(function (ok2) {
            stArSetPort(ok2 ? other : null);
        });
    }).catch(function () { stArSetPort(null); });
}
function stArSetPort(p) {
    stAr.camPort = p;
    stArRefreshBtns();
}

// Re-render the active tool's map at boosted size, copy it into the AR
// svg, then restore the rail copy. Called from the tail of every map
// render, so drags, typed values, and status ticks all keep the
// projection live; no-ops unless the stage is showing that map. The
// nested renders' own tail calls are gated off by _syncing.
function stArSync(svgId) {
    if (!stAr.tool || stAr._syncing || ST_AR_SVGS[stAr.tool] !== svgId) return;
    var src = document.getElementById(svgId);
    var dst = document.getElementById("st-ar-svg");
    if (!src || !dst) return;
    stAr._syncing = true;
    stArRender = true;
    ST_AR_RENDERS[stAr.tool]();
    dst.setAttribute("width", src.getAttribute("width"));
    dst.setAttribute("height", src.getAttribute("height"));
    dst.innerHTML = src.innerHTML;
    // The map's opaque table fill would hide the very table we're
    // projecting onto — thin it to a wash that just marks the envelope.
    var envRect = dst.querySelector("rect");
    if (envRect) envRect.setAttribute("fill", "rgba(244, 241, 234, 0.2)");
    // Over live video a label can land on anything — sampling the frame
    // to adapt per-label isn't an option (the camera stream is cross-
    // origin, so a canvas readback taints), so do what the position
    // crosshair does: a white halo under every label, and the light
    // grey lifted to the dark ink so it holds up on a grey table.
    dst.querySelectorAll("text").forEach(function (t) {
        t.setAttribute("paint-order", "stroke");
        t.setAttribute("stroke", "#fff");
        t.setAttribute("stroke-width", "2.5");
        t.setAttribute("stroke-linejoin", "round");
        if (t.getAttribute("fill") === "#7f8c8d") t.setAttribute("fill", "#2c3e50");
    });
    stArRender = false;
    ST_AR_RENDERS[stAr.tool]();
    stAr._syncing = false;
    if (stAr.tool !== "drill") stArDrawPos(); // drill's map has its own crosshair
    stArWarp();
}

// Map the AR svg's envelope rect (always the first <rect> the renderers
// emit) onto the calibrated table quad.
function stArWarp() {
    var stage = document.getElementById("st-ar-stage");
    var svg = document.getElementById("st-ar-svg");
    var rect = svg && svg.querySelector("rect");
    var c = stAr.cal && stAr.cal.corners;
    if (!stage || !rect || !c) return;
    var rx = +rect.getAttribute("x"), ry = +rect.getAttribute("y");
    var rw = +rect.getAttribute("width"), rh = +rect.getAttribute("height");
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h || !rw || !rh) return;
    var H = _h_quadToQuad(
        [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]],
        [[c.tl.x * w, c.tl.y * h], [c.tr.x * w, c.tr.y * h],
         [c.br.x * w, c.br.y * h], [c.bl.x * w, c.bl.y * h]]
    );
    svg.style.transform = _h_toMatrix3d(H);
    stAr._Hinv = _h_inverse3(H); // stage px → svg px, for handle drags
}

// Map a pointer position to envelope machine coordinates through the
// inverse homography — how drags on the projection read the table.
// Returns {vx, vy} (unclamped, like the flat-map math) or null.
function stArPointToEnv(clientX, clientY) {
    var stage = document.getElementById("st-ar-stage");
    var svg = document.getElementById("st-ar-svg");
    var rect = svg && svg.querySelector("rect");
    var Hi = stAr._Hinv;
    var t = stTableRect();
    var xspan = t.xspan, yspan = t.yspan;
    if (!stage || !rect || !Hi || !(xspan > 0) || !(yspan > 0)) return null;
    var sb = stage.getBoundingClientRect();
    var sx = clientX - sb.left, sy = clientY - sb.top;
    var x = Hi[0][0] * sx + Hi[0][1] * sy + Hi[0][2];
    var y = Hi[1][0] * sx + Hi[1][1] * sy + Hi[1][2];
    var w = Hi[2][0] * sx + Hi[2][1] * sy + Hi[2][2];
    x /= w; y /= w;
    var rx = +rect.getAttribute("x"), ry = +rect.getAttribute("y");
    var rw = +rect.getAttribute("width"), rh = +rect.getAttribute("height");
    return {
        vx: ((x - rx) / rw) * xspan,
        vy: ((ry + rh - y) / rh) * yspan,
    };
}

// Live position crosshair for the tablesaw/planer projections (their rail
// maps don't draw one). Injected once, then moved by transform on every
// status tick — no re-render needed.
function stArDrawPos() {
    var svg = document.getElementById("st-ar-svg");
    var rect = svg && svg.querySelector("rect");
    var t = stTableRect();
    var xspan = t.xspan, yspan = t.yspan;
    if (!rect || !(xspan > 0) || !(yspan > 0)) return;
    var rx = +rect.getAttribute("x"), ry = +rect.getAttribute("y");
    var rw = +rect.getAttribute("width"), rh = +rect.getAttribute("height");
    var mx = Math.max(0, Math.min(xspan, (Number(state.pos.x) || 0) + state.g55.x - t.x0));
    var my = Math.max(0, Math.min(yspan, (Number(state.pos.y) || 0) + state.g55.y - t.y0));
    var px = rx + (mx / xspan) * rw;
    var py = ry + rh - (my / yspan) * rh;
    var g = svg.querySelector("#st-ar-pos");
    if (!g) {
        g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("id", "st-ar-pos");
        g.innerHTML =
            '<line x1="-7" y1="0" x2="7" y2="0" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>' +
            '<line x1="0" y1="-7" x2="0" y2="7" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>' +
            '<line x1="-7" y1="0" x2="7" y2="0" stroke="#c0392b" stroke-width="1.5"/>' +
            '<line x1="0" y1="-7" x2="0" y2="7" stroke="#c0392b" stroke-width="1.5"/>' +
            '<circle cx="0" cy="0" r="3" fill="none" stroke="#c0392b" stroke-width="1.5"/>';
        svg.appendChild(g);
    }
    g.setAttribute("transform", "translate(" + px + " " + py + ")");
}

function stArEnter(tool) {
    if (stAr.tool || !stArAvailable()) return;
    var panel = document.getElementById("st-panel-" + tool);
    var stage = document.getElementById("st-ar-stage");
    if (!panel || !stage) return;
    stAr.tool = tool;
    stAr._home = { parent: panel.parentNode, next: panel.nextSibling };
    var float_ = document.getElementById("st-ar-float");
    float_.appendChild(panel);
    if (stAr._floatPos) {
        float_.style.left = stAr._floatPos.x + "px";
        float_.style.top = stAr._floatPos.y + "px";
        float_.style.right = "auto";
    }
    document.getElementById("st-ar-video").src =
        "http://" + window.location.hostname + ":" + (stAr.camPort === 2 ? 3142 : 3141) + "/?t=" + Date.now();
    $(stage).show();
    requestAnimationFrame(function () { stage.classList.add("st-ar-open"); });
    $(".ts-st-arbtn", panel).addClass("st-ar-active");
    stArSync(ST_AR_SVGS[tool]); // re-renders itself, so a stale map is fine
}

function stArExit() {
    if (!stAr.tool) return;
    var tool = stAr.tool;
    var stage = document.getElementById("st-ar-stage");
    var panel = document.getElementById("st-panel-" + tool);
    document.getElementById("st-ar-video").src = ""; // stop the MJPEG stream
    stage.classList.remove("st-ar-open");
    $(stage).hide();
    if (stAr._home && panel) stAr._home.parent.insertBefore(panel, stAr._home.next);
    stAr.tool = null;
    stAr._home = null;
    $(".ts-st-arbtn").removeClass("st-ar-active");
    ST_AR_RENDERS[tool](); // re-fit the map at card size
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
    var t = stTableRect();
    var xspan = t.xspan, yspan = t.yspan;
    if (!(xspan > 0) || !(yspan > 0)) {
        // No envelope configured — just leave an empty frame.
        svg.setAttribute("width", 150);
        svg.setAttribute("height", 110);
        svg.innerHTML = '<rect x="1" y="1" width="148" height="108" fill="#f7f8f9" stroke="#d5dbdb"/>' +
            '<text x="75" y="58" text-anchor="middle" font-size="10" fill="#95a5a6">' + window.t("tool_status.shoptools.no_envelope") + "</text>";
        stPlaceBtns("st-panel-drill");
        return;
    }
    // Margins reserved for the dimension labels. The rect is sized from
    // the envelope's aspect ratio within the width the row can actually
    // spare (stEnvCap) — the map contracts before anything else moves.
    var MB = 13; // below the rect: X dimension
    var MR = 13; // right of the rect: Y dimension (rotated)
    var maxRW = stEnvCap("st-env-svg") - MR - 2;
    var maxRH = (stArRender ? ST_AR_RENDER_H : 150) - MB - 2;
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
    var mxr = (Number(state.pos.x) || 0) + state.g55.x - t.x0;
    var myr = (Number(state.pos.y) || 0) + state.g55.y - t.y0;
    var mx = Math.max(0, Math.min(xspan, mxr));
    var my = Math.max(0, Math.min(yspan, myr));
    var px = (mx / xspan) * rw + 1;
    var py = 1 + rh - (my / yspan) * rh; // machine Y+ is up

    // Array preview: one dot per additional hole, stepping +X/+Y from the
    // (unclamped) current position; holes that would land outside the
    // envelope are simply not drawn.
    var tgt = stDrill.target;
    var bxr = tgt ? tgt.x : mxr;
    var byr = tgt ? tgt.y : myr;
    var dots = "";
    if (stArrayMode) {
        for (var j = 0; j < stArray.yn; j++) {
            for (var i = 0; i < stArray.xn; i++) {
                if (!i && !j) continue; // first hole is the target/crosshair itself
                var hx = bxr + i * stArray.xs;
                var hy = byr + j * stArray.ys;
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

    // Drill target marker: blue circled dot where DRILL will go when a
    // target is pinned, else an invisible grab ring riding the crosshair.
    // Drag it off to set a target; drop it back on the crosshair to
    // return to drill-at-position.
    var tmark;
    if (tgt) {
        var tpx = (Math.max(0, Math.min(xspan, tgt.x)) / xspan) * rw + 1;
        var tpy = 1 + rh - (Math.max(0, Math.min(yspan, tgt.y)) / yspan) * rh;
        var tlbl = fmt(tgt.x + t.x0 - state.g55.x) + ", " +
                   fmt(tgt.y + t.y0 - state.g55.y);
        var ttx = tpx + 9;
        var tanchor = "start";
        if (tpx > rw - 60) { ttx = tpx - 9; tanchor = "end"; }
        tmark =
            '<circle cx="' + tpx + '" cy="' + tpy + '" r="7" fill="none" stroke="#fff" stroke-width="3.5"/>' +
            '<circle cx="' + tpx + '" cy="' + tpy + '" r="7" fill="none" stroke="#2980b9" stroke-width="1.8"/>' +
            '<circle cx="' + tpx + '" cy="' + tpy + '" r="1.8" fill="#2980b9"/>' +
            '<text x="' + ttx + '" y="' + (tpy - 8) + '" text-anchor="' + tanchor + '" font-size="10" font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="2.5" fill="#2980b9">' + tlbl + "</text>" +
            '<circle cx="' + tpx + '" cy="' + tpy + '" r="14" fill="transparent" data-handle="target"/>';
    } else {
        tmark = '<circle cx="' + px + '" cy="' + py + '" r="12" fill="transparent" data-handle="target"/>';
    }

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
        '<text x="' + (W - 3) + '" y="' + (1 + rh / 2) + '" text-anchor="middle" font-size="9" fill="#7f8c8d" transform="rotate(-90 ' + (W - 3) + " " + (1 + rh / 2) + ')">' + dim(yspan) + "</text>" +
        stOriginBadge(5, rh - 3) +
        tmark;
    stPlaceBtns("st-panel-drill");
    stArSync("st-env-svg");
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
    // Spiral bore reads as a wider hole: scale the bar by hole/bit,
    // capped so it stays inside the slab.
    var barW = 10;
    if (stDrill.bit > 0 && stDrill.hole > stDrill.bit) {
        barW = Math.min(LW - 8, Math.round((10 * stDrill.hole) / stDrill.bit));
    }

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

// ---- Planer model ----
// A raster pocket over an area of the table. The area is picked with
// two-handle range bars on the envelope map (machine coordinates,
// relative to envelope min); the raster runs at `angle` degrees (0 =
// along X, 90 = along Y), passes spaced bit × stepover%. The area
// bounds the BIT CENTER — no diameter compensation, so the cut extends
// a bit radius past the picked edges. The area may extend past the
// table edges by up to stpOvercut() per side (one bit radius) so
// edge-to-edge surfacing actually cleans the edges. Depth is below
// Z zero. dir
// "2way" = serpentine at depth; "1way" = cut, lift, return, plunge.
var stPlaner = {
    x0: 0, x1: 0, y0: 0, y1: 0, // area, machine units from envelope min
    bit: 1,
    step: 40, // percent of bit
    depth: 0.05,
    angle: 0,
    dir: "2way",
    inited: false,
};

function stpDefaults() {
    return state.unit === "mm" ? { bit: 25, depth: 1 } : { bit: 1, depth: 0.05 };
}

function stpSpans() {
    var t = stTableRect();
    var xspan = t.xspan, yspan = t.yspan;
    if (!(xspan > 0)) xspan = 24;
    if (!(yspan > 0)) yspan = 18;
    return { xspan: xspan, yspan: yspan };
}

// How far past each table edge the planed area may extend ("overcut"):
// one bit radius. The area bounds the bit CENTER, so letting it past the
// edge is what actually cleans the table edge (the cut already spills a
// radius past the area). Not capped to the envelope's declared
// overtravel — big surfacing bits legitimately want more than the
// nominal margin; if soft limits are on and the travel really isn't
// there, the engine's bounds check reports it at run time, where the
// user can see and decide.
function stpOvercut() {
    return Number(stPlaner.bit) > 0 ? stPlaner.bit / 2 : 0;
}

// Pull the area back inside the current overcut allowance. Needed when
// the allowance shrinks under a saved area (a smaller bit).
function stpClampArea() {
    var s = stpSpans();
    var oc = stpOvercut();
    var p = stPlaner;
    p.x0 = Math.max(-oc, Math.min(s.xspan + oc, p.x0));
    p.x1 = Math.max(p.x0, Math.min(s.xspan + oc, p.x1));
    p.y0 = Math.max(-oc, Math.min(s.yspan + oc, p.y0));
    p.y1 = Math.max(p.y0, Math.min(s.yspan + oc, p.y1));
}

// Map geometry shared by the renderer and the drag handler. Margins hold
// the range bars and their three segment numbers. The table saw map
// reuses this wholesale (same margins, same fit) — it just passes its
// own svg id so the width cap is measured in its panel.
function stpGeom(svgId) {
    var s = stpSpans();
    // Top/right margins must exceed the handle radius (~5.5px with
    // stroke) so a handle at the far end of its bar isn't clipped by
    // the svg edge.
    var ML = 32, MB = 30, MT = 7, MR = 7;
    var maxRW = stEnvCap(svgId || "stp-env-svg") - ML - MR;
    var maxRH = (stArRender ? ST_AR_RENDER_H : 150) - MT - MB;
    var rw = maxRW;
    var rh = (rw * s.yspan) / s.xspan;
    if (rh > maxRH) { rh = maxRH; rw = (rh * s.xspan) / s.yspan; }
    return {
        xspan: s.xspan, yspan: s.yspan,
        ML: ML, MT: MT,
        rw: Math.round(rw), rh: Math.round(rh),
        W: Math.round(rw) + ML + MR, H: Math.round(rh) + MT + MB,
    };
}

// Raster passes for the bit center, clipped to the picked area (no
// diameter compensation). Returns segments {a:[x,y], b:[x,y],
// type:"cut"|"step"|"air"} in machine units, ordered. coarseN caps the
// pass count for the schematic detail view — same structure (direction,
// turnarounds, jog returns), legibly few passes. The real job NEVER
// passes coarseN.
function stpToolpath(coarseN) {
    var xa = stPlaner.x0, xb = stPlaner.x1;
    var ya = stPlaner.y0, yb = stPlaner.y1;
    var th = (stPlaner.angle * Math.PI) / 180;
    var dx = Math.cos(th), dy = Math.sin(th);   // pass direction
    var nx = -Math.sin(th), ny = Math.cos(th);  // stepover direction
    // Perpendicular extent across the inset rect's corners
    var cs = [xa * nx + ya * ny, xa * nx + yb * ny, xb * nx + ya * ny, xb * nx + yb * ny];
    var cmin = Math.min.apply(null, cs), cmax = Math.max.apply(null, cs);
    var step = stPlaner.bit * (stPlaner.step / 100);
    var n = step > 0 ? Math.ceil((cmax - cmin) / step - 1e-9) : 1;
    n = Math.max(1, Math.min(n, 500));
    if (coarseN) n = Math.min(n, coarseN);
    var passes = [];
    for (var i = 0; i <= n; i++) {
        var c = cmax === cmin ? cmin : cmin + ((cmax - cmin) * i) / n;
        // Line p(t) = c·n̂ + t·d̂ clipped to the inset rect (per-axis
        // t-intervals intersected; degenerate axes pass if in range)
        var t0 = -Infinity, t1 = Infinity, ok = true;
        [[dx, c * nx, xa, xb], [dy, c * ny, ya, yb]].forEach(function (ax) {
            var d = ax[0], p = ax[1];
            if (Math.abs(d) < 1e-9) {
                if (p < ax[2] - 1e-6 || p > ax[3] + 1e-6) ok = false;
            } else {
                var ta = (ax[2] - p) / d, tb = (ax[3] - p) / d;
                t0 = Math.max(t0, Math.min(ta, tb));
                t1 = Math.min(t1, Math.max(ta, tb));
            }
        });
        if (!ok || t0 > t1) continue;
        passes.push([[c * nx + t0 * dx, c * ny + t0 * dy], [c * nx + t1 * dx, c * ny + t1 * dy]]);
        if (cmax === cmin) break;
    }
    var segs = [];
    var prevEnd = null;
    passes.forEach(function (p, i) {
        var a = p[0], b = p[1];
        if (stPlaner.dir === "2way" && i % 2 === 1) { a = p[1]; b = p[0]; }
        if (prevEnd) segs.push({ a: prevEnd, b: a, type: stPlaner.dir === "2way" ? "step" : "air" });
        segs.push({ a: a, b: b, type: "cut" });
        prevEnd = b;
    });
    return segs;
}

function stpFmtLen(v) {
    return String(Math.round(v * 10) / 10);
}

// Angle-slider magnifier: u eases 0..1 while the slider is held so the
// pattern zooms in smoothly and glides back out on release. The rAF loop
// re-renders the whole map each step (it's one small SVG).
var stpZoom = { u: 0, target: 0, raf: null };
function stpZoomTo(target) {
    stpZoom.target = target;
    if (stpZoom.raf) return; // a running tween chases the new target
    var step = function () {
        stpZoom.raf = null;
        var d = stpZoom.target - stpZoom.u;
        if (Math.abs(d) < 0.02) {
            stpZoom.u = stpZoom.target;
        } else {
            stpZoom.u += d * 0.22;
            stpZoom.raf = requestAnimationFrame(step);
        }
        renderStpEnv();
    };
    stpZoom.raf = requestAnimationFrame(step);
}

// Planer envelope map: area range bars with two handles each, segment
// length numbers, and the raster toolpath preview.
function renderStpEnv() {
    var svg = document.getElementById("stp-env-svg");
    if (!svg) return;
    var g = stpGeom();
    svg.setAttribute("width", g.W);
    svg.setAttribute("height", g.H);
    var X = function (v) { return g.ML + (v / g.xspan) * g.rw; };
    var Y = function (v) { return g.MT + g.rh - (v / g.yspan) * g.rh; };
    var p = stPlaner;
    // Detail view (computed up front so arrow sizing below can use it):
    // while the angle slider is held (stpZoom.u eases 0→1), the area
    // glides to the table rect's center and scales up only as far as
    // still FITS inside the rect — the whole pattern stays visible,
    // because the interesting parts (turnarounds, jog returns) are at
    // its edges. Legibility comes from the schematic toolpath below, not
    // from magnification. Bars, handles, numbers stay put outside.
    var acx = (X(p.x0) + X(p.x1)) / 2;
    var acy = (Y(p.y0) + Y(p.y1)) / 2;
    var aw = Math.max(X(p.x1) - X(p.x0), 1);
    var ah = Math.max(Y(p.y0) - Y(p.y1), 1);
    var K = Math.max(1, Math.min(14, 0.85 * Math.min(g.rw / aw, g.rh / ah)));
    var u = stpZoom.u;
    var z = 1 + u * (K - 1);
    var tx = u * (g.ML + g.rw / 2 - K * acx);
    var ty = u * (g.MT + g.rh / 2 - K * acy);
    var parts = [
        '<rect x="' + g.ML + '" y="' + g.MT + '" width="' + g.rw + '" height="' + g.rh + '" fill="#f4f1ea" stroke="#a8a49a"/>',
    ];
    // Area rect + toolpath go in their own group so the zoom can magnify
    // them together. non-scaling-stroke keeps lines hairline at any zoom.
    var inner = [
        '<rect x="' + X(p.x0) + '" y="' + Y(p.y1) + '" width="' + (X(p.x1) - X(p.x0)) + '" height="' + (Y(p.y0) - Y(p.y1)) + '" fill="#d4b585" fill-opacity="0.55" stroke="#a8834f" vector-effect="non-scaling-stroke"/>',
    ];
    // Direction arrowhead at a segment's midpoint. Arm length is divided
    // by the zoom so arrows stay the same size on screen; segments too
    // short to carry one at the current zoom just go without.
    function stpArrow(a, b, color) {
        var x1 = X(a[0]), y1 = Y(a[1]), x2 = X(b[0]), y2 = Y(b[1]);
        var dx = x2 - x1, dy = y2 - y1;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len * z < 26) return "";
        var ux = dx / len, uy = dy / len;
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var s = 7 / z; // barb arm, constant on screen
        var b1x = mx - s * (ux * 0.866 - uy * 0.5), b1y = my - s * (uy * 0.866 + ux * 0.5);
        var b2x = mx - s * (ux * 0.866 + uy * 0.5), b2y = my - s * (uy * 0.866 - ux * 0.5);
        return '<path d="M' + b1x + " " + b1y + " L" + mx + " " + my + " L" + b2x + " " + b2y +
            '" fill="none" stroke="' + color + '" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    }
    // Toolpath layer: everything at depth (cuts AND stepovers) in solid
    // blue; true air moves (1-way jog returns) in dashed red. Midpoint
    // arrows show travel direction on both.
    function stpLayer(segs, alpha, withArrows) {
        var out = ['<g opacity="' + alpha + '">'];
        segs.forEach(function (s) {
            var air = s.type === "air";
            var style = air
                ? 'stroke="#c0392b" stroke-width="0.75" stroke-dasharray="3,2"'
                : 'stroke="#2980b9" stroke-width="1"';
            out.push('<line x1="' + X(s.a[0]) + '" y1="' + Y(s.a[1]) + '" x2="' + X(s.b[0]) + '" y2="' + Y(s.b[1]) + '" ' + style + ' vector-effect="non-scaling-stroke"/>');
            if (withArrows) out.push(stpArrow(s.a, s.b, air ? "#c0392b" : "#2980b9"));
        });
        out.push("</g>");
        return out.join("");
    }
    // At rest, the true pass count with no arrows (at that density they
    // read as banding on the material); in the detail view, a schematic
    // with at most 6 passes and direction arrows — same angle, direction,
    // turnarounds, and jog returns, but coarse enough to actually read.
    // They crossfade with the zoom tween.
    if (u < 0.999) inner.push(stpLayer(stpToolpath(), 1 - u, false));
    if (u > 0.001) inner.push(stpLayer(stpToolpath(6), u, true));
    // Clip and transform must live on separate nested groups: a clip-path
    // on the transformed group itself would be scaled along with the
    // content, and the pattern would spill past the table rect.
    // The clip extends past the table rect by the overcut allowance so an
    // overcutting area (and its passes) visibly overhangs the table edge
    // instead of being cropped at it.
    var oc = stpOvercut();
    var exX = (oc / g.xspan) * g.rw, exY = (oc / g.yspan) * g.rh;
    parts.push('<clipPath id="stp-zclip"><rect x="' + (g.ML - exX) + '" y="' + (g.MT - exY) +
        '" width="' + (g.rw + 2 * exX) + '" height="' + (g.rh + 2 * exY) + '"/></clipPath>');
    parts.push('<g clip-path="url(#stp-zclip)"><g transform="matrix(' + z + " 0 0 " + z + " " + tx + " " + ty + ')">' + inner.join("") + "</g></g>");
    parts.push(stOriginBadge(g.ML + 4, g.MT + g.rh - 4));
    // Range bars: track, active span, grabbable handles
    var bx = g.MT + g.rh + 9;  // X bar y
    var by = g.ML - 9;         // Y bar x
    function handle(cx, cy, id) {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="4.5" fill="#fff" stroke="#2980b9" stroke-width="2" data-handle="' + id + '"/>' +
               '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="transparent" data-handle="' + id + '"/>';
    }
    parts.push('<line x1="' + g.ML + '" y1="' + bx + '" x2="' + (g.ML + g.rw) + '" y2="' + bx + '" stroke="#d5dbdb" stroke-width="2"/>');
    parts.push('<line x1="' + X(p.x0) + '" y1="' + bx + '" x2="' + X(p.x1) + '" y2="' + bx + '" stroke="#2980b9" stroke-width="4"/>');
    parts.push('<line x1="' + by + '" y1="' + g.MT + '" x2="' + by + '" y2="' + (g.MT + g.rh) + '" stroke="#d5dbdb" stroke-width="2"/>');
    parts.push('<line x1="' + by + '" y1="' + Y(p.y1) + '" x2="' + by + '" y2="' + Y(p.y0) + '" stroke="#2980b9" stroke-width="4"/>');
    // Segment numbers: to-start | area | to-end, centered per segment
    // Segment numbers carry data-edit/data-val and are typeable in
    // place via #stp-edit (same pattern as the table saw's labels).
    // Edge-distance numbers stay visible once their handle reaches (or
    // passes) the table edge, even though their segment has no width —
    // they're the typing target for overcut: entering a negative edge
    // distance pushes the area past the table by up to stpOvercut().
    function xnum(a, b, v, bold, key) {
        var atEdge = !bold && v < 0.011;
        if (b - a < 12 && !atEdge) return "";
        return '<text x="' + (a + b) / 2 + '" y="' + (bx + 13) + '" text-anchor="middle" font-size="8"' +
            ' data-edit="' + key + '" data-val="' + Math.round(v * 1000) / 1000 + '"' +
            (bold ? ' font-weight="700" fill="#2c3e50"' : ' fill="#7f8c8d"') + ">" + stpFmtLen(v) + "</text>";
    }
    function ynum(yA, yB, v, bold, key) {
        var atEdge = !bold && v < 0.011;
        if (yA - yB < 12 && !atEdge) return "";
        var cy = (yA + yB) / 2, cx = by - 10;
        return '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" font-size="8"' +
            ' data-edit="' + key + '" data-val="' + Math.round(v * 1000) / 1000 + '"' +
            (bold ? ' font-weight="700" fill="#2c3e50"' : ' fill="#7f8c8d"') +
            ' transform="rotate(-90 ' + cx + " " + cy + ')" dominant-baseline="central">' + stpFmtLen(v) + "</text>";
    }
    parts.push(xnum(g.ML, X(p.x0), p.x0, false, "x0"));
    parts.push(xnum(X(p.x0), X(p.x1), p.x1 - p.x0, true, "xw"));
    parts.push(xnum(X(p.x1), g.ML + g.rw, g.xspan - p.x1, false, "x1r"));
    parts.push(ynum(g.MT + g.rh, Y(p.y0), p.y0, false, "y0"));
    parts.push(ynum(Y(p.y0), Y(p.y1), p.y1 - p.y0, true, "yh"));
    parts.push(ynum(Y(p.y1), g.MT, g.yspan - p.y1, false, "y1r"));
    parts.push(handle(X(p.x0), bx, "x0"));
    parts.push(handle(X(p.x1), bx, "x1"));
    parts.push(handle(by, Y(p.y0), "y0"));
    parts.push(handle(by, Y(p.y1), "y1"));
    svg.innerHTML = parts.join("");
    stPlaceBtns("st-panel-planer");
    stArSync("stp-env-svg");
}

function stpSyncInputs() {
    $("#stp-bit").val(stPlaner.bit || "");
    $("#stp-step").val(stPlaner.step);
    $("#stp-depth").val(stPlaner.depth || "");
    $("#stp-angle").val(stPlaner.angle);
    $("#stp-angle-slider").val(stPlaner.angle);
    $('input[name="stp-dir"][value="' + stPlaner.dir + '"]').prop("checked", true);
}

function stpSave() {
    saveShopToolPref("planer", {
        x0: stPlaner.x0, x1: stPlaner.x1, y0: stPlaner.y0, y1: stPlaner.y1,
        bit: stPlaner.bit, step: stPlaner.step, depth: stPlaner.depth,
        angle: stPlaner.angle, dir: stPlaner.dir, unit: state.unit,
    });
}

// ---- Chop saw model ----
// Turns an order of strips into a kerf-aware nest on a sheet and cuts
// each piece out with an outside profile pass. The sheet's near corner
// is the current XY zero (work 0,0) and Z is zeroed on the sheet
// surface. Pieces are separated by exactly one bit diameter, so
// neighboring pieces' bit-center paths coincide on the shared edge —
// the gap between pieces is one kerf, nothing wasted between strips.
var stChop = {
    items: [], // cut list: [{qty, w, l}] in current units
    sheetW: 0, // 0 → default to the table size
    sheetL: 0,
    thickness: 0,
    bit: 0,
    passes: 2,
    inited: false,
    _nest: null, // {placed, missed, total} — recomputed on any input change
};

function stcsDefaults() {
    return state.unit === "mm"
        ? { sheetW: 1220, sheetL: 2440, thickness: 18, bit: 6, breakthrough: 0.5 }
        : { sheetW: 48, sheetL: 96, thickness: 0.75, bit: 0.25, breakthrough: 0.02 };
}

// One number token: "3", "3.5", ".5", "1/2", "3 1/2".
function stcsNum(tok) {
    var m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(tok);
    if (m) return +m[1] + +m[2] / +m[3];
    m = /^(\d+)\/(\d+)$/.exec(tok);
    if (m) return +m[1] / +m[2];
    return parseFloat(tok);
}


// Shelf-nest the order onto the sheet (sheet coords: x along length L,
// y along width W, origin at the near corner). Pieces lie length-along-X
// and are sorted widest-first so rows pack tight; a piece too long for
// the sheet tries rotated. Gap between pieces AND between rows is one
// kerf; margin keeps the outermost bit-center paths on the sheet.
// Returns {placed: [{x, y, l, w, item, rot}], missed: [item indexes],
// total}.
function stcsNest(items, sheetL, sheetW, kerf, margin) {
    var pieces = [];
    items.forEach(function (it, idx) {
        for (var i = 0; i < it.qty; i++) pieces.push({ w: it.w, l: it.l, item: idx, rot: false });
    });
    pieces.sort(function (a, b) { return b.w - a.w || b.l - a.l; });
    var maxX = sheetL - margin, maxY = sheetW - margin;
    var placed = [], missed = [];
    var row = { x: margin, y: margin, h: 0 };
    var EPS = 1e-9;
    pieces.forEach(function (p) {
        if (p.l > maxX - margin + EPS && p.w <= maxX - margin + EPS) {
            var t = p.l; p.l = p.w; p.w = t; p.rot = true;
        }
        if (row.x + p.l > maxX + EPS && row.h > 0) {
            row = { x: margin, y: row.y + row.h + kerf, h: 0 };
        }
        if (row.x + p.l > maxX + EPS || row.y + p.w > maxY + EPS) {
            missed.push(p.item);
            return;
        }
        placed.push({ x: row.x, y: row.y, l: p.l, w: p.w, item: p.item, rot: p.rot });
        row.x += p.l + kerf;
        row.h = Math.max(row.h, p.w);
    });
    return { placed: placed, missed: missed, total: pieces.length };
}

// SBP for one piece's outside profile, bit center offset r outside the
// rectangle, climb direction (CW around an outside profile with a CW
// spindle), one lap per pass depth.
function stcsCutLines(p, r, depths, safeZ) {
    var r4 = function (v) { return Math.round(v * 10000) / 10000; };
    var x0 = r4(p.x - r), y0 = r4(p.y - r);
    var x1 = r4(p.x + p.l + r), y1 = r4(p.y + p.w + r);
    var lines = ["JZ, " + safeZ, "J2, " + x0 + ", " + y0];
    depths.forEach(function (z) {
        lines.push("MZ, " + z);
        lines.push("M2, " + x0 + ", " + y1);
        lines.push("M2, " + x1 + ", " + y1);
        lines.push("M2, " + x1 + ", " + y0);
        lines.push("M2, " + x0 + ", " + y0);
    });
    lines.push("JZ, " + safeZ);
    return lines;
}

// Sheet size: entered values, else the table itself (the common "full
// sheet on the table" case), else the unit default for odd envelopes.
function stcsSheet() {
    var t = stTableRect();
    var d = stcsDefaults();
    return {
        w: stChop.sheetW > 0 ? stChop.sheetW : t.yspan > 0 ? t.yspan : d.sheetW,
        l: stChop.sheetL > 0 ? stChop.sheetL : t.xspan > 0 ? t.xspan : d.sheetL,
    };
}

// Re-nest from the current inputs; called on any change and before CUT.
function stcsRecalc() {
    var s = stcsSheet();
    var bit = stChop.bit > 0 ? stChop.bit : stcsDefaults().bit;
    stChop._nest = stcsNest(stChop.items, s.l, s.w, bit, bit / 2);
    renderStcsEnv();
}

// Rebuild the cut list rows (qty · w × l, each with a remove button).
function renderStcsList() {
    var $list = $("#stcs-list");
    if (!$list.length) return;
    $list.empty();
    stChop.items.forEach(function (it, i) {
        var $row = $('<div class="ts-stcs-row"></div>');
        $row.append($("<span></span>").text(
            window.t("tool_status.shoptools.piece_row", { qty: it.qty, w: stpFmtLen(it.w), l: stpFmtLen(it.l) })
        ));
        $row.append(
            $('<button class="ts-stcs-del" title="' + window.t("tool_status.shoptools.remove_piece_title") + '">&#215;</button>')
                .attr("data-idx", i)
        );
        $list.append($row);
    });
}

function stcsSyncInputs() {
    var s = stcsSheet();
    $("#stcs-sheet-w").val(s.w);
    $("#stcs-sheet-l").val(s.l);
    $("#stcs-thick").val(stChop.thickness > 0 ? stChop.thickness : "");
    $("#stcs-bit").val(stChop.bit > 0 ? stChop.bit : "");
    $("#stcs-passes").val(stChop.passes);
    renderStcsList();
}

function stcsSave() {
    saveShopToolPref("chopsaw", {
        items: stChop.items,
        sheetW: stChop.sheetW,
        sheetL: stChop.sheetL,
        thickness: stChop.thickness,
        bit: stChop.bit,
        passes: stChop.passes,
        unit: state.unit,
    });
}

// Chop saw map: the table with the sheet parked at the current work
// zero and the nested pieces drawn on it. Pieces big enough on screen
// carry their size; the summary line below the order box reports the
// nest result (and, in red, anything that didn't fit).
function renderStcsEnv() {
    var svg = document.getElementById("stcs-env-svg");
    if (!svg) return;
    var g = stpGeom("stcs-env-svg");
    svg.setAttribute("width", g.W);
    svg.setAttribute("height", g.H);
    var X = function (v) { return g.ML + (v / g.xspan) * g.rw; };
    var Y = function (v) { return g.MT + g.rh - (v / g.yspan) * g.rh; };
    var t = stTableRect();
    // Sheet near corner = work (0,0) → map coords via the work offset
    var sx = (Number(state.g55.x) || 0) - t.x0;
    var sy = (Number(state.g55.y) || 0) - t.y0;
    var s = stcsSheet();
    var parts = [
        '<rect x="' + g.ML + '" y="' + g.MT + '" width="' + g.rw + '" height="' + g.rh + '" fill="#f4f1ea" stroke="#a8a49a"/>',
        '<rect x="' + X(sx) + '" y="' + Y(sy + s.w) + '" width="' + (X(sx + s.l) - X(sx)) + '" height="' + (Y(sy) - Y(sy + s.w)) +
            '" fill="#d4b585" fill-opacity="0.45" stroke="#a8834f"/>',
    ];
    var nest = stChop._nest;
    if (nest) {
        nest.placed.forEach(function (p) {
            var px = X(sx + p.x), py = Y(sy + p.y + p.w);
            var pw = X(sx + p.x + p.l) - X(sx + p.x);
            var ph = Y(sy + p.y) - Y(sy + p.y + p.w);
            parts.push('<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph +
                '" fill="#2980b9" fill-opacity="0.35" stroke="#2471a3" stroke-width="0.75"/>');
            if (pw > 26 && ph > 9) {
                parts.push('<text x="' + (px + pw / 2) + '" y="' + (py + ph / 2) + '" text-anchor="middle" dominant-baseline="central" font-size="7" fill="#2c3e50">' +
                    stpFmtLen(p.rot ? p.l : p.w) + "×" + stpFmtLen(p.rot ? p.w : p.l) + "</text>");
            }
        });
    }
    parts.push(stOriginBadge(g.ML + 4, g.MT + g.rh - 4));
    svg.innerHTML = parts.join("");
    var $sum = $("#stcs-summary");
    if ($sum.length) {
        if (!nest || !nest.total) {
            $sum.text("");
        } else {
            var html = window.t("tool_status.shoptools.chop_nested", { placed: nest.placed.length, total: nest.total });
            if (nest.missed.length) {
                html += ' · <span class="stcs-missed">' + window.t("tool_status.shoptools.chop_missed", { missed: nest.missed.length }) + "</span>";
            }
            $sum.html(html);
        }
    }
    stPlaceBtns("st-panel-chopsaw");
}

// ---- Table saw model ----
// One straight through-cut: a line through a draggable anchor point at
// an angle, stored 0..180° (0 = X-parallel crosscut, 90 = Y-parallel
// rip). The anchor is the user's "pencil mark"; endpoint handles and
// typed intercepts pivot the line about it, so the definition stays
// stable at every angle (intercept-pair schemes degenerate near the
// axes). Coordinates are envelope-relative like the other tools.
// pass = 0 → the whole depth in one pass; feed = 0 → the tool's current
// move speed (no MS emitted).
var stSaw = { ax: 0, ay: 0, angle: 90, depth: 0, pass: 0, feed: 0 };

// ∠ mode latches on when the line leaves 0°/90° (by drag or typing) and
// reveals the angle + intercept fields; only the | and — buttons clear
// it, so the fields don't blink away if a drag lands back on-axis.
var stsAngleMode = false;

function stsOffAxis(a) {
    return a > 0.05 && a < 179.95 && Math.abs(a - 90) > 0.05;
}

function stsAngleFrom(dx, dy) {
    var a = (Math.atan2(dy, dx) * 180) / Math.PI;
    a = ((a % 180) + 180) % 180;
    stSaw.angle = Math.round(a * 10) / 10;
    if (stsOffAxis(stSaw.angle)) stsAngleMode = true;
}

// Which table edge a chord endpoint sits on, with the value and field
// label to show for it (X along top/bottom, Y along left/right).
function stsEdgeOf(ept) {
    var s = stpSpans();
    var tolX = s.xspan * 1e-4, tolY = s.yspan * 1e-4;
    if (ept[1] <= tolY) return { key: "bottom", val: ept[0], label: window.t("tool_status.shoptools.x_at_bottom") };
    if (ept[1] >= s.yspan - tolY) return { key: "top", val: ept[0], label: window.t("tool_status.shoptools.x_at_top") };
    if (ept[0] <= tolX) return { key: "left", val: ept[1], label: window.t("tool_status.shoptools.y_at_left") };
    return { key: "right", val: ept[1], label: window.t("tool_status.shoptools.y_at_right") };
}

// Pivot the line about the anchor so it passes through the given
// boundary point — shared by the intercept fields and the on-map labels.
function stsPivotToEdge(edge, v) {
    var s = stpSpans();
    var px = edge === "left" ? 0 : edge === "right" ? s.xspan : v;
    var py = edge === "bottom" ? 0 : edge === "top" ? s.yspan : v;
    if (Math.abs(px - stSaw.ax) > 1e-9 || Math.abs(py - stSaw.ay) > 1e-9) {
        stsAngleFrom(px - stSaw.ax, py - stSaw.ay);
    }
}

// Selector + revealed-column state, and the angle/intercept field
// values. Runs on every render; fields the user is typing in are left
// alone, and the intercept labels retag to whichever edges the line
// currently crosses.
function stsSyncModeUI() {
    $("#sts-mode-rip").toggleClass("active", !stsAngleMode && Math.abs(stSaw.angle - 90) <= 0.05);
    $("#sts-mode-cross").toggleClass("active", !stsAngleMode && !stsOffAxis(stSaw.angle) && Math.abs(stSaw.angle - 90) > 0.05);
    $("#sts-arr-btn").toggleClass("active", stsArrayMode);
    $("#sts-array-col").toggle(stsArrayMode);
    if (stsArrayMode) {
        if (!$("#sts-arr-n").is(":focus")) $("#sts-arr-n").val(stsArr.n);
        if (!$("#sts-arr-s").is(":focus")) $("#sts-arr-s").val(stsArr.s);
    }
    $("#sts-angle-col").toggle(stsAngleMode);
    if (!stsAngleMode) return;
    var $a = $("#sts-angle");
    if (!$a.is(":focus")) $a.val(Math.round(stSaw.angle * 10) / 10);
    var chord = stsChord();
    [0, 1].forEach(function (i) {
        var $i = $("#sts-i" + i);
        if (!chord) { $i.val("").removeData("edge"); return; }
        var e = stsEdgeOf(chord[i]);
        $("#sts-i" + i + "-label").text(e.label);
        $i.data("edge", e.key);
        if (!$i.is(":focus")) $i.val(Math.round(e.val * 100) / 100);
    });
}

// Array mode: duplicate the cut stepped normal to the line. Session
// toggle like the drill's; the numbers persist with the other prefs.
// Spacing sign picks which side of the base line the copies fall on.
var stsArrayMode = false;
var stsArr = { n: 2, s: 1 };

// Unit normal to the cut line — the direction array copies step along.
function stsNormal() {
    var th = (stSaw.angle * Math.PI) / 180;
    return [-Math.sin(th), Math.cos(th)];
}

// The cut chord: the line through (ax, ay) — the anchor by default, or
// an array-offset copy — clipped to the table, as its two boundary
// endpoints (same parametric clip as the planer passes). Null when the
// line misses the table entirely (offset copies can).
function stsChord(ax, ay) {
    if (ax === undefined) { ax = stSaw.ax; ay = stSaw.ay; }
    var s = stpSpans();
    var th = (stSaw.angle * Math.PI) / 180;
    var dx = Math.cos(th), dy = Math.sin(th);
    var t0 = -Infinity, t1 = Infinity, ok = true;
    [[dx, ax, 0, s.xspan], [dy, ay, 0, s.yspan]].forEach(function (axis) {
        var d = axis[0], p = axis[1];
        if (Math.abs(d) < 1e-9) {
            if (p < axis[2] - 1e-6 || p > axis[3] + 1e-6) ok = false;
        } else {
            var ta = (axis[2] - p) / d, tb = (axis[3] - p) / d;
            t0 = Math.max(t0, Math.min(ta, tb));
            t1 = Math.min(t1, Math.max(ta, tb));
        }
    });
    if (!ok || t0 > t1) return null;
    return [
        [ax + t0 * dx, ay + t0 * dy],
        [ax + t1 * dx, ay + t1 * dy],
    ];
}

function stsSyncInputs() {
    $("#sts-ax").val(Math.round(stSaw.ax * 1000) / 1000);
    $("#sts-ay").val(Math.round(stSaw.ay * 1000) / 1000);
    $("#sts-depth").val(stSaw.depth > 0 ? stSaw.depth : "");
    $("#sts-pass").val(stSaw.pass > 0 ? stSaw.pass : "");
    $("#sts-feed").val(stSaw.feed > 0 ? stSaw.feed : "");
}

function stsSave() {
    saveShopToolPref("tablesaw", {
        ax: stSaw.ax, ay: stSaw.ay, angle: stSaw.angle,
        depth: stSaw.depth, pass: stSaw.pass, feed: stSaw.feed,
        unit: state.unit,
        arr: { n: stsArr.n, s: stsArr.s },
    });
}

// Table saw map: the cut line with endpoint handles on the table
// boundary, a draggable anchor, the angle labeled on the line, and the
// intercept values labeled at the edges. Angle and intercepts carry
// data-edit/data-val and are typeable in place via #sts-edit.
function renderStsEnv() {
    var svg = document.getElementById("sts-env-svg");
    if (!svg) return;
    var g = stpGeom("sts-env-svg");
    svg.setAttribute("width", g.W);
    svg.setAttribute("height", g.H);
    var X = function (v) { return g.ML + (v / g.xspan) * g.rw; };
    var Y = function (v) { return g.MT + g.rh - (v / g.yspan) * g.rh; };
    var round2 = function (v) { return Math.round(v * 100) / 100; };
    var halo = 'paint-order="stroke" stroke="#fff" stroke-width="2.5"';
    var parts = [
        '<rect x="' + g.ML + '" y="' + g.MT + '" width="' + g.rw + '" height="' + g.rh + '" fill="#f4f1ea" stroke="#a8a49a"/>',
    ];
    var chord = stsChord();
    if (chord) {
        // Array preview first, so the base line and handles draw on top.
        // Copies that fall off the table just don't draw.
        if (stsArrayMode) {
            var nrm = stsNormal();
            for (var ci = 1; ci < stsArr.n; ci++) {
                var c = stsChord(stSaw.ax + ci * stsArr.s * nrm[0], stSaw.ay + ci * stsArr.s * nrm[1]);
                if (!c) continue;
                parts.push('<line x1="' + X(c[0][0]) + '" y1="' + Y(c[0][1]) + '" x2="' + X(c[1][0]) + '" y2="' + Y(c[1][1]) + '" stroke="#2980b9" stroke-width="1" opacity="0.55"/>');
            }
        }
        var p0 = [X(chord[0][0]), Y(chord[0][1])];
        var p1 = [X(chord[1][0]), Y(chord[1][1])];
        parts.push('<line x1="' + p0[0] + '" y1="' + p0[1] + '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="#2980b9" stroke-width="2"/>');
        // Angle label: off the line's midpoint, perpendicular, clamped
        // into the table rect.
        var sdx = p1[0] - p0[0], sdy = p1[1] - p0[1];
        var slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        var lx = (p0[0] + p1[0]) / 2 - (sdy / slen) * 13;
        var ly = (p0[1] + p1[1]) / 2 + (sdx / slen) * 13;
        lx = Math.max(g.ML + 14, Math.min(g.ML + g.rw - 14, lx));
        ly = Math.max(g.MT + 10, Math.min(g.MT + g.rh - 4, ly));
        parts.push('<text x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="9" font-weight="700" fill="#2471a3" ' + halo +
            ' data-edit="angle" data-val="' + stSaw.angle + '">' + (Math.round(stSaw.angle * 10) / 10) + "&#176;</text>");
        // Intercept labels + endpoint handles. Bottom/left labels sit in
        // the (roomy) outer margins; top/right sit just inside the rect.
        chord.forEach(function (ept, i) {
            var px = X(ept[0]), py = Y(ept[1]);
            var e = stsEdgeOf(ept);
            var tx, ty, anchorAttr = 'text-anchor="middle"';
            if (e.key === "bottom") {
                tx = px; ty = g.MT + g.rh + 15;
            } else if (e.key === "top") {
                tx = px; ty = g.MT + 11;
            } else if (e.key === "left") {
                tx = g.ML - 4; ty = py + 3; anchorAttr = 'text-anchor="end"';
            } else {
                tx = g.ML + g.rw - 4; ty = py + 3; anchorAttr = 'text-anchor="end"';
            }
            tx = Math.max(8, Math.min(g.W - 2, tx));
            parts.push('<text x="' + tx + '" y="' + ty + '" ' + anchorAttr + ' font-size="8" font-weight="700" fill="#2471a3" ' + halo +
                ' data-edit="i-' + e.key + '" data-val="' + round2(e.val) + '">' + round2(e.val) + "</text>");
            parts.push('<circle cx="' + px + '" cy="' + py + '" r="4.5" fill="#fff" stroke="#2980b9" stroke-width="2" data-handle="e' + i + '"/>');
            parts.push('<circle cx="' + px + '" cy="' + py + '" r="10" fill="transparent" data-handle="e' + i + '"/>');
        });
        // Anchor: the pencil mark the cut pivots about
        var apx = X(stSaw.ax), apy = Y(stSaw.ay);
        parts.push('<circle cx="' + apx + '" cy="' + apy + '" r="5" fill="#e67e22" stroke="#fff" stroke-width="1.5" data-handle="anchor"/>');
        parts.push('<circle cx="' + apx + '" cy="' + apy + '" r="11" fill="transparent" data-handle="anchor"/>');
    }
    parts.push(stOriginBadge(g.ML + 4, g.MT + g.rh - 4));
    svg.innerHTML = parts.join("");
    stsSyncModeUI();
    stPlaceBtns("st-panel-tablesaw");
    stArSync("sts-env-svg");
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
    $("#st-drill-bit").val(stDrill.bit > 0 ? stDrill.bit : "");
    $("#st-drill-hole").val(stDrill.hole > 0 ? stDrill.hole : "");
}

function stSaveDrill() {
    saveShopToolPref("drill", {
        depth: stDrill.depth,
        thickness: stDrill.thickness,
        bit: stDrill.bit,
        hole: stDrill.hole,
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
// Console fill-in sheets (SB3/SB4-style). A bare two-letter command that
// takes parameters (VA, VC, MS, JS, ...) opens a dialog of its parameters
// instead of running immediately — the same behavior as the SB4 console.
// Command definitions come from assets/sb3_commands.json (SB4's annotated
// copy of the engine's command table).

var fillinCmds = null;
$.getJSON("assets/sb3_commands.json", function (data) {
    fillinCmds = data;
});

// Commands SB4 never opens a sheet for even though they match the pattern.
var FILLIN_EXCLUDE = { CN: true, "C#": true };

// SB4 appends SV so value/speed changes made from the console persist —
// each console command runs like a one-line file, so the values would
// otherwise revert when the next file runs.
var PERSIST_WITH_SV = { VN: true, VR: true, VS: true, MS: true };

function fillinEntryFor(cmd) {
    if (!fillinCmds) return null;
    if (!/^[A-Z][A-Z0-9#]$/.test(cmd)) return null;
    if (FILLIN_EXCLUDE[cmd]) return null;
    var entry = fillinCmds[cmd];
    return entry && entry.params && entry.params.length ? entry : null;
}

// Echo + run a console command (typed directly or assembled by the sheet).
function consoleRun(cmd) {
    consoleLog("> " + cmd);
    var mnemonic = cmd.substring(0, 2).toUpperCase();
    var lines = PERSIST_WITH_SV[mnemonic] ? cmd + "\nSV\n" : cmd + "\n";
    fabmo.runSBP(lines, function (err) {
        if (err) consoleLog(String(err.message || err), "ts-console-err");
    });
}

var fillinCmd = null; // command mnemonic while the sheet is open

// Assemble "VA, v1, v2, ..." from the sheet fields. Interior empties are
// kept as blank slots (OpenSBP skips them); trailing empties are dropped.
function fillinAssemble() {
    var vals = [];
    $("#fillin-params input").each(function () {
        vals.push($(this).val().trim());
    });
    while (vals.length && vals[vals.length - 1] === "") vals.pop();
    return vals.length ? fillinCmd + ", " + vals.join(", ") : fillinCmd;
}

function fillinPreview() {
    $("#fillin-preview").text(fillinAssemble());
}

function openFillin(cmd, entry) {
    fillinCmd = cmd;
    $("#fillin-title").text(cmd + ": " + (entry.name || ""));
    var $list = $("#fillin-params").empty();
    entry.params.forEach(function (p, i) {
        // Tooltip: the description, plus the value list for choice params.
        var tip = p.desc || "";
        if (p.opts && p.opts.length) {
            p.opts.forEach(function (o) {
                tip += "\n" + o.value + " = " + o.desc;
            });
        } else if (p.type === "ck") {
            tip += "\n0 = No\n1 = Yes";
        }
        var $label = $("<label></label>")
            .attr("for", "fillin-p" + i)
            .attr("title", tip)
            .text(p.name || "");
        if (p.disptype === "2") $label.append('<span class="ts-fillin-req">*</span>');
        var $input = $('<input type="text" autocomplete="off" spellcheck="false">')
            .attr("id", "fillin-p" + i)
            .attr("title", tip)
            .val(p.default !== undefined && p.default !== null ? String(p.default) : "");
        // The input sits inside a cell so the blue line rule runs the
        // full row width, not just under the 7em input.
        $list.append($label, $('<div class="ts-fillin-cell"></div>').append($input));
    });
    fillinPreview();
    $("#fillin-modal").css("display", "flex");
    setTimeout(function () {
        $("#fillin-params input").first().focus().select();
    }, 0);
}

function closeFillin() {
    $("#fillin-modal").css("display", "none");
    fillinCmd = null;
    $("#console-input").focus();
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
    $("#atc-type-badge").text(ATC_TYPE_LABELS[type] || window.t("tool_status.header.atc_type", { type: type }));
    var st = state.machineState || "—";
    $("#machine-state")
        .text(tOr("tool_status.states." + st, st))
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
        if (h) bits.push(window.t("tool_status.tools.len") + " " + fmt(Number(h)));
        $("#current-tool-caption").text(bits.join(" · ") || window.t("tool_status.current.in_spindle"));
    } else {
        $num.text("—").addClass("empty");
        $("#current-tool-caption").text(showToolRow() ? window.t("tool_status.current.no_tool") : "");
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
            if (label) defs.push({ input: Number(n), key: types[n], label: label });
        });
    if (defs.length) return defs;
    // Legacy fallback: hand-set sensor-number variables
    var vars = state.vars || {};
    [
        { input: Number(vars.TOOLBAR_SENSOR), key: "toolbar_present", label: "Toolbar" },
        { input: Number(vars.TOOL_SENSOR), key: "tool_present", label: "Tool" },
        { input: Number(vars.DRAWBAR_SENSOR), key: "drawbar_open", label: "Drawbar" },
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
        var sLabel = tOr("tool_status.sensors." + d.key, d.label);
        $s.attr("title", sLabel + " (input " + d.input + ")");
        $s.find(".ts-sensor-label").text(sLabel);
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
    // Drill's AR copy refreshes via renderStEnv above; the other tools'
    // maps are position-independent, so just move their AR crosshair.
    if (stAr.tool && stAr.tool !== "drill") stArDrawPos();
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
                ? window.t("tool_status.tools.clip") + " " + fmt(Number(clip.X)) + ", " + fmt(Number(clip.Y))
                : "";
        var tip = [name, h ? window.t("tool_status.tools.len") + " " + fmt(Number(h)) : "", clipLoc].filter(Boolean).join(" · ");
        if (tip) $clip.attr("title", tip);
        if (n === current) $clip.addClass("current");
        else if (!idle) $clip.addClass("disabled");
        $rack.append($clip);
    }
    $("#rack-note").text(idle ? window.t("tool_status.tools.rack_idle_note") : window.t("tool_status.tools.rack_busy_note"));
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
            .attr("title", window.t("tool_status.machine.run_macro_title", { n: macro }))
            .text(b.label || window.t("tool_status.machine.macro_n", { n: macro }));
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
        $q.append($('<div class="ts-empty">').text(window.t("tool_status.jobs.empty_queue")));
    } else {
        state.queue.forEach(function (job, i) {
            var $row = $(
                '<div class="ts-job ts-job-sortable' + (i === 0 ? " next" : "") + '">' +
                    '<span class="ts-drag-handle" title="' + window.t("tool_status.jobs.drag_reorder_title") + '">&#8942;&#8942;</span>' +
                    '<div class="ts-job-info">' +
                        '<div class="ts-job-name"></div>' +
                        '<div class="ts-job-meta">' + jobMeta(job) + "</div>" +
                    "</div>" +
                    '<button class="ts-iconbtn ts-job-preview" title="' + window.t("tool_status.jobs.preview_title") + '"><i class="fa fa-eye"></i></button>' +
                    '<button class="ts-iconbtn ts-job-edit" title="' + window.t("tool_status.jobs.edit_title") + '"><i class="fa fa-code"></i></button>' +
                    '<button class="ts-iconbtn ts-job-delete" title="' + window.t("tool_status.jobs.delete_title") + '"><i class="fa fa-trash"></i></button>' +
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
        $h.append($('<div class="ts-empty">').text(window.t("tool_status.jobs.empty_recent")));
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
            '<button class="ts-iconbtn ts-job-rerun" title="' + window.t("tool_status.jobs.rerun_title") + '">&#8635;</button>' +
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
        stAr.cal = (data.machine && data.machine.cameraCalibration) || null;
        stArRefreshBtns();
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
        var $list = $("#shortcut-pick-list").html($('<div class="ts-empty">').text(window.t("tool_status.shortcut_pick.loading")));
        // Re-fetch so a just-installed app shows up without reloading
        refreshApps(function () {
            $list.empty();
            // Same visibility rule as the dashboard app menu, minus this app
            var apps = (appsList || []).filter(function (a) {
                return a.id !== OWN_APP_ID && a.icon_display !== "none";
            });
            if (!apps.length) {
                $list.append($('<div class="ts-empty">').text(window.t("tool_status.shortcut_pick.none")));
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
        var $list = $("#macro-pick-list").html($('<div class="ts-empty">').text(window.t("tool_status.macro_pick.loading")));
        fabmo.getMacros(function (err, macros) {
            $list.empty();
            if (err || !macros || !macros.length) {
                $list.append($('<div class="ts-empty">').text(window.t("tool_status.macro_pick.none")));
                return;
            }
            macros.forEach(function (m) {
                var $row = $(
                    '<div class="ts-pick-entry">' +
                        '<div class="ts-pick-name"></div>' +
                        '<div class="ts-pick-desc"></div>' +
                        "</div>"
                );
                $row.find(".ts-pick-name").text("C" + m.index + " — " + (m.name || window.t("tool_status.machine.macro_n", { n: m.index })));
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
        $("#macro-btn-label").val(pickedMacro.name || window.t("tool_status.machine.macro_n", { n: pickedMacro.index }));
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
            label: ($("#macro-btn-label").val() || "").trim() || pickedMacro.name || window.t("tool_status.machine.macro_n", { n: pickedMacro.index }),
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
            $custom.append($('<div class="ts-empty">').text(window.t("tool_status.machine_settings.no_custom")));
        }
        buttons.forEach(function (b) {
            var $row = $(
                '<div class="ts-custom-row">' +
                    '<span class="ts-custom-macro">C' + Number(b.macro) + "</span>" +
                    '<input type="text">' +
                    '<button class="ts-iconbtn ms-custom-remove" title="' + window.t("tool_status.machine_settings.remove_button_title") + '"><i class="fa fa-trash"></i></button>' +
                    "</div>"
            );
            $row.data("macro", Number(b.macro));
            $row.find("input").val(b.label || "");
            $custom.append($row);
        });
        $("#machine-settings-units").text(window.t("tool_status.common.units_note", { units: state.unit }));
        $("#machine-settings-modal").css("display", "flex");
    });

    $("#ms-custom-list").on("click", ".ms-custom-remove", function () {
        $(this).closest(".ts-custom-row").remove();
        if (!$("#ms-custom-list .ts-custom-row").length) {
            $("#ms-custom-list").append($('<div class="ts-empty">').text(window.t("tool_status.machine_settings.no_custom")));
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
                label: ($row.find("input").val() || "").trim() || window.t("tool_status.machine.macro_n", { n: macro }),
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
            title: window.t("tool_status.tool_change.title"),
            message: window.t("tool_status.tool_change.message", {
                tool: tool,
                name: name ? " (" + name + ")" : "",
            }),
            okText: window.t("tool_status.tool_change.ok"),
            cancelText: window.t("tool_status.common.cancel"),
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
            var dbit = inCurrentUnits(p.bit, p.unit);
            var dhole = inCurrentUnits(p.hole, p.unit);
            stDrill.bit = dbit !== null && dbit > 0 ? dbit : 0;
            stDrill.hole = dhole !== null && dhole > 0 ? dhole : 0;
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
        if (tool === "tablesaw") {
            var ps = shopToolPrefs().tablesaw || {};
            var sp = stpSpans();
            var numS = function (v, dflt) {
                var c = inCurrentUnits(v, ps.unit);
                return c !== null ? c : dflt;
            };
            stSaw.ax = Math.max(0, Math.min(sp.xspan, numS(ps.ax, sp.xspan / 2)));
            stSaw.ay = Math.max(0, Math.min(sp.yspan, numS(ps.ay, sp.yspan / 2)));
            var an = Number(ps.angle);
            stSaw.angle = isFinite(an) ? ((an % 180) + 180) % 180 : 90;
            stsAngleMode = stsOffAxis(stSaw.angle);
            var sd = numS(ps.depth, 0);
            stSaw.depth = sd > 0 ? sd : 0;
            var spd = numS(ps.pass, 0);
            stSaw.pass = spd > 0 ? spd : 0;
            var sf = numS(ps.feed, 0);
            stSaw.feed = sf > 0 ? sf : 0;
            var sarr = ps.arr || {};
            stsArr.n = stCount(sarr.n || 2);
            var ss = numS(sarr.s, null);
            stsArr.s = ss !== null && ss !== 0 ? ss : state.unit === "mm" ? 25 : 1;
            stsArrayMode = false;
            // Show first so the envelope map can measure its real width
            showShopTool(tool);
            stsSyncInputs();
            renderStsEnv();
            return;
        }
        if (tool === "planer") {
            var pp = shopToolPrefs().planer || {};
            var pd = stpDefaults();
            var spans = stpSpans();
            var num = function (v, dflt) {
                var c = inCurrentUnits(v, pp.unit);
                return c !== null ? c : dflt;
            };
            stPlaner.bit = num(pp.bit, pd.bit) || pd.bit;
            stPlaner.depth = num(pp.depth, pd.depth) || pd.depth;
            stPlaner.step = Number(pp.step) >= 5 && Number(pp.step) <= 100 ? Number(pp.step) : 40;
            stPlaner.angle = Number(pp.angle) >= 0 && Number(pp.angle) <= 90 ? Number(pp.angle) : 0;
            stPlaner.dir = pp.dir === "1way" ? "1way" : "2way";
            stPlaner.x0 = num(pp.x0, spans.xspan * 0.25);
            stPlaner.x1 = Math.max(stPlaner.x0, num(pp.x1, spans.xspan * 0.75));
            stPlaner.y0 = num(pp.y0, spans.yspan * 0.25);
            stPlaner.y1 = Math.max(stPlaner.y0, num(pp.y1, spans.yspan * 0.75));
            stpClampArea(); // saved overcut re-clamped to this bit/envelope
            // A shrunken envelope (say X max 96 → 24) clamps both ends of a
            // saved range onto the same spot — a zero-width area with the
            // handles stacked. Start that axis over at the defaults.
            if (stPlaner.x1 <= stPlaner.x0) {
                stPlaner.x0 = spans.xspan * 0.25;
                stPlaner.x1 = spans.xspan * 0.75;
            }
            if (stPlaner.y1 <= stPlaner.y0) {
                stPlaner.y0 = spans.yspan * 0.25;
                stPlaner.y1 = spans.yspan * 0.75;
            }
            stPlaner.inited = true;
            showShopTool(tool);
            stpSyncInputs();
            renderStpEnv();
            return;
        }
        if (tool === "chopsaw") {
            var pcs = shopToolPrefs().chopsaw || {};
            var dcs = stcsDefaults();
            var numC = function (v, dflt) {
                var c = inCurrentUnits(v, pcs.unit);
                return c !== null && c > 0 ? c : dflt;
            };
            stChop.items = [];
            (Array.isArray(pcs.items) ? pcs.items : []).forEach(function (it) {
                var q = Math.round(Number(it && it.qty));
                var w = inCurrentUnits(it && it.w, pcs.unit);
                var l = inCurrentUnits(it && it.l, pcs.unit);
                if (q >= 1 && w > 0 && l > 0) {
                    stChop.items.push({ qty: Math.min(q, 200), w: w, l: l });
                }
            });
            stChop.sheetW = numC(pcs.sheetW, 0) || 0;
            stChop.sheetL = numC(pcs.sheetL, 0) || 0;
            stChop.thickness = numC(pcs.thickness, dcs.thickness);
            stChop.bit = numC(pcs.bit, dcs.bit);
            var pss = Math.round(Number(pcs.passes));
            stChop.passes = isFinite(pss) && pss >= 1 ? Math.min(pss, 10) : 2;
            stChop.inited = true;
            showShopTool(tool);
            stcsSyncInputs();
            stcsRecalc();
            return;
        }
        showShopTool(tool);
    });

    // ---- Planer: area handle dragging (pointer events so the kiosk
    // touchscreen works; the svg is rebuilt on every move, so the move/up
    // listeners live on the document, not the handle).

    var stpDrag = null;

    // When both handles of a range sit on the same spot, the max handle
    // (drawn last, so on top) swallows every grab — and pinned at the span
    // edge it has nowhere to go, deadlocking the pair. Defer the choice to
    // the first move: the drag direction picks the handle that can travel.
    function stpAmbiguate(name) {
        if ((name === "x0" || name === "x1") && stPlaner.x0 === stPlaner.x1) return "x?";
        if ((name === "y0" || name === "y1") && stPlaner.y0 === stPlaner.y1) return "y?";
        return name;
    }

    $("#stp-env-svg").on("pointerdown", "[data-handle]", function (e) {
        stpDrag = stpAmbiguate($(this).attr("data-handle"));
        e.preventDefault();
    });

    $(document).on("pointermove", function (e) {
        if (!stpDrag) return;
        var svg = document.getElementById("stp-env-svg");
        if (!svg) { stpDrag = null; return; }
        var box = svg.getBoundingClientRect();
        var g = stpGeom();
        var p = stPlaner;
        var ar = stAr._drag ? stArPointToEnv(e.clientX, e.clientY) : null;
        var oc = stpOvercut();
        if (stpDrag === "x0" || stpDrag === "x1" || stpDrag === "x?") {
            var vx = ar ? ar.vx : ((e.clientX - box.left - g.ML) / g.rw) * g.xspan;
            if (stpDrag === "x?") stpDrag = vx < p.x0 ? "x0" : "x1";
            if (stpDrag === "x0") p.x0 = Math.max(-oc, Math.min(p.x1, vx));
            else p.x1 = Math.min(g.xspan + oc, Math.max(p.x0, vx));
        } else {
            var vy = ar ? ar.vy : ((g.MT + g.rh - (e.clientY - box.top)) / g.rh) * g.yspan;
            if (stpDrag === "y?") stpDrag = vy < p.y0 ? "y0" : "y1";
            if (stpDrag === "y0") p.y0 = Math.max(-oc, Math.min(p.y1, vy));
            else p.y1 = Math.min(g.yspan + oc, Math.max(p.y0, vy));
        }
        renderStpEnv();
    });

    $(document).on("pointerup pointercancel", function () {
        if (!stpDrag) return;
        stpDrag = null;
        stpSave();
    });

    // In-place editing of the distance numbers around the map: hovering
    // (or tapping) one floats #stp-edit over it, focused and selected, so
    // it can be typed over directly. Enter/blur commits, Escape cancels.
    // Each number moves the handle on its own side; the bold middle one
    // moves the max handle to set the span. The cooldown stops a commit
    // from instantly re-opening the input under a still pointer (the
    // re-render fires a fresh pointerenter on the rebuilt label).
    var stpEditKey = null;
    var stpEditCooldown = 0;

    function stpOpenEdit(el, key, value) {
        if (Date.now() < stpEditCooldown) return;
        var $inp = $("#stp-edit");
        if (stpEditKey === key && $inp.is(":visible")) return;
        if (stpEditKey) $inp.blur(); // commit whatever is already open
        var wrap = $inp.parent()[0];
        var wb = wrap.getBoundingClientRect();
        var eb = el.getBoundingClientRect();
        stpEditKey = key;
        var left = Math.max(0, Math.min(wb.width - 54, eb.left + eb.width / 2 - wb.left - 27));
        var top = Math.max(0, Math.min(wb.height - 20, eb.top + eb.height / 2 - wb.top - 10));
        $inp.val(value).css({ left: left + "px", top: top + "px" }).show();
        $inp[0].focus();
        $inp[0].select();
    }

    function stpApplyEdit(key, v) {
        var s = stpSpans();
        var oc = stpOvercut();
        var p = stPlaner;
        // Edge distances (x0/x1r/y0/y1r) accept negatives: typing -0.25
        // into an edge number overcuts that side by 0.25 (up to the
        // allowance). The width/height numbers can likewise run past the
        // far edge by the far side's allowance.
        if (key === "x0") p.x0 = Math.max(-oc, Math.min(p.x1, v));
        else if (key === "xw") p.x1 = Math.min(s.xspan + oc, p.x0 + Math.max(0, v));
        else if (key === "x1r") p.x1 = Math.max(p.x0, Math.min(s.xspan + oc, s.xspan - v));
        else if (key === "y0") p.y0 = Math.max(-oc, Math.min(p.y1, v));
        else if (key === "yh") p.y1 = Math.min(s.yspan + oc, p.y0 + Math.max(0, v));
        else if (key === "y1r") p.y1 = Math.max(p.y0, Math.min(s.yspan + oc, s.yspan - v));
        stpSave();
        renderStpEnv();
    }

    function stpCommitEdit() {
        var key = stpEditKey;
        var v = parseFloat($("#stp-edit").val());
        stpEditKey = null;
        stpEditCooldown = Date.now() + 400;
        $("#stp-edit").hide();
        if (!key || !isFinite(v)) return;
        stpApplyEdit(key, v);
    }

    $("#stp-env-svg").on("pointerenter click", "[data-edit]", function () {
        var val = parseFloat($(this).attr("data-val"));
        stpOpenEdit(this, $(this).attr("data-edit"), isFinite(val) ? val : 0);
    });
    $("#stp-edit").on("keydown", function (e) {
        if (e.key === "Enter") $(this).blur();
        if (e.key === "Escape") {
            stpEditKey = null;
            stpEditCooldown = Date.now() + 400;
            $(this).hide();
        }
    });
    $("#stp-edit").on("blur", stpCommitEdit);

    // ---- AR in-place editing ----
    // stArSync copies the labels with their data-edit/data-val tags, so
    // the projection is editable the same way the flat maps are: hover
    // (or tap) floats #st-ar-edit over the warped label — its screen
    // rect is already post-warp, so plain absolute positioning lands it
    // right — and commits run through the same appliers as the flat
    // inputs, routed by which tool the stage is showing. The cooldown is
    // shared with the flat map: a commit re-renders both copies.
    var arEditKey = null;

    function arOpenEdit(el, key, value) {
        if (Date.now() < stpEditCooldown) return;
        var $inp = $("#st-ar-edit");
        if (arEditKey === key && $inp.is(":visible")) return;
        if (arEditKey) $inp.blur(); // commit whatever is already open
        var stage = document.getElementById("st-ar-stage");
        var sb = stage.getBoundingClientRect();
        var eb = el.getBoundingClientRect();
        arEditKey = key;
        var left = Math.max(0, Math.min(sb.width - 54, eb.left + eb.width / 2 - sb.left - 27));
        var top = Math.max(0, Math.min(sb.height - 20, eb.top + eb.height / 2 - sb.top - 10));
        $inp.val(value).css({ left: left + "px", top: top + "px" }).show();
        $inp[0].focus();
        $inp[0].select();
    }

    function arCommitEdit() {
        var key = arEditKey;
        var v = parseFloat($("#st-ar-edit").val());
        arEditKey = null;
        stpEditCooldown = Date.now() + 400;
        $("#st-ar-edit").hide();
        if (!key || !isFinite(v)) return;
        if (stAr.tool === "planer") stpApplyEdit(key, v);
        else if (stAr.tool === "tablesaw") stsApplyEdit(key, v);
    }

    $("#st-ar-svg").on("pointerenter click", "[data-edit]", function () {
        var val = parseFloat($(this).attr("data-val"));
        arOpenEdit(this, $(this).attr("data-edit"), isFinite(val) ? val : 0);
    });
    $("#st-ar-edit").on("keydown", function (e) {
        if (e.key === "Enter") $(this).blur();
        if (e.key === "Escape") {
            arEditKey = null;
            stpEditCooldown = Date.now() + 400;
            $(this).hide();
        }
    });
    $("#st-ar-edit").on("blur", arCommitEdit);

    // Planer parameter inputs
    $("#stp-bit, #stp-step, #stp-depth").on("change", function () {
        var bit = parseFloat($("#stp-bit").val());
        var step = parseFloat($("#stp-step").val());
        var depth = parseFloat($("#stp-depth").val());
        if (bit > 0) stPlaner.bit = bit;
        if (step >= 5 && step <= 100) stPlaner.step = step;
        else $("#stp-step").val(stPlaner.step);
        stPlaner.depth = depth > 0 ? depth : 0;
        stpClampArea(); // a smaller bit shrinks the overcut allowance
        stpSave();
        renderStpEnv();
    });

    $("#stp-angle-slider").on("input", function () {
        stPlaner.angle = Number($(this).val()) || 0;
        $("#stp-angle").val(stPlaner.angle);
        renderStpEnv();
    });
    $("#stp-angle-slider").on("change", stpSave);
    // Magnify the pattern while the slider is held so the passes are
    // legible at any angle; glide back to true scale on release.
    $("#stp-angle-slider").on("pointerdown", function () {
        clearTimeout(stpPulseTimer); // a pending pulse-out must not fire mid-hold
        stpZoomTo(1);
    });
    $("#stp-angle-slider").on("pointerup pointercancel blur", function () {
        stpZoomTo(0);
    });
    // Typing/spinning the angle number has no held state to key the zoom
    // off of, so pulse instead: zoom in, hold a beat, glide back out.
    // Rapid changes keep resetting the hold so the view stays magnified.
    var stpPulseTimer = null;
    function stpZoomPulse() {
        stpZoomTo(1);
        clearTimeout(stpPulseTimer);
        stpPulseTimer = setTimeout(function () {
            stpZoomTo(0);
        }, 1050);
    }

    $("#stp-angle").on("change", function () {
        var a = parseFloat($(this).val());
        stPlaner.angle = isFinite(a) ? Math.max(0, Math.min(90, a)) : 0;
        $(this).val(stPlaner.angle);
        $("#stp-angle-slider").val(stPlaner.angle);
        stpSave();
        stpZoomPulse();
        renderStpEnv();
    });

    $('input[name="stp-dir"]').on("change", function () {
        stPlaner.dir = this.value === "1way" ? "1way" : "2way";
        stpSave();
        stpZoomPulse(); // the 1-way/2-way difference reads best magnified
        renderStpEnv();
    });

    $("#btn-st-plane").on("click", function () {
        if (!isIdle()) return;
        if (!(stPlaner.depth > 0)) return fabmo.notify("warning", window.t("tool_status.notify.set_plane_depth"));
        if (!(stPlaner.bit > 0)) return fabmo.notify("warning", window.t("tool_status.notify.set_bit_diameter"));
        if (!(stPlaner.x1 > stPlaner.x0) || !(stPlaner.y1 > stPlaner.y0)) {
            return fabmo.notify("warning", window.t("tool_status.notify.pick_plane_area"));
        }
        var segs = stpToolpath();
        if (!segs.length) return fabmo.notify("warning", window.t("tool_status.notify.no_toolpath"));
        var safeZ = Number((state.vars || {}).SB_SAFE_Z);
        if (!isFinite(safeZ) || safeZ <= 0) safeZ = state.unit === "mm" ? 25 : 1;
        var t = stTableRect();
        // Map-relative area coords → work coords for the job
        var wx = function (v) { return Math.round((v + t.x0 - state.g55.x) * 10000) / 10000; };
        var wy = function (v) { return Math.round((v + t.y0 - state.g55.y) * 10000) / 10000; };
        var lines = [
            "'Shop Tools: planer",
            "SO,1,1", // spindle on
            "PAUSE 2", // spin-up
            "JZ, " + safeZ,
            "J2, " + wx(segs[0].a[0]) + ", " + wy(segs[0].a[1]),
            "MZ, " + -stPlaner.depth,
        ];
        segs.forEach(function (s) {
            if (s.type === "air") {
                lines.push("JZ, " + safeZ);
                lines.push("J2, " + wx(s.b[0]) + ", " + wy(s.b[1]));
                lines.push("MZ, " + -stPlaner.depth);
            } else {
                lines.push("M2, " + wx(s.b[0]) + ", " + wy(s.b[1]));
            }
        });
        lines.push("JZ, " + safeZ);
        lines.push("SO,1,0"); // spindle off
        var cuts = segs.filter(function (s) { return s.type === "cut"; }).length;
        var sp = stpSpans();
        var over = stPlaner.x0 < 0 || stPlaner.y0 < 0 || stPlaner.x1 > sp.xspan || stPlaner.y1 > sp.yspan;
        consoleLog("> plane: " + stpFmtLen(stPlaner.x1 - stPlaner.x0) + "×" + stpFmtLen(stPlaner.y1 - stPlaner.y0) +
            " " + state.unit + ", " + cuts + " passes at " + stPlaner.angle + "°, depth " + stPlaner.depth +
            (over ? ", overcutting the table edge" : ""));
        runCommand(lines.join("\n"));
    });

    // ---- Chop saw: cut-list building, live re-nest, and the CUT job

    function stcsAddPiece() {
        var w = stcsNum($("#stcs-w").val());
        var l = stcsNum($("#stcs-l").val());
        var q = Math.round(parseFloat($("#stcs-qty").val()));
        if (!(w > 0) || !(l > 0)) {
            return fabmo.notify("warning", window.t("tool_status.notify.bad_piece"));
        }
        if (!(q >= 1)) q = 1;
        stChop.items.push({ qty: Math.min(q, 200), w: w, l: l });
        $("#stcs-w").val("");
        $("#stcs-l").val("");
        $("#stcs-qty").val(1);
        renderStcsList();
        stcsSave();
        stcsRecalc();
        $("#stcs-w").trigger("focus");
    }
    $("#stcs-add").on("click", stcsAddPiece);
    $("#stcs-w, #stcs-l, #stcs-qty").on("keydown", function (e) {
        if (e.key === "Enter") stcsAddPiece();
    });

    $("#stcs-list").on("click", ".ts-stcs-del", function () {
        var i = Number($(this).attr("data-idx"));
        if (isFinite(i)) stChop.items.splice(i, 1);
        renderStcsList();
        stcsSave();
        stcsRecalc();
    });

    $("#stcs-sheet-w, #stcs-sheet-l, #stcs-thick, #stcs-bit, #stcs-passes").on("change", function () {
        var n = function (id) { var v = parseFloat($(id).val()); return v > 0 ? v : 0; };
        stChop.sheetW = n("#stcs-sheet-w");
        stChop.sheetL = n("#stcs-sheet-l");
        stChop.thickness = n("#stcs-thick");
        stChop.bit = n("#stcs-bit");
        var ps = Math.round(parseFloat($("#stcs-passes").val()));
        stChop.passes = isFinite(ps) && ps >= 1 ? Math.min(ps, 10) : stChop.passes;
        stcsSyncInputs();
        stcsSave();
        stcsRecalc();
    });

    $("#btn-st-chop").on("click", function () {
        if (!isIdle()) return;
        if (!stChop.items.length) {
            return fabmo.notify("warning", window.t("tool_status.notify.cut_list_empty"));
        }
        if (!(stChop.bit > 0)) {
            return fabmo.notify("warning", window.t("tool_status.notify.set_bit_diameter"));
        }
        if (!(stChop.thickness > 0)) {
            return fabmo.notify("warning", window.t("tool_status.notify.set_sheet_thickness"));
        }
        stcsRecalc();
        var nest = stChop._nest;
        if (!nest.placed.length) {
            return fabmo.notify("warning", window.t("tool_status.notify.nothing_fits"));
        }
        stcsSave();
        var r4 = function (v) { return Math.round(v * 10000) / 10000; };
        var safeZ = Number((state.vars || {}).SB_SAFE_Z);
        if (!isFinite(safeZ) || safeZ <= 0) safeZ = state.unit === "mm" ? 25 : 1;
        // Even pass depths through the sheet plus a small breakthrough
        var total = stChop.thickness + stcsDefaults().breakthrough;
        var depths = [];
        for (var i = 1; i <= stChop.passes; i++) {
            depths.push(r4((-total * i) / stChop.passes));
        }
        var r = stChop.bit / 2;
        var lines = ["'Shop Tools: chop saw", "SO,1,1", "PAUSE 2"];
        nest.placed.forEach(function (p) {
            lines.push.apply(lines, stcsCutLines(p, r, depths, safeZ));
        });
        lines.push("JZ, " + safeZ);
        lines.push("J2, 0, 0");
        lines.push("SO,1,0");
        var sheet = stcsSheet();
        consoleLog("> chop saw: " + nest.placed.length + " pieces from a " +
            stpFmtLen(sheet.w) + "×" + stpFmtLen(sheet.l) + " " + state.unit + " sheet, " +
            stChop.passes + " passes to " + depths[depths.length - 1] +
            (nest.missed.length ? " (" + nest.missed.length + " did not fit)" : ""));
        if (nest.missed.length) {
            fabmo.notify("warning", window.t("tool_status.shoptools.chop_missed", { missed: nest.missed.length }));
        }
        runCommand(lines.join("\n"));
    });

    // ---- Table saw: anchor/endpoint dragging + in-place value editing

    var stsDrag = null;

    $("#sts-env-svg").on("pointerdown", "[data-handle]", function (e) {
        stsDrag = $(this).attr("data-handle");
        e.preventDefault();
    });

    $(document).on("pointermove", function (e) {
        if (!stsDrag) return;
        var svg = document.getElementById("sts-env-svg");
        if (!svg) { stsDrag = null; return; }
        var box = svg.getBoundingClientRect();
        var g = stpGeom("sts-env-svg");
        var ar = stAr._drag ? stArPointToEnv(e.clientX, e.clientY) : null;
        var vx = ar ? ar.vx : ((e.clientX - box.left - g.ML) / g.rw) * g.xspan;
        var vy = ar ? ar.vy : ((g.MT + g.rh - (e.clientY - box.top)) / g.rh) * g.yspan;
        if (stsDrag === "anchor") {
            // Anchor drag translates the line (clamped onto the table)
            stSaw.ax = Math.max(0, Math.min(g.xspan, vx));
            stSaw.ay = Math.max(0, Math.min(g.yspan, vy));
            stsSyncInputs();
        } else {
            // Endpoint drag pivots the line about the anchor
            var dx = vx - stSaw.ax, dy = vy - stSaw.ay;
            if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) stsAngleFrom(dx, dy);
        }
        renderStsEnv();
    });

    $(document).on("pointerup pointercancel", function () {
        if (!stsDrag) return;
        stsDrag = null;
        stsSave();
    });

    // In-place editing: clicking the angle or an intercept label floats
    // #sts-edit over it; Enter/blur commits, Escape cancels. A typed
    // intercept pivots the line about the anchor to pass through that
    // boundary point, same as dragging the handle there.
    var stsEditKey = null;

    function stsOpenEdit(el, key, value) {
        var $inp = $("#sts-edit");
        var wrap = $inp.parent()[0];
        var wb = wrap.getBoundingClientRect();
        var eb = el.getBoundingClientRect();
        stsEditKey = key;
        var left = Math.max(0, Math.min(wb.width - 54, eb.left + eb.width / 2 - wb.left - 27));
        var top = Math.max(0, Math.min(wb.height - 20, eb.top + eb.height / 2 - wb.top - 10));
        $inp.val(value).css({ left: left + "px", top: top + "px" }).show();
        $inp[0].focus();
        $inp[0].select();
    }

    function stsApplyEdit(key, v) {
        if (key === "angle") {
            stSaw.angle = Math.round((((v % 180) + 180) % 180) * 10) / 10;
            if (stsOffAxis(stSaw.angle)) stsAngleMode = true;
        } else {
            stsPivotToEdge(key.slice(2), v);
        }
        stsSave();
        renderStsEnv();
    }

    function stsCommitEdit() {
        var key = stsEditKey;
        var v = parseFloat($("#sts-edit").val());
        stsEditKey = null;
        $("#sts-edit").hide();
        if (!key || !isFinite(v)) return;
        stsApplyEdit(key, v);
    }

    $("#sts-env-svg").on("click", "[data-edit]", function () {
        var val = parseFloat($(this).attr("data-val"));
        stsOpenEdit(this, $(this).attr("data-edit"), isFinite(val) ? val : 0);
    });
    $("#sts-edit").on("keydown", function (e) {
        if (e.key === "Enter") $(this).blur();
        if (e.key === "Escape") { stsEditKey = null; $(this).hide(); }
    });
    $("#sts-edit").on("blur", stsCommitEdit);

    $("#sts-ax, #sts-ay").on("change", function () {
        var s = stpSpans();
        var ax = parseFloat($("#sts-ax").val());
        var ay = parseFloat($("#sts-ay").val());
        if (isFinite(ax)) stSaw.ax = Math.max(0, Math.min(s.xspan, ax));
        if (isFinite(ay)) stSaw.ay = Math.max(0, Math.min(s.yspan, ay));
        stsSyncInputs();
        stsSave();
        renderStsEnv();
    });

    $("#sts-depth").on("change", function () {
        var d = parseFloat($(this).val());
        stSaw.depth = d > 0 ? d : 0;
        stsSave();
    });
    $("#sts-pass").on("change", function () {
        var d = parseFloat($(this).val());
        stSaw.pass = d > 0 ? d : 0;
        stsSave();
    });
    $("#sts-feed").on("change", function () {
        var f = parseFloat($(this).val());
        stSaw.feed = f > 0 ? f : 0;
        stsSave();
    });

    // Cut-type selector + the revealed angle/intercept fields
    $("#sts-mode-rip").on("click", function () {
        stsAngleMode = false;
        stSaw.angle = 90;
        stsSave();
        renderStsEnv();
    });
    $("#sts-mode-cross").on("click", function () {
        stsAngleMode = false;
        stSaw.angle = 0;
        stsSave();
        renderStsEnv();
    });
    $("#sts-arr-btn").on("click", function () {
        stsArrayMode = !stsArrayMode;
        renderStsEnv();
    });
    $("#sts-arr-n, #sts-arr-s").on("change", function () {
        stsArr.n = stCount($("#sts-arr-n").val());
        var sp = parseFloat($("#sts-arr-s").val());
        if (isFinite(sp) && sp !== 0) stsArr.s = sp;
        $("#sts-arr-n").val(stsArr.n);
        $("#sts-arr-s").val(stsArr.s);
        stsSave();
        renderStsEnv();
    });
    $("#sts-angle").on("change", function () {
        var v = parseFloat($(this).val());
        if (!isFinite(v)) return;
        stSaw.angle = Math.round((((v % 180) + 180) % 180) * 10) / 10;
        stsSave();
        renderStsEnv();
    });
    $("#sts-i0, #sts-i1").on("change", function () {
        var v = parseFloat($(this).val());
        var edge = $(this).data("edge");
        if (!isFinite(v) || !edge) return;
        stsPivotToEdge(edge, v);
        stsSave();
        renderStsEnv();
    });

    // CUT: straight passes at depth (Z zeroed on the material surface) —
    // one per array copy, serpentine order so travel between cuts is
    // short. Same coordinate/spindle bookkeeping as PLANE.
    $("#btn-st-saw").on("click", function () {
        if (!isIdle()) return;
        if (!(stSaw.depth > 0)) return fabmo.notify("warning", window.t("tool_status.notify.set_cut_depth"));
        var nrm = stsNormal();
        var count = stsArrayMode ? stsArr.n : 1;
        var cuts = [];
        for (var i = 0; i < count; i++) {
            var c = stsChord(stSaw.ax + i * stsArr.s * nrm[0], stSaw.ay + i * stsArr.s * nrm[1]);
            if (c) cuts.push(c);
        }
        if (!cuts.length) return fabmo.notify("warning", window.t("tool_status.notify.cut_misses_table"));
        var safeZ = Number((state.vars || {}).SB_SAFE_Z);
        if (!isFinite(safeZ) || safeZ <= 0) safeZ = state.unit === "mm" ? 25 : 1;
        var t = stTableRect();
        var wx = function (v) { return Math.round((v + t.x0 - state.g55.x) * 10000) / 10000; };
        var wy = function (v) { return Math.round((v + t.y0 - state.g55.y) * 10000) / 10000; };
        // Pass schedule: step down by pass depth (or all at once), never
        // past total depth.
        var passD = stSaw.pass > 0 ? Math.min(stSaw.pass, stSaw.depth) : stSaw.depth;
        var np = Math.max(1, Math.ceil(stSaw.depth / passD - 1e-9));
        var depths = [];
        for (var k = 1; k <= np; k++) {
            depths.push(Math.round(Math.min(k * passD, stSaw.depth) * 10000) / 10000);
        }
        var lines = [
            "'Shop Tools: table saw",
            "SO,1,1",
            "PAUSE 2",
        ];
        if (stSaw.feed > 0) lines.push("MS, " + stSaw.feed);
        cuts.forEach(function (c, i) {
            var a = c[0], b = c[1];
            if (i % 2 === 1) { a = c[1]; b = c[0]; }
            lines.push("JZ, " + safeZ);
            lines.push("J2, " + wx(a[0]) + ", " + wy(a[1]));
            // Multi-pass without lifting: plunge deeper at whichever end
            // the last pass finished, cut back the other way.
            depths.forEach(function (d, k2) {
                lines.push("MZ, " + -d);
                var tgt = k2 % 2 === 0 ? b : a;
                lines.push("M2, " + wx(tgt[0]) + ", " + wy(tgt[1]));
            });
        });
        lines.push("JZ, " + safeZ);
        lines.push("SO,1,0");
        consoleLog("> saw: " + cuts.length + " cut" + (cuts.length > 1 ? "s" : "") + " at " +
            stpFmtLen(stSaw.angle) + "° through (" + stpFmtLen(stSaw.ax) + ", " + stpFmtLen(stSaw.ay) +
            ")" + (cuts.length > 1 ? ", spacing " + stsArr.s : "") +
            ", depth " + stSaw.depth + (np > 1 ? " in " + np + " passes" : "") +
            (stSaw.feed > 0 ? ", feed " + stSaw.feed : ""));
        runCommand(lines.join("\n"));
    });

    // ---- Array mode: swap the depth/cross-section controls for the grid
    // fields; the envelope map previews the holes.

    function setArrayMode(on) {
        stArrayMode = on;
        $("#btn-st-array").toggleClass("active", on);
        if (on) {
            // Freeze the drill columns' footprint (widths + the gap
            // between them) onto the array panel before swapping, so the
            // map and the header buttons don't move between modes.
            var w = 0;
            $(".ts-st-depthcol:visible, .ts-st-xseccol:visible").each(function () {
                w += $(this).outerWidth() + 6;
            });
            if (w) $("#st-array-panel").css("min-width", w - 6 + "px");
        }
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

    // AR projection: enter from a panel's camera button, exit from the
    // same button (now docked in the rail), the stage's X, or Escape.
    $(".ts-st-arbtn").on("click", function () {
        if (stAr.tool) return stArExit();
        stArEnter($(this).closest(".ts-st-panel").attr("id").replace("st-panel-", ""));
    });
    $("#st-ar-exit").on("click", stArExit);
    $(document).on("keydown", function (e) {
        if (e.key === "Escape" && stAr.tool) stArExit();
    });
    $(window).on("resize", function () {
        if (stAr.tool) stArWarp();
    });
    stArDetect();

    // Drags on the projection reuse the flat-map drag state; the move
    // handlers read the table through stArPointToEnv when it's an AR
    // drag (stAr._drag). Handles keep their data-handle names in the
    // copied svg, so the same identifiers flow through.
    $("#st-ar-svg").on("pointerdown", "[data-handle]", function (e) {
        if (stAr.tool === "planer") stpDrag = stpAmbiguate($(this).attr("data-handle"));
        else if (stAr.tool === "tablesaw") stsDrag = $(this).attr("data-handle");
        else if (stAr.tool === "drill" && $(this).attr("data-handle") === "target") stdDrag = true;
        else return;
        stAr._drag = true;
        e.preventDefault();
    });

    // Drill target dragging — flat map and projection share the state;
    // coordinates come from the map box or the inverse homography.
    var stdDrag = false;
    $("#st-env-svg").on("pointerdown", "[data-handle=target]", function (e) {
        stdDrag = true;
        e.preventDefault();
    });
    $(document).on("pointermove", function (e) {
        if (!stdDrag) return;
        var t = stTableRect();
        var xspan = t.xspan, yspan = t.yspan;
        if (!(xspan > 0) || !(yspan > 0)) return;
        var v = stAr._drag ? stArPointToEnv(e.clientX, e.clientY) : null;
        if (!v) {
            var svg = document.getElementById("st-env-svg");
            var rect = svg && svg.querySelector("rect");
            if (!rect) return;
            var box = svg.getBoundingClientRect();
            var rx = +rect.getAttribute("x"), ry = +rect.getAttribute("y");
            var rw = +rect.getAttribute("width"), rh = +rect.getAttribute("height");
            v = {
                vx: ((e.clientX - box.left - rx) / rw) * xspan,
                vy: ((ry + rh - (e.clientY - box.top)) / rh) * yspan,
            };
        }
        var tx = Math.max(0, Math.min(xspan, v.vx));
        var ty = Math.max(0, Math.min(yspan, v.vy));
        // Dropping the target back on the machine crosshair clears it —
        // back to drill-at-position.
        var mxr = (Number(state.pos.x) || 0) + state.g55.x - t.x0;
        var myr = (Number(state.pos.y) || 0) + state.g55.y - t.y0;
        var snap = Math.max(xspan, yspan) * 0.025;
        stDrill.target = Math.hypot(tx - mxr, ty - myr) < snap ? null : { x: tx, y: ty };
        renderStEnv();
    });
    $(document).on("pointerup pointercancel", function () {
        stdDrag = false;
    });
    $(document).on("pointerup pointercancel", function () {
        stAr._drag = false;
    });

    // The control palette drags by its grip, clamped to the stage.
    var stArFloatDrag = null;
    $("#st-ar-grip").on("pointerdown", function (e) {
        var f = document.getElementById("st-ar-float");
        stArFloatDrag = { dx: e.clientX - f.offsetLeft, dy: e.clientY - f.offsetTop };
        e.preventDefault();
    });
    $(document).on("pointermove", function (e) {
        if (!stArFloatDrag) return;
        var stage = document.getElementById("st-ar-stage");
        var f = document.getElementById("st-ar-float");
        var x = Math.max(0, Math.min(stage.clientWidth - f.offsetWidth, e.clientX - stArFloatDrag.dx));
        var y = Math.max(0, Math.min(stage.clientHeight - f.offsetHeight, e.clientY - stArFloatDrag.dy));
        f.style.left = x + "px";
        f.style.top = y + "px";
        f.style.right = "auto";
        stAr._floatPos = { x: x, y: y };
    });
    $(document).on("pointerup pointercancel", function () {
        stArFloatDrag = null;
    });

    // Re-fit the envelope maps when the card's width changes — e.g. the
    // DRO expanding squeezes this card. stEnvCap contracts the map first
    // and only stacks it below the controls when really tight.
    var stCard = document.querySelector('.ts-card[data-card-id="shoptools"]');
    if (stCard && window.ResizeObserver) {
        new ResizeObserver(function () {
            if ($("#st-panel-drill").is(":visible")) renderStEnv();
            if ($("#st-panel-planer").is(":visible")) renderStpEnv();
            if ($("#st-panel-tablesaw").is(":visible")) renderStsEnv();
            if ($("#st-panel-chopsaw").is(":visible")) renderStcsEnv();
        }).observe(stCard);
    }

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

    $("#st-drill-bit, #st-drill-hole").on("change", function () {
        var bit = parseFloat($("#st-drill-bit").val());
        var hole = parseFloat($("#st-drill-hole").val());
        stDrill.bit = bit > 0 ? bit : 0;
        stDrill.hole = hole > 0 ? hole : 0;
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
            fabmo.notify("warning", window.t("tool_status.notify.set_drill_depth"));
            return;
        }
        // Depth is into the material from its top; where Z=0 sits decides
        // the machine target for that same hole.
        var zzTable = stDrill.zzero === "table";
        if (zzTable && !(stDrill.thickness > 0)) {
            fabmo.notify("warning", window.t("tool_status.notify.set_thickness"));
            return;
        }
        var targetZ = zzTable ? stDrill.thickness - depth : -depth;
        targetZ = Math.round(targetZ * 10000) / 10000;
        // Spiral bore applies when a bit and a LARGER hole are given;
        // equal (or no hole) keeps the classic straight plunge.
        var spiral = false;
        if (stDrill.hole > 0) {
            if (!(stDrill.bit > 0)) {
                fabmo.notify("warning", window.t("tool_status.notify.set_bit_diameter"));
                return;
            }
            if (stDrill.hole < stDrill.bit - 1e-9) {
                fabmo.notify("warning", window.t("tool_status.notify.hole_smaller_than_bit"));
                return;
            }
            spiral = stDrill.hole > stDrill.bit + 1e-9;
        }
        var surfZ = zzTable ? stDrill.thickness : 0;
        stSaveDrill();
        // Retract target: the shared safe-Z; a plain fallback clearance if
        // the machine has none set.
        var safeZ = Number((state.vars || {}).SB_SAFE_Z);
        if (!isFinite(safeZ) || safeZ <= 0) safeZ = state.unit === "mm" ? 25 : 1;
        // Zeroed on the table, the material top is at +thickness — keep
        // the same clearance above the material, not above Z zero.
        if (zzTable) safeZ = Math.round((stDrill.thickness + safeZ) * 10000) / 10000;

        var r4 = function (v) { return Math.round(v * 10000) / 10000; };
        // Pinned target (map-relative machine coords) → work coords
        // for J2, same conversion the planer uses.
        var t = stTableRect();
        var tgt = stDrill.target;
        var twx = tgt ? r4(tgt.x + t.x0 - state.g55.x) : null;
        var twy = tgt ? r4(tgt.y + t.y0 - state.g55.y) : null;
        var lines = ["'Shop Tools: drill press", "SO,1,1", "PAUSE 2"];
        var logMsg;
        if (stArrayMode && stArray.xn * stArray.yn > 1) {
            if ((stArray.xn > 1 && !stArray.xs) || (stArray.yn > 1 && !stArray.ys)) {
                fabmo.notify("warning", window.t("tool_status.notify.set_array_spacing"));
                return;
            }
            // Grid steps +X/+Y from the current position, row by row, with
            // a safe-Z retract before every move between holes.
            var bx = tgt ? twx : Number(state.pos.x) || 0;
            var by = tgt ? twy : Number(state.pos.y) || 0;
            for (var j = 0; j < stArray.yn; j++) {
                for (var i = 0; i < stArray.xn; i++) {
                    if (spiral) {
                        lines.push.apply(lines, stSpiralLines(bx + i * stArray.xs, by + j * stArray.ys, surfZ, targetZ, safeZ));
                    } else {
                        lines.push("JZ, " + safeZ);
                        lines.push("J2, " + r4(bx + i * stArray.xs) + ", " + r4(by + j * stArray.ys));
                        lines.push("MZ, " + targetZ);
                    }
                }
            }
            logMsg = "> drill array: " + stArray.xn + "×" + stArray.yn + " holes, " + depth + " " + state.unit + " into material (Z to " + targetZ + ")" +
                (spiral ? ", spiral bore Ø" + stDrill.hole + " with Ø" + stDrill.bit + " bit" : "");
        } else {
            if (spiral) {
                // The helix needs the hole's center XY even when drilling
                // in place — the circle starts a center-offset to its west.
                var scx = tgt ? twx : r4(Number(state.pos.x) || 0);
                var scy = tgt ? twy : r4(Number(state.pos.y) || 0);
                lines.push.apply(lines, stSpiralLines(scx, scy, surfZ, targetZ, safeZ));
                lines.push("J2, " + scx + ", " + scy); // back over the hole
            } else {
                if (tgt) {
                    lines.push("JZ, " + safeZ);
                    lines.push("J2, " + twx + ", " + twy);
                }
                lines.push("MZ, " + targetZ);
            }
            logMsg = "> drill: " + depth + " " + state.unit + " into material (Z to " + targetZ + ")" +
                (tgt ? " at " + twx + ", " + twy : "") +
                (spiral ? ", spiral bore Ø" + stDrill.hole + " with Ø" + stDrill.bit + " bit" : "");
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
        $("#tool-settings-units").text(window.t("tool_status.common.units_note", { units: state.unit }));
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
            else fabmo.notify("info", window.t("tool_status.notify.job_added"));
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
            if (!jobs.length) $list.append($('<div class="ts-empty">').text(window.t("tool_status.history.empty")));
            jobs.forEach(function (job) {
                $list.append(historyRow(job));
            });
            $("#history-page-label").text(
                total
                    ? window.t("tool_status.history.range", {
                          from: start + 1,
                          to: Math.min(start + jobs.length, total),
                          total: total,
                      })
                    : window.t("tool_status.history.none")
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
            // Commands are capitalized like SB4's command console (the
            // input shows caps live via text-transform; this makes it real).
            var cmd = $in.val().trim().toUpperCase();
            if (!cmd) return;
            // First use retires the helper placeholder until reload.
            $in.removeAttr("placeholder").removeAttr("data-i18n-placeholder");
            if (cmd !== cmdHistory[cmdHistory.length - 1]) cmdHistory.push(cmd);
            cmdHistoryIdx = -1;
            $in.val("");
            // A bare two-letter command with parameters opens its fill-in
            // sheet instead of running immediately (SB3/SB4 behavior).
            var entry = fillinEntryFor(cmd);
            if (entry) {
                openFillin(cmd, entry);
            } else {
                consoleRun(cmd);
            }
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

    // ---- Console fill-in sheet events ----

    $("#fillin-params").on("input", "input", fillinPreview);
    $("#fillin-params").on("keydown", "input", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#btn-fillin-run").click();
        } else if (e.key === "Escape") {
            closeFillin();
        }
    });
    $("#btn-fillin-run").on("click", function () {
        if (!fillinCmd) return;
        var cmd = fillinAssemble();
        closeFillin();
        consoleRun(cmd);
    });
    $("#btn-fillin-cancel").on("click", closeFillin);
    $("#fillin-modal").on("click", function (e) {
        if (e.target === this) closeFillin();
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
