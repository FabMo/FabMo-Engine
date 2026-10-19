/* 3D Scanner app — thin client over scand (scanner daemon, port 3150). */
/* global FabMoDashboard */

var fabmo = new FabMoDashboard();
var BASE = "http://" + location.hostname + ":3150";
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

// ---------------------------------------------------------------- sessions

function refreshSessions() {
    api("GET", "/sessions").then(function (list) {
        var tb = $("sessions");
        tb.innerHTML = "";
        list.slice(0, 8).forEach(function (s) {
            var tr = document.createElement("tr");
            var state = s.complete === true ? "complete" :
                s.complete === false ? "partial" : "?";
            tr.innerHTML = "<td>" + s.session + "</td><td>" +
                (s.frames || 0) + " frames</td><td>" + state + "</td>";
            tb.appendChild(tr);
        });
    });
}

// ---------------------------------------------------------------- polling

function setPill(id, text, cls) {
    var el = $(id);
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
}

var prevBusy = false;

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

        ["btn-reference", "btn-locate", "btn-scan", "btn-dryrun"].forEach(function (id) {
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
            refreshSessions();
            if (st.last_locate && st.last_locate.found) { bboxToUI(st.last_locate.bbox_in); }
        }
        prevBusy = busy;
        refreshMap(st.have_reference, st.last_locate);
    }).catch(function () {
        setPill("pill-daemon", "daemon: unreachable", "err");
        ["btn-reference", "btn-locate", "btn-scan", "btn-dryrun"].forEach(function (id) {
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
