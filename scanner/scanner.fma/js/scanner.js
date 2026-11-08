/* 3D Scanner app — thin client over scand (scanner daemon, port 3150). */
/* global FabMoDashboard, ScanViewer */

// Inside the dashboard the app is served by the engine; while developing it
// can also be opened straight from scand at http://<host>:3150/app/.
var STANDALONE = location.port === "3150";
var fabmo;
try {
    fabmo = STANDALONE ? null : new FabMoDashboard();
} catch (e) {
    fabmo = null;
}
if (!fabmo) {
    // standalone page: show messages in the status line (no alert())
    fabmo = { notify: function (level, msg) {
        console.log(level + ": " + msg);
        var el = document.getElementById("op-status");
        if (el && (level === "error" || level === "warning")) {
            el.textContent = msg;
            el.className = "statusline err";
        }
    } };
}
var BASE = STANDALONE ? location.origin : "http://" + location.hostname + ":3150";
document.getElementById("daemon-url").textContent = BASE;

var $ = function (id) { return document.getElementById(id); };

function api(method, path, body) {
    return fetch(BASE + path, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
        return r.json().then(function (j) {
            if (!r.ok) { throw new Error(j.error || ("HTTP " + r.status)); }
            return j;
        });
    });
}

// ---------------------------------------------------------------- settings

var NUM_KEYS = ["part_zmax_in", "scan_step_mm", "survey_z_in", "safe_z_in",
    "clearance_in", "cam_z_at_zero_in", "laser_output", "diff_threshold",
    "lane_width_mm"];
var LIST_KEYS = ["survey_region_in", "headings_deg"];
var BOOL_KEYS = ["use_laser", "use_pan", "pan_prompt"];
var settings = {};

function settingsToUI() {
    NUM_KEYS.forEach(function (k) { $("s-" + k).value = settings[k]; });
    LIST_KEYS.forEach(function (k) { $("s-" + k).value = settings[k].join(", "); });
    BOOL_KEYS.forEach(function (k) { $("s-" + k).checked = !!settings[k]; });
}

function settingsFromUI() {
    var out = {};
    NUM_KEYS.forEach(function (k) {
        var v = parseFloat($("s-" + k).value);
        if (!isNaN(v)) { out[k] = v; }
    });
    LIST_KEYS.forEach(function (k) {
        var parts = $("s-" + k).value.split(",").map(parseFloat);
        if (parts.length && parts.every(function (v) { return !isNaN(v); })) {
            out[k] = parts;
        }
    });
    BOOL_KEYS.forEach(function (k) { out[k] = $("s-" + k).checked; });
    return out;
}

function saveSettings() {
    api("POST", "/settings", settingsFromUI()).then(function (s) {
        settings = s;
        settingsToUI();
        fabmo.notify("info", "Scanner settings saved");
    }).catch(function (e) { fabmo.notify("error", e.message); });
}

$("btn-savesettings").onclick = saveSettings;
BOOL_KEYS.forEach(function (k) {
    $("s-" + k).onchange = function () {
        var body = {}; body[k] = $("s-" + k).checked;
        api("POST", "/settings", body).then(function (s) { settings = s; });
    };
});

// ---------------------------------------------------------------- table map

var mapShown = null;   // which artifact the <img> currently shows

function showMap(path) {
    var img = $("mapimg");
    mapShown = path;
    if (!path) {
        img.style.display = "none";
        $("map-empty").style.display = "block";
        return;
    }
    img.onload = function () {
        $("map-empty").style.display = "none";
        img.style.display = "block";
        drawOverlay();
    };
    img.onerror = function () { mapShown = null; };
    img.src = BASE + "/artifact/" + path + "?t=" + Date.now();
}

function refreshMap(haveRef, lastLocate) {
    var want = lastLocate ? "locate/overlay.png" : (haveRef ? "reference/mosaic.png" : null);
    if (want !== mapShown) { showMap(want); }
}

// machine inches -> displayed-canvas px, using the survey region
function toPx(x, y, cw, ch) {
    var r = settings.survey_region_in || [0, 0, 24, 18];
    return [
        (x - r[0]) / (r[2] - r[0]) * cw,
        (r[3] - y) / (r[3] - r[1]) * ch,
    ];
}

var lastPlan = null;

function drawOverlay() {
    var img = $("mapimg"), cv = $("mapcanvas");
    if (img.style.display === "none") { cv.width = 0; return; }
    cv.width = img.clientWidth; cv.height = img.clientHeight;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    var bb = bboxFromUI();
    if (bb) {
        var a = toPx(bb[0], bb[3], cv.width, cv.height);
        var b = toPx(bb[2], bb[1], cv.width, cv.height);
        ctx.strokeStyle = "rgba(255,120,40,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    if (lastPlan && lastPlan.passes) {
        ctx.strokeStyle = "rgba(60,110,165,0.8)";
        ctx.lineWidth = 1;
        lastPlan.passes.forEach(function (p) {
            var pts = p.points;
            var s = toPx(pts[0].x, pts[0].y, cv.width, cv.height);
            var e = toPx(pts[pts.length - 1].x, pts[pts.length - 1].y, cv.width, cv.height);
            ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
            ctx.fillStyle = "rgba(60,110,165,0.9)";
            ctx.beginPath(); ctx.arc(s[0], s[1], 2.5, 0, 7); ctx.fill();
        });
    }
}
window.addEventListener("resize", drawOverlay);

// ---------------------------------------------------------------- bbox

function bboxFromUI() {
    var v = ["bb-x0", "bb-y0", "bb-x1", "bb-y1"].map(function (id) {
        return parseFloat($(id).value);
    });
    if (v.some(isNaN) || v[0] >= v[2] || v[1] >= v[3]) { return null; }
    return v;
}

function bboxToUI(bb) {
    ["bb-x0", "bb-y0", "bb-x1", "bb-y1"].forEach(function (id, i) {
        $(id).value = bb[i].toFixed(2);
    });
    drawOverlay();
}

["bb-x0", "bb-y0", "bb-x1", "bb-y1"].forEach(function (id) {
    $(id).onchange = drawOverlay;
});

// ---------------------------------------------------------------- actions

function startOp(path, body, label) {
    api("POST", path, body || {}).then(function () {
        $("op-status").textContent = label + " started…";
        $("op-status").className = "statusline";
    }).catch(function (e) { fabmo.notify("error", e.message); });
}

$("btn-reference").onclick = function () {
    startOp("/reference", {}, "Reference capture");
};
$("btn-locate").onclick = function () { startOp("/locate", {}, "Part search"); };
$("btn-scan").onclick = function () {
    var bb = bboxFromUI();
    if (!bb) { return fabmo.notify("warning", "Set a valid bounding box first (Find Part or type one in)."); }
    api("POST", "/settings", settingsFromUI()).then(function (s) {
        settings = s;
        startOp("/scan", { bbox_in: bb }, "Scan");
    });
};
$("btn-dryrun").onclick = function () {
    var bb = bboxFromUI();
    if (!bb) { return fabmo.notify("warning", "Set a valid bounding box first."); }
    api("POST", "/settings", settingsFromUI()).then(function (s) {
        settings = s;
        return api("POST", "/scan", { bbox_in: bb, dry_run: true });
    }).then(function (p) {
        lastPlan = p;
        $("plansummary").textContent =
            "Plan: " + p.n_passes + " passes, " + p.n_frames + " frames, " +
            "pass Z " + p.z_pass_in + "\" (safe Z " + p.safe_z_in + "\"), headings " +
            p.passes.map(function (x) { return x.heading_deg; })
                .filter(function (v, i, a) { return a.indexOf(v) === i; }).join("/") + "°";
        drawOverlay();
    }).catch(function (e) { fabmo.notify("error", e.message); });
};
$("btn-abort").onclick = function () { api("POST", "/abort"); };
$("btn-confirm").onclick = function () { api("POST", "/confirm"); };

// ---------------------------------------------------------------- sweep

var SEC_PER_STOP = 1.7;   // single-job sweep, 0.8 s + 0.6 s dwells (measured 1.8 s at 0.9 + 0.7)

function sweepParams() {
    var p = {
        axis: $("sw-axis").value,
        start: parseFloat($("sw-start").value),
        end: parseFloat($("sw-end").value),
        step: parseFloat($("sw-step").value),
        rows: parseInt($("sw-rows").value, 10) || 1,
        row_spacing: parseFloat($("sw-rowsp").value) || 0,
        row_start: parseFloat($("sw-row0").value) || 0,
    };
    var name = $("sw-name").value.trim();
    if (name) { p.session = name; }
    return p;
}

function sweepEstimate() {
    var p = sweepParams();
    if ([p.start, p.end, p.step].some(isNaN) || p.step <= 0 || p.end <= p.start) {
        $("sw-estimate").textContent = "Set From < To and a positive step (inches).";
        return null;
    }
    if (p.rows < 1 || p.rows > 20 || (p.rows > 1 && p.row_spacing <= 0)) {
        $("sw-estimate").textContent = "Rows 1–20, with a positive row spacing for more than one.";
        return null;
    }
    var n = (Math.round((p.end - p.start) / p.step) + 1) * p.rows;
    var t = n * SEC_PER_STOP + (p.rows - 1) * 4;
    var A = p.axis.toUpperCase(), O = p.axis === "y" ? "X" : "Y";
    var sg = function (v) { return (v >= 0 ? "+" : "") + v; };
    var txt = "Moves " + A + " from " + sg(p.start) + " to " + sg(p.end) + " in";
    if (p.rows > 1) {
        var last = p.row_start + (p.rows - 1) * p.row_spacing;
        txt += ", " + p.rows + " rows at " + O + " " + sg(p.row_start) + " … " + sg(+last.toFixed(3)) +
            " in";
    } else if (p.row_start) {
        txt += " at " + O + " " + sg(p.row_start) + " in";
    }
    $("sw-estimate").textContent = txt + ", relative to the current position: " + n +
        " stops, ~" + (t < 90 ? Math.round(t) + " s" : (t / 60).toFixed(1) + " min") +
        ". Head returns to its start; laser is switched off at the end.";
    return p;
}
["sw-axis", "sw-start", "sw-end", "sw-step", "sw-rows", "sw-rowsp", "sw-row0"].forEach(function (id) {
    $(id).oninput = sweepEstimate;
});
sweepEstimate();

// Inline confirmation: window.confirm() is silently ignored (returns false)
// inside the dashboard's sandboxed app iframe.
var pendingSweep = null;

function hideSweepConfirm() {
    pendingSweep = null;
    $("sw-confirm").style.display = "none";
}

$("btn-sweep").onclick = function () {
    var p = sweepEstimate();
    if (!p) { return; }
    var n = Math.round((p.end - p.start) / p.step) + 1;
    pendingSweep = p;
    $("sw-confirm-msg").textContent = "Start this " + (p.rows > 1 ? p.rows + "-row " : "") +
        "sweep? " + $("sw-estimate").textContent.split(", relative")[0] +
        ", relative to where the head is now. " +
        "Make sure the head clears the part over the whole area and keep hands clear.";
    $("sw-confirm").style.display = "block";
};
$("sw-confirm-go").onclick = function () {
    var p = pendingSweep;
    hideSweepConfirm();
    if (p) { startOp("/sweep", p, "Sweep"); }
};
$("sw-confirm-cancel").onclick = hideSweepConfirm;
["sw-axis", "sw-start", "sw-end", "sw-step", "sw-name", "sw-rows", "sw-rowsp", "sw-row0"].forEach(function (id) {
    $(id).addEventListener("input", hideSweepConfirm);   // parameters changed: re-confirm
});

// ---------------------------------------------------------------- sessions

var sessions = [];
var selected = null;

function fmt(v, d) { return (v === undefined || v === null) ? "–" : v.toFixed(d); }

function sessionMeta(s) {
    var bits = [];
    if (s.created) { bits.push(s.created.replace(/:\d\d$/, "")); }
    var st = s.stats;
    if (st) {
        bits.push(Math.round(st.n_points / 1000) + "k pts");
        if (st.top) { bits.push("top " + fmt(st.top.height_mm, 2) + " mm"); }
    } else if (s.kind === "sweep") {
        bits.push(s.complete === false ? "incomplete" : "not processed");
    } else {
        bits.push((s.kind || "scan") + ", " + (s.frames || 0) + " frames");
    }
    return bits.join(" · ");
}

function renderSessions() {
    var box = $("sessions");
    box.innerHTML = "";
    if (!sessions.length) {
        box.innerHTML = '<div class="hint">No scans yet.</div>';
        return;
    }
    sessions.forEach(function (s) {
        var row = document.createElement("div");
        row.className = "srow" + (selected === s.session ? " sel" : "");
        var art = BASE + "/artifact/scans/" + encodeURIComponent(s.session) + "/";
        row.innerHTML = '<div class="nm"></div><div class="meta"></div>' +
            '<div class="acts">' +
            (s.stats ? '<a href="' + BASE + "/export/stl?session=" + encodeURIComponent(s.session) +
                '" download title="Closed solid of the part (mm), base 2 mm below the table">STL</a>' +
                '<a href="' + BASE + "/export/stl?crop=all&session=" + encodeURIComponent(s.session) +
                '" download title="Closed solid of the whole scanned area">STL (all)</a>' +
                '<a href="' + art + 'cloud.ply" download title="Raw point cloud (mm)">PLY</a>' : "") +
            (s.kind === "sweep" || s.stats ?
                '<button class="small" data-act="process">Re-process</button>' : "") +
            "</div>";
        row.querySelector(".nm").textContent = s.session;
        row.querySelector(".meta").textContent = sessionMeta(s);
        row.onclick = function (e) {
            if (e.target.tagName === "A") { return; }
            if (e.target.dataset && e.target.dataset.act === "process") {
                e.stopPropagation();
                startOp("/process", { session: s.session }, "Re-processing " + s.session);
                return;
            }
            selectSession(s);
        };
        box.appendChild(row);
    });
}

function refreshSessions(thenSelect) {
    return api("GET", "/sessions").then(function (list) {
        sessions = list;
        renderSessions();
        if (thenSelect) {
            var s = list.filter(function (x) { return x.session === thenSelect; })[0];
            if (s) { selectSession(s); }
        } else if (!selected) {
            var first = list.filter(function (x) {
                return QS.session ? x.session === QS.session : x.stats;
            })[0];
            if (first) { selectSession(first); }
        }
    }).catch(function () {
        $("sessions").innerHTML = '<div class="hint">Daemon unreachable.</div>';
    });
}

// ---------------------------------------------------------------- viewer

var viewer = null;
// optional deep link: ?session=<name>&mode=points|surface&view=iso|top|front|side
var QS = {};
location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
    var p = kv.split("=");
    if (p[0]) { QS[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); }
});

function getBin(url) {
    return fetch(url).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status + " for " + url); }
        return r.arrayBuffer();
    }).then(function (b) { return new Float32Array(b); });
}

function selectSession(s) {
    selected = s.session;
    renderSessions();
    if (!s.stats) {
        $("v-empty").textContent = s.kind === "sweep" ?
            "This scan hasn't been processed — use Re-process." :
            "No 3D data for this session (orbit scans aren't triangulated yet).";
        $("v-empty").style.display = "flex";
        return;
    }
    $("v-empty").textContent = "Loading " + s.session + "…";
    $("v-empty").style.display = "flex";
    var art = BASE + "/artifact/scans/" + encodeURIComponent(s.session) + "/";
    var bust = "?t=" + encodeURIComponent(s.stats.processed || "");
    Promise.all([
        getBin(art + "points.bin" + bust),
        s.stats.surface ? getBin(art + "surface.bin" + bust) : Promise.resolve(null),
    ]).then(function (res) {
        if (selected !== s.session) { return; }
        if (!viewer) {
            viewer = new ScanViewer($("viewer"), { onPick: showPicks });
        }
        if (QS.mode && !viewer.data) {
            var mb = $("v-mode").querySelector('[data-mode="' + QS.mode + '"]');
            if (mb) { mb.onclick(); }
        }
        viewer.load({ points: res[0], surface: res[1], meta: s.stats });
        if (QS.view) { viewer.view(QS.view); QS.view = null; }
        $("v-empty").style.display = "none";
        $("v-title").textContent = s.session;
        showInfo(s);
        showLegend();
    }).catch(function (e) {
        $("v-empty").textContent = "Couldn't load scan: " + e.message;
    });
}

function showInfo(s) {
    var st = s.stats, t = st.top, lines = [];
    lines.push("<b>" + st.n_points.toLocaleString() + "</b> points from " + st.n_shots +
        " shots · table rms " + fmt(st.table.rms_mm, 2) + " mm");
    if (t) {
        var ex = t.extent_mm, dx = ex.x[1] - ex.x[0], dy = ex.y[1] - ex.y[0];
        lines.push("Top <b>" + fmt(t.height_mm, 2) + " mm</b> (" + fmt(t.height_mm / 25.4, 3) +
            " in) · flat to " + fmt(t.rms_mm, 2) + " mm rms");
        lines.push("Top extent " + fmt(dx, 1) + " × " + fmt(dy, 1) + " mm (" +
            fmt(dx / 25.4, 2) + " × " + fmt(dy / 25.4, 2) + " in, along X × Y)");
    }
    $("v-info").innerHTML = lines.join("<br>");
    $("v-info").style.display = "block";
}

function showLegend() {
    var l = viewer.legend();
    $("v-legend-bar").style.background = l.gradient;
    $("v-legend-min").textContent = l.min.toFixed(1) + " mm";
    $("v-legend-max").textContent = l.max.toFixed(1) + " mm";
    $("v-legend").style.display = "block";
}

function showPicks(picks) {
    var el = $("v-pick");
    if (!picks.length) { el.style.display = "none"; return; }
    var f = function (p) {
        return "X " + p.x.toFixed(1) + "  Y " + p.y.toFixed(1) + "  <b>Z " + p.z.toFixed(2) + "</b>";
    };
    var html = "A: " + f(picks[0]);
    if (picks.length === 2) {
        var a = picks[0], b = picks[1];
        var d = a.distanceTo(b), dz = b.z - a.z;
        var dxy = Math.hypot(b.x - a.x, b.y - a.y);
        html += "<br>B: " + f(b) + "<br>distance <b>" + d.toFixed(2) + " mm</b> (" +
            (d / 25.4).toFixed(3) + " in)<br>ΔXY " + dxy.toFixed(2) + " mm · ΔZ " +
            dz.toFixed(2) + " mm";
    }
    html += '<br><button class="small" id="v-pick-clear">clear</button>';
    el.innerHTML = html;
    el.style.display = "block";
    el.style.pointerEvents = "auto";
    $("v-pick-clear").onclick = function () { viewer.clearPicks(); };
}

// ---------------------------------------------------------------- live sweep

var live = { session: null, from: 0, busy: false };

function pollLive(st) {
    var L = st.live;
    if (!(st.state === "busy" && st.op === "sweep" && L && L.session)) { return; }
    if (live.busy) { return; }                     // previous fetch still running
    if (L.session !== live.session) {              // a new sweep started
        live = { session: L.session, from: 0, busy: false };
        if (!viewer) { viewer = new ScanViewer($("viewer"), { onPick: showPicks }); }
        viewer.startLive(Math.max(50000, L.total * 4000));
        selected = null;
        renderSessions();
        $("v-empty").style.display = "none";
        $("v-title").textContent = L.session + " (scanning…)";
        $("v-legend").style.display = "none";
    }
    if (L.shots_done <= live.from) { return; }
    live.busy = true;
    fetch(BASE + "/live/points?from=" + live.from).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        var done = parseInt(r.headers.get("X-Shots-Done"), 10);
        return r.arrayBuffer().then(function (b) { return [new Float32Array(b), done]; });
    }).then(function (res) {
        if (live.session !== L.session || !viewer || !viewer.live) { return; }
        viewer.appendLive(res[0]);
        if (!isNaN(res[1])) { live.from = res[1]; }
        $("v-info").innerHTML = "<b>Scanning</b> · " + live.from + " / " + L.total +
            " lines · " + viewer.live.n.toLocaleString() + " points<br>" +
            "heights provisional until the scan finishes";
        $("v-info").style.display = "block";
        showLegend();
    }).catch(function () { /* next poll retries */ }).then(function () {
        live.busy = false;
    });
}

Array.prototype.forEach.call($("v-mode").querySelectorAll("button"), function (b) {
    b.onclick = function () {
        Array.prototype.forEach.call($("v-mode").querySelectorAll("button"), function (x) {
            x.className = x === b ? "on" : "";
        });
        $("v-psize-wrap").style.display = b.dataset.mode === "points" ? "" : "none";
        if (viewer) { viewer.setMode(b.dataset.mode); }
    };
});
Array.prototype.forEach.call($("v-views").querySelectorAll("button"), function (b) {
    b.onclick = function () { if (viewer) { viewer.view(b.dataset.view); } };
});
$("v-psize").oninput = function () {
    if (viewer) { viewer.setPointSize(parseFloat($("v-psize").value)); }
};

// ---------------------------------------------------------------- polling

function setPill(id, text, cls) {
    var el = $(id);
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
}

var prevBusy = false;
var prevOp = null;

function poll() {
    api("GET", "/status").then(function (st) {
        var busy = st.state === "busy";
        setPill("pill-daemon", "daemon: " + (busy ? st.op : "idle"), busy ? "busy" : "ok");
        var m = st.machine || {};
        setPill("pill-machine", "machine: " + m.state,
            m.state === "idle" ? "ok" : m.state === "unreachable" ? "err" : "busy");
        setPill("pill-cal",
            st.have_mount_cal ? "cal: hand-eye" : "cal: nominal mount",
            st.have_mount_cal ? "ok" : "busy");

        ["btn-reference", "btn-locate", "btn-scan", "btn-dryrun", "btn-sweep", "sw-confirm-go"].forEach(function (id) {
            $(id).disabled = busy;
        });
        $("btn-abort").style.display = busy ? "" : "none";

        var pr = st.progress || { done: 0, total: 0 };
        $("progress").style.display = busy && pr.total ? "block" : "none";
        if (pr.total) {
            $("progressbar").style.width = (100 * pr.done / pr.total).toFixed(1) + "%";
        }
        if (busy) {
            $("op-status").textContent = st.phase +
                (pr.total ? "  (" + pr.done + "/" + pr.total + ")" : "");
            $("op-status").className = "statusline";
        } else if (st.error) {
            $("op-status").textContent = "Error: " + st.error;
            $("op-status").className = "statusline err";
        } else if (st.message) {
            $("op-status").textContent = st.message;
            $("op-status").className = "statusline";
        }

        var cb = $("confirmbar");
        cb.style.display = st.waiting_confirm ? "flex" : "none";
        if (st.waiting_confirm) { $("confirm-msg").textContent = st.waiting_confirm; }

        if (st.last_locate && st.last_locate.found) {
            $("locate-info").textContent = "Part: " +
                st.last_locate.bbox_in.map(function (v) { return v.toFixed(2); }).join(", ") +
                " (in), " + st.last_locate.n_blobs + " blob(s)";
            if (!bboxFromUI()) { bboxToUI(st.last_locate.bbox_in); }
        }

        if (prevBusy && !busy) {   // an operation just finished
            mapShown = null;       // force image reload (cache-bust)
            var done = st.last_sweep && st.last_sweep.session;
            if (done && (prevOp === "sweep" || prevOp === "process")) {
                selected = null;   // reload even if it was already shown
                refreshSessions(done);
            } else {
                refreshSessions();
            }
            if (st.last_locate && st.last_locate.found) { bboxToUI(st.last_locate.bbox_in); }
        }
        prevBusy = busy;
        prevOp = busy ? st.op : prevOp;
        pollLive(st);
        refreshMap(st.have_reference, st.last_locate);
    }).catch(function () {
        setPill("pill-daemon", "daemon: unreachable", "err");
        ["btn-reference", "btn-locate", "btn-scan", "btn-dryrun", "btn-sweep", "sw-confirm-go"].forEach(function (id) {
            $(id).disabled = true;
        });
    });
}

api("GET", "/settings").then(function (s) {
    settings = s;
    settingsToUI();
});
refreshSessions();
poll();
setInterval(poll, 1000);
