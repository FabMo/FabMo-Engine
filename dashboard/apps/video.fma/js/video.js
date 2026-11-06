require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo();
var camera1_on = false;
var camera2_on = false; 

window.onload = function() {
    var img1 = document.getElementById('camera1');
    var img2 = document.getElementById('camera2');

    // Set up EXIT-BACK behavior for app navigation
    setupAppNavigation();

    // Set up camera configuration and display
    setupCameras(img1, img2);

    // Lock container size to prevent modal interference
    setTimeout(lockContainerSize, 100);
};

function setupAppNavigation() {
    let this_App = "video";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    
    if (this_App != current_App) {
        back_App = current_App;
        if (back_App === null || back_App === "") { 
            back_App = default_App;
        }
        back_App = default_App;
        current_App = this_App;
        localStorage.setItem("currentapp", current_App);
        localStorage.setItem("backapp", back_App);
    } 

    // Escape key: cancel calibration if one is open, else return to the
    // previous app
    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            if (scanState) {
                // Motion may be in progress — Escape must not silently
                // leave the app; the Stop button is the way out.
                return;
            }
            if (calState.calibrating) {
                exitCalibration();
            } else if (calState.zoneMode) {
                exitZoneMode();
            } else if (document.getElementById("scan-bar").style.display !== "none") {
                closeScanBar();
            } else {
                fabmo.launchApp(back_App);
            }
        }
    };
}

async function setupCameras(img1, img2) {
    console.log("Detecting available cameras...");
    
    // Use shared video system
    const cameraStatus = await window.FabMoVideo.getCameraStatus();
    
    // Set global flags
    camera1_on = cameraStatus.camera1;
    camera2_on = cameraStatus.camera2;
    
    console.log(`Detection complete: Camera1=${cameraStatus.camera1}, Camera2=${cameraStatus.camera2}, Total=${cameraStatus.count}`);
    
    if (cameraStatus.count === 0) {
        // No camera: the flat table view still gives the full grid /
        // zones / crosshair experience, drawn on a plain top-down map.
        displayNoCamera();
        calState.viewMode = "table";
        setupCalibration();
        return;
    }
    
    // Set up BOTH camera sources if they're available
    if (cameraStatus.camera1) {
        img1.src = `http://${location.hostname}:3141?${Math.random()}`;
        console.log("Camera 1 source configured");
    }
    
    if (cameraStatus.camera2) {
        img2.src = `http://${location.hostname}:3142?${Math.random()}`;
        console.log("Camera 2 source configured");
    }
    
    // Choose which camera to DISPLAY first (prefer camera1, fallback to camera2)
    if (cameraStatus.camera1) {
        img1.style.display = 'block';
        img2.style.display = 'none';
        document.getElementById("cam-label").innerHTML = "camera 1";
        calState.displayedCam = 1;
        console.log("Displaying camera 1");
    } else if (cameraStatus.camera2) {
        img1.style.display = 'none';
        img2.style.display = 'block';
        document.getElementById("cam-label").innerHTML = "camera 2";
        calState.displayedCam = 2;
        console.log("Displaying camera 2");
    }

    setupCameraToggle(img1, img2, cameraStatus.count);
    setupCalibration();
}

function displayNoCamera() {
    console.log("No camera feeds available");
    document.getElementById("cam-label").innerHTML = "no camera &mdash; table view";
}

function setupCameraToggle(img1, img2, videoCount) {
    // Only setup toggle if there are multiple cameras
    if (videoCount < 2) return;

    img1.onclick = function() {
        if (camera2_on && !calState.calibrating) {
            img1.style.display = 'none';
            img2.style.display = 'block';
            document.getElementById("cam-label").innerHTML = "camera 2";
            calState.displayedCam = 2;
            refreshLiveOverlay();
        }
    };

    img2.onclick = function() {
        if (camera1_on && !calState.calibrating) {
            img1.style.display = 'block';
            img2.style.display = 'none';
            document.getElementById("cam-label").innerHTML = "camera 1";
            calState.displayedCam = 1;
            refreshLiveOverlay();
        }
    };
}

function lockContainerSize() {
    const viewport = document.getElementById('video-viewport');
    
    if (!viewport) {
        console.warn('Video viewport not found');
        return;
    }
    
    // Get current viewport size
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Lock viewport to exact pixel dimensions to prevent modal interference
    viewport.style.position = 'fixed';
    viewport.style.top = '0px';
    viewport.style.left = '0px';
    viewport.style.width = vw + 'px';
    viewport.style.height = vh + 'px';
    viewport.style.zIndex = '1';
}

// Monitor for DOM changes that might affect layout and re-lock if needed
const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' || mutation.type === 'childList') {
            lockContainerSize();
        }
    });
});

// Start observing once DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const viewport = document.getElementById('video-viewport');
    if (viewport) {
        observer.observe(viewport, {
            attributes: true,
            childList: true,
            subtree: true,
            attributeFilter: ['style', 'class']
        });
    }
});
// ---------------------------------------------------------------------------
// AR calibration + live overlay
//
// The same four-corner calibration the previewer and the FabMo Dashboard's
// Shop Tools AR consume, available without loading a job: a machine-envelope
// grid is warped onto the video by a 4-point homography, and the user drags
// the corner handles (with a magnifying loupe, since a finger or cursor sits
// exactly on the corner it is trying to hit) until the grid lies on the
// table. Corners are stored as fractions of the video frame in
// machine.cameraCalibration — TL = the table rectangle's top-left corner
// (machine (0, ysize), or (xmin, ymax) when sizes are unset), the shared
// convention. When a calibration exists for the displayed camera, a subtle
// live grid and a real-time position crosshair can be overlaid on the feed.

var calState = {
    env: null,            // machine.envelope
    g55: { x: 0, y: 0 },  // work offset, to place the position crosshair
    cal: null,            // machine.cameraCalibration
    draft: null,          // working corners during calibration
    calibrating: false,
    displayedCam: 1,
    dragKey: null,
    loupeRAF: null,
    gridOn: true,
    pos: { x: 0, y: 0 },
    Hinv: null,           // live-grid homography inverse: screen px → svg px
    zones: [],            // machine.keepout.zones (machine coordinates)
    zoneMode: false,
    zoneTool: "rect",     // "rect" | "draw" | "erase"
    zoneStroke: null,     // in-progress freehand points / rect corners
    viewMode: "camera",   // "camera" | "table" (flat top-down, no camera needed)
    units: "in",          // machine.units — only used to head the scan job
    mstate: "idle",       // last machine state seen on the status channel
    plate: null,          // stored table photo record (see PLATE below)
};

var GRID_K = 10; // SVG px per machine unit — arbitrary, the warp rescales

// 4-point homography (same closed form as the previewer/Shop Tools AR)
function h_squareToQuad(p) {
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
function h_inverse3(m) {
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
function h_mul3(a, b) {
    var r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++)
        for (var j = 0; j < 3; j++)
            r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    return r;
}
function h_quadToQuad(src, dst) {
    return h_mul3(h_squareToQuad(dst), h_inverse3(h_squareToQuad(src)));
}
function h_toMatrix3d(H) {
    return "matrix3d(" + [
        H[0][0], H[1][0], 0, H[2][0],
        H[0][1], H[1][1], 0, H[2][1],
        0, 0, 1, 0,
        H[0][2], H[1][2], 0, H[2][2],
    ].map(function (n) { return n.toFixed(8); }).join(",") + ")";
}

// The world extent the grid/zones cover. The TABLE is machine 0..size when
// envelope.xsize/ysize are configured; the world extends beyond it to the
// soft-limit envelope when travel exists outside the table (e.g. homing off
// a limit switch and offsetting past a rotary indexer puts real travel in
// negative machine space — keep-out zones must be drawable there). The
// returned `table` sub-rect is the calibration anchor: saved camera
// calibrations map the TABLE corners, never the world corners, so widening
// the world cannot shift existing calibrations. Envelope min/max remain the
// whole story for configs predating the size fields (table == world there).
function envSpans() {
    var e = calState.env || {};
    var xsize = Number(e.xsize), ysize = Number(e.ysize);
    if (!(xsize > 0 && ysize > 0)) {
        var x0f = Number(e.xmin) || 0, y0f = Number(e.ymin) || 0;
        var xsf = Number(e.xmax) - x0f, ysf = Number(e.ymax) - y0f;
        if (!(xsf > 0 && ysf > 0)) return null;
        return { x0: x0f, y0: y0f, xspan: xsf, yspan: ysf,
                 table: { x0: x0f, y0: y0f, x1: x0f + xsf, y1: y0f + ysf } };
    }
    var xmin = Number(e.xmin), ymin = Number(e.ymin);
    var xmax = Number(e.xmax), ymax = Number(e.ymax);
    var x0 = Math.min(0, isFinite(xmin) ? xmin : 0);
    var y0 = Math.min(0, isFinite(ymin) ? ymin : 0);
    var x1 = Math.max(xsize, isFinite(xmax) ? xmax : xsize);
    var y1 = Math.max(ysize, isFinite(ymax) ? ymax : ysize);
    return { x0: x0, y0: y0, xspan: x1 - x0, yspan: y1 - y0,
             table: { x0: 0, y0: 0, x1: xsize, y1: ysize } };
}

// The table rect in grid-svg pixels (svg y runs down from machine ymax).
function tableSvgRect(s) {
    var t = s.table;
    return {
        l: (t.x0 - s.x0) * GRID_K,
        r: (t.x1 - s.x0) * GRID_K,
        t: (s.y0 + s.yspan - t.y1) * GRID_K,
        b: (s.y0 + s.yspan - t.y0) * GRID_K,
    };
}

// A round gridline pitch giving a handful of cells per axis
function gridStep(span) {
    var steps = [1, 2, 5, 6, 10, 12, 24, 25, 50, 100, 250, 500];
    var best = steps[0];
    for (var i = 0; i < steps.length; i++) {
        if (span / steps[i] >= 3) best = steps[i];
    }
    return best;
}

// Build the envelope grid into an svg: border, gridlines, origin marker.
// SVG y runs down, machine y runs up, so the svg top edge is machine ymax
// (the TL corner convention). `strong` = calibration mode styling.
function buildGrid(svg, strong) {
    var s = envSpans();
    if (!s) return false;
    var W = s.xspan * GRID_K, H = s.yspan * GRID_K;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var line = strong ? "rgba(41,128,185,0.9)" : "rgba(41,128,185,0.45)";
    var halo = 'paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"';
    // Gridlines + border live in their own group so the Grid toggle can
    // hide them while zones and the crosshair stay visible.
    var parts = ['<g id="gridlines">'];
    var tr = tableSvgRect(s);
    // Shade the travel area outside the table (fill-rule evenodd: world
    // rect minus table rect) so the off-table region reads as "not table"
    // while staying fully drawable for keep-out zones.
    if (tr.l > 0 || tr.t > 0 || tr.r < W || tr.b < H) {
        parts.push('<path fill="rgba(100,110,120,0.22)" fill-rule="evenodd" d="' +
            'M0 0H' + W + 'V' + H + 'H0Z ' +
            'M' + tr.l + ' ' + tr.t + 'H' + tr.r + 'V' + tr.b + 'H' + tr.l + 'Z"/>');
    }
    // Gridlines land on machine-coordinate multiples of the step (the world
    // may start at a negative machine coordinate, so svg 0 is not machine 0).
    var stepM = gridStep(Math.min(s.xspan, s.yspan));
    for (var gx = Math.ceil(s.x0 / stepM) * stepM; gx <= s.x0 + s.xspan; gx += stepM) {
        var xpx = (gx - s.x0) * GRID_K;
        if (xpx <= 0 || xpx >= W) continue;
        parts.push('<line x1="' + xpx + '" y1="0" x2="' + xpx + '" y2="' + H + '" stroke="' + line + '" stroke-width="1"/>');
    }
    for (var gy = Math.ceil(s.y0 / stepM) * stepM; gy <= s.y0 + s.yspan; gy += stepM) {
        var ypx = (s.y0 + s.yspan - gy) * GRID_K;
        if (ypx <= 0 || ypx >= H) continue;
        parts.push('<line x1="0" y1="' + ypx + '" x2="' + W + '" y2="' + ypx + '" stroke="' + line + '" stroke-width="1"/>');
    }
    // Table border strong; world (soft-limit travel) border dashed when it
    // extends beyond the table.
    parts.push('<rect x="' + tr.l + '" y="' + tr.t + '" width="' + (tr.r - tr.l) +
        '" height="' + (tr.b - tr.t) + '" fill="none" stroke="' + line + '" stroke-width="4"/>');
    if (tr.l > 0 || tr.t > 0 || tr.r < W || tr.b < H) {
        parts.push('<rect x="0" y="0" width="' + W + '" height="' + H +
            '" fill="none" stroke="' + line + '" stroke-width="2" stroke-dasharray="8 6"/>');
    }
    parts.push('</g>');
    // Origin marker + axis arrows at machine (0,0) — offset from the svg
    // bottom-left when the world extends into negative machine space.
    var ax = (0 - s.x0) * GRID_K, ay = (s.y0 + s.yspan) * GRID_K;
    parts.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + (ax + 3 * GRID_K) + '" y2="' + ay + '" stroke="#c0392b" stroke-width="3"/>');
    parts.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + ax + '" y2="' + (ay - 3 * GRID_K) + '" stroke="#27ae60" stroke-width="3"/>');
    parts.push('<text x="' + (ax + 3.6 * GRID_K) + '" y="' + (ay - 2) + '" font-size="' + 1.8 * GRID_K + '" fill="#1a252f" ' + halo + '>X</text>');
    parts.push('<text x="' + (ax + 2) + '" y="' + (ay - 3.6 * GRID_K) + '" font-size="' + 1.8 * GRID_K + '" fill="#1a252f" ' + halo + '>Y</text>');
    parts.push('<text x="' + (ax + 4) + '" y="' + (ay - 4) + '" font-size="' + 1.6 * GRID_K + '" fill="#1a252f" ' + halo + '>0,0</text>');
    svg.innerHTML = parts.join("");
    return true;
}

function warpGrid(svg, corners) {
    var w = window.innerWidth, h = window.innerHeight;
    var W = +svg.getAttribute("width"), H = +svg.getAttribute("height");
    var s = envSpans();
    if (!w || !h || !W || !H || !s) return;
    // The calibrated quad marks the TABLE corners, so the homography maps
    // the table sub-rect of the svg onto it; any world area beyond the
    // table (negative travel etc.) lands outside the quad by extrapolation
    // — exactly where it belongs in the camera view. When table == world
    // this is the full [0,0,W,H] rect, same as always.
    var tr = tableSvgRect(s);
    var Hm = h_quadToQuad(
        [[tr.l, tr.t], [tr.r, tr.t], [tr.r, tr.b], [tr.l, tr.b]],
        [[corners.tl.x * w, corners.tl.y * h], [corners.tr.x * w, corners.tr.y * h],
         [corners.br.x * w, corners.br.y * h], [corners.bl.x * w, corners.bl.y * h]]
    );
    svg.style.transform = h_toMatrix3d(Hm);
    if (svg.id === "live-grid") calState.Hinv = h_inverse3(Hm);
}

function activeImg() {
    return document.getElementById(calState.displayedCam === 2 ? "camera2" : "camera1");
}

function refreshARConfig(cb) {
    fabmo.getConfig(function (err, data) {
        if (!err && data) {
            calState.env = (data.machine && data.machine.envelope) || null;
            calState.cal = (data.machine && data.machine.cameraCalibration) || null;
            calState.units = (data.machine && data.machine.units) || "in";
            calState.zones = (data.machine && data.machine.keepout && data.machine.keepout.zones) || [];
            var d = data.driver || {};
            calState.g55.x = Number(d.g55x) || 0;
            calState.g55.y = Number(d.g55y) || 0;
        }
        cb && cb();
    });
}

// ---- live overlay (grid wash + position crosshair) ----

function calForDisplayed() {
    var c = calState.cal;
    return (c && c.calibrated && c.corners && c.corners.tl && c.corners.tr &&
        c.corners.br && c.corners.bl && (c.port || 1) === calState.displayedCam) ? c : null;
}

// The flat table view is the identity case of the same pipeline: instead
// of the calibrated quad, the envelope maps onto a letterboxed rectangle
// centered in the viewport. Everything downstream (grid, zones, drawing,
// crosshair) is unchanged — so machines without a camera get the full
// keep-out experience on a plain top-down map.
function flatCorners() {
    var s = envSpans();
    if (!s) return null;
    var w = window.innerWidth, h = window.innerHeight;
    var m = 0.07;
    // Fit the WORLD extent on screen, then return the TABLE sub-rect's
    // corners — warpGrid anchors the homography to the table, so the world
    // margin around it lands on screen implicitly.
    var k = Math.min((w * (1 - 2 * m)) / s.xspan, (h * (1 - 2 * m)) / s.yspan);
    var fw = s.xspan * k, fh = s.yspan * k;
    var worldLeft = (w - fw) / 2, worldTop = (h - fh) / 2;
    var t = s.table;
    var left   = (worldLeft + (t.x0 - s.x0) * k) / w;
    var right  = (worldLeft + (t.x1 - s.x0) * k) / w;
    var top    = (worldTop + (s.y0 + s.yspan - t.y1) * k) / h;
    var bottom = (worldTop + (s.y0 + s.yspan - t.y0) * k) / h;
    return {
        tl: { x: left, y: top }, tr: { x: right, y: top },
        br: { x: right, y: bottom }, bl: { x: left, y: bottom },
    };
}

function applyViewImgs() {
    var img1 = document.getElementById("camera1");
    var img2 = document.getElementById("camera2");
    if (calState.viewMode === "table") {
        img1.style.display = "none";
        img2.style.display = "none";
    } else {
        img1.style.display = (calState.displayedCam === 1 && camera1_on) ? "block" : "none";
        img2.style.display = (calState.displayedCam === 2 && camera2_on) ? "block" : "none";
    }
}

function refreshLiveOverlay() {
    var live = document.getElementById("live-grid");
    var gridBtn = document.getElementById("btn-grid");
    var zoneBtn = document.getElementById("btn-zones");
    var calBtn = document.getElementById("btn-calibrate");
    var viewBtn = document.getElementById("btn-view");
    var haveCam = camera1_on || camera2_on;
    var tableMode = calState.viewMode === "table";
    var corners = null;
    if (tableMode) {
        corners = flatCorners();
    } else {
        var c = calForDisplayed();
        corners = c && c.corners;
    }
    applyViewImgs();
    if (corners && !calState.calibrating && buildGrid(live, tableMode)) {
        warpGrid(live, corners);
        // The svg stays up whenever a view exists: the Grid toggle only
        // governs the gridlines group; zones and the crosshair persist.
        live.style.display = "block";
        var gl = live.querySelector("#gridlines");
        if (gl) gl.style.display = (calState.gridOn || calState.zoneMode || tableMode) ? "" : "none";
        gridBtn.style.display = (calState.zoneMode || tableMode) ? "none" : "inline-block";
        gridBtn.classList.toggle("active", calState.gridOn);
        zoneBtn.style.display = calState.zoneMode ? "none" : "inline-block";
        renderZones();
        updateCrosshair();
    } else {
        live.style.display = "none";
        gridBtn.style.display = "none";
        zoneBtn.style.display = "none";
    }
    // View toggle: only meaningful when both a camera and an envelope
    // exist; the calibrate button belongs to the camera view.
    if (!calState.calibrating) {
        viewBtn.style.display = (haveCam && envSpans() && !calState.zoneMode) ? "inline-block" : "none";
        viewBtn.textContent = tableMode ? "Camera View" : "Table View";
        calBtn.style.display = (haveCam && envSpans() && !tableMode && !calState.zoneMode) ? "inline-block" : "none";
        var scanBarOpen = document.getElementById("scan-bar").style.display !== "none";
        document.getElementById("btn-scan").style.display =
            (haveCam && envSpans() && calAnyCamera() && !calState.zoneMode && !scanBarOpen)
                ? "inline-block" : "none";
    }
    positionPlate();
    // Only rewrite the label when a photo is actually shown — the no-camera
    // path owns its own label text ("no camera — table view").
    if (tableMode && !calState.zoneMode && calState.plate && plateMatchesTable()) {
        document.getElementById("cam-label").innerHTML =
            "table view &mdash; photo " + plateAge();
    }
}

function updateCrosshair() {
    var live = document.getElementById("live-grid");
    var s = envSpans();
    if (!s || live.style.display === "none") return;
    var mx = Math.max(0, Math.min(s.xspan, calState.pos.x + calState.g55.x - s.x0));
    var my = Math.max(0, Math.min(s.yspan, calState.pos.y + calState.g55.y - s.y0));
    var px = mx * GRID_K;
    var py = (s.yspan - my) * GRID_K;
    var g = live.querySelector("#cam-pos");
    if (!g) {
        g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("id", "cam-pos");
        g.innerHTML =
            '<line x1="-12" y1="0" x2="12" y2="0" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
            '<line x1="0" y1="-12" x2="0" y2="12" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
            '<line x1="-12" y1="0" x2="12" y2="0" stroke="#c0392b" stroke-width="2.5"/>' +
            '<line x1="0" y1="-12" x2="0" y2="12" stroke="#c0392b" stroke-width="2.5"/>' +
            '<circle cx="0" cy="0" r="5" fill="none" stroke="#c0392b" stroke-width="2.5"/>';
        live.appendChild(g);
    }
    g.setAttribute("transform", "translate(" + px + " " + py + ")");
}

// ---- calibration mode ----

function calHandles() {
    return Array.prototype.slice.call(document.querySelectorAll(".cal-handle"));
}

function positionHandles() {
    var w = window.innerWidth, h = window.innerHeight;
    calHandles().forEach(function (el) {
        var p = calState.draft[el.getAttribute("data-corner")];
        el.style.left = (p.x * w) + "px";
        el.style.top = (p.y * h) + "px";
    });
}

function redrawCalibration() {
    warpGrid(document.getElementById("cal-grid"), calState.draft);
    positionHandles();
}

function enterCalibration() {
    if (!envSpans()) {
        fabmo.notify("warning", "No machine envelope configured - cannot calibrate.");
        return;
    }
    // Calibration happens against the video; leave the flat view if open
    calState.viewMode = "camera";
    applyViewImgs();
    document.getElementById("btn-view").style.display = "none";
    var c = calForDisplayed();
    calState.draft = c ? JSON.parse(JSON.stringify(c.corners)) : {
        tl: { x: 0.15, y: 0.15 }, tr: { x: 0.85, y: 0.15 },
        br: { x: 0.85, y: 0.85 }, bl: { x: 0.15, y: 0.85 },
    };
    calState.calibrating = true;
    buildGrid(document.getElementById("cal-grid"), true);
    document.getElementById("cal-grid").style.display = "block";
    document.getElementById("cal-bar").style.display = "flex";
    document.getElementById("live-grid").style.display = "none";
    document.getElementById("btn-grid").style.display = "none";
    document.getElementById("btn-zones").style.display = "none";
    document.getElementById("btn-scan").style.display = "none";
    document.getElementById("btn-calibrate").style.display = "none";
    document.getElementById("plate-view").style.display = "none";
    calHandles().forEach(function (el) { el.style.display = "block"; });
    redrawCalibration();
}

function exitCalibration() {
    calState.calibrating = false;
    calState.draft = null;
    hideLoupe();
    document.getElementById("cal-grid").style.display = "none";
    document.getElementById("cal-bar").style.display = "none";
    document.getElementById("btn-calibrate").style.display = "inline-block";
    calHandles().forEach(function (el) { el.style.display = "none"; });
    refreshLiveOverlay();
}

function saveCalibration() {
    calState.cal = {
        corners: calState.draft,
        port: calState.displayedCam,
        savedAt: Date.now(),
        calibrated: true,
    };
    fabmo.setConfig({ machine: { cameraCalibration: calState.cal } }, function (err) {
        if (err) fabmo.notify("error", "Saving calibration failed: " + err);
        else fabmo.notify("success", "AR calibration saved.");
    });
    exitCalibration();
}

// ---- loupe (ported from the previewer): a magnified live crop of the
// MJPEG <img> rides over the held corner, since the finger/cursor sits
// exactly on the point being aimed at. Cross-origin drawImage is fine for
// display; only pixel readback would taint.

var LOUPE_ZOOM = 3;
var LOUPE_TOUCH_LIFT = 90;

function drawLoupe(touchLift) {
    var loupe = document.getElementById("cal-loupe");
    var canvas = loupe.querySelector("canvas");
    var p = calState.draft && calState.draft[calState.dragKey];
    if (!canvas || !p) return;
    var w = window.innerWidth, h = window.innerHeight;
    var diamCss = loupe.clientWidth || 148;
    var dpr = window.devicePixelRatio || 1;
    var diamDev = Math.round(diamCss * dpr);
    if (canvas.width !== diamDev) canvas.width = canvas.height = diamDev;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var img = activeImg();
    if (img && img.naturalWidth && img.naturalHeight && w && h) {
        // object-fit:fill → X and Y display scales differ; crop per axis
        var cropW = (diamCss / LOUPE_ZOOM) * (img.naturalWidth / w);
        var cropH = (diamCss / LOUPE_ZOOM) * (img.naturalHeight / h);
        var sx = p.x * img.naturalWidth - cropW / 2;
        var sy = p.y * img.naturalHeight - cropH / 2;
        var vx0 = Math.max(0, sx), vy0 = Math.max(0, sy);
        var vx1 = Math.min(img.naturalWidth, sx + cropW);
        var vy1 = Math.min(img.naturalHeight, sy + cropH);
        if (vx1 > vx0 && vy1 > vy0) {
            var kx = canvas.width / cropW, ky = canvas.height / cropH;
            try {
                ctx.drawImage(img, vx0, vy0, vx1 - vx0, vy1 - vy0,
                    (vx0 - sx) * kx, (vy0 - sy) * ky,
                    (vx1 - vx0) * kx, (vy1 - vy0) * ky);
            } catch (err) { /* stream not decodable yet — leave black */ }
        }
    }
    // Crosshair at the precise anchor
    var mid = canvas.width / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(mid - 14 * dpr, mid); ctx.lineTo(mid + 14 * dpr, mid);
    ctx.moveTo(mid, mid - 14 * dpr); ctx.lineTo(mid, mid + 14 * dpr);
    ctx.stroke();
    loupe.style.left = (p.x * w) + "px";
    loupe.style.top = (p.y * h - touchLift) + "px";
}

function showLoupe(isTouch) {
    var lift = isTouch ? LOUPE_TOUCH_LIFT : 0;
    document.querySelector('.cal-handle[data-corner="' + calState.dragKey + '"]').classList.add("loupe-active");
    document.getElementById("cal-loupe").style.display = "block";
    var tick = function () {
        if (!calState.dragKey) return;
        drawLoupe(lift);
        calState.loupeRAF = requestAnimationFrame(tick);
    };
    drawLoupe(lift);
    calState.loupeRAF = requestAnimationFrame(tick);
}

function hideLoupe() {
    if (calState.loupeRAF) { cancelAnimationFrame(calState.loupeRAF); calState.loupeRAF = null; }
    document.getElementById("cal-loupe").style.display = "none";
    calHandles().forEach(function (el) { el.classList.remove("loupe-active"); });
}

// ---- wiring ----

function setupCalibration() {
    loadPlate();
    refreshARConfig(function () {
        refreshLiveOverlay();
    });

    document.getElementById("btn-scan").onclick = openScanBar;
    document.getElementById("btn-scan-start").onclick = startScan;
    document.getElementById("btn-scan-cancel").onclick = closeScanBar;
    document.getElementById("btn-scan-stop").onclick = function () {
        fabmo.stop();
    };

    document.getElementById("btn-view").onclick = function () {
        calState.viewMode = calState.viewMode === "table" ? "camera" : "table";
        document.getElementById("cam-label").innerHTML =
            calState.viewMode === "table" ? "table view" : "camera " + calState.displayedCam;
        refreshLiveOverlay();
    };

    document.getElementById("btn-calibrate").onclick = enterCalibration;
    document.getElementById("btn-cal-save").onclick = saveCalibration;
    document.getElementById("btn-cal-cancel").onclick = exitCalibration;
    document.getElementById("btn-grid").onclick = function () {
        calState.gridOn = !calState.gridOn;
        refreshLiveOverlay();
    };
    setupZones();

    calHandles().forEach(function (el) {
        el.addEventListener("pointerdown", function (e) {
            if (!calState.calibrating) return;
            e.preventDefault();
            calState.dragKey = el.getAttribute("data-corner");
            showLoupe(e.pointerType === "touch");
        });
    });
    document.addEventListener("pointermove", function (e) {
        if (!calState.dragKey) return;
        var p = calState.draft[calState.dragKey];
        p.x = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
        p.y = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
        redrawCalibration();
    });
    document.addEventListener("pointerup", function () {
        if (!calState.dragKey) return;
        calState.dragKey = null;
        hideLoupe();
    });

    window.addEventListener("resize", function () {
        if (calState.calibrating) redrawCalibration();
        else refreshLiveOverlay();
    });

    fabmo.on("status", function (status) {
        calState.pos.x = Number(status.posx) || 0;
        calState.pos.y = Number(status.posy) || 0;
        if (status.state) calState.mstate = status.state;
        updateCrosshair();
        plateOnStatus(status);
    });
}

// ---------------------------------------------------------------------------
// Keep-out zones
//
// User-drawn regions of the table where the machine shouldn't go — clamps,
// tall material, fixtures. Drawn on the calibrated camera view (rectangles
// or freehand), converted through the inverse homography into MACHINE
// coordinates, and stored in machine.keepout.zones so they survive
// recalibration and can be consumed by job bounds checks and jog routing:
//
//   { id, type: "rect", x0, y0, x1, y1 }          corners in machine units
//   { id, type: "poly", pts: [[x, y], ...] }      closed polygon
//
// Zones render into the warped live-grid svg, so they lie on the table in
// the video exactly where they lie on the real table.

var ZONE_MIN_AREA = 1;        // square machine units — ignore accidental dots
var ZONE_PT_SPACING = 0.4;    // machine units between captured freehand points
var ZONE_MAX_PTS = 300;

// Screen px → machine coordinates through the live-grid inverse homography
function screenToMachine(clientX, clientY) {
    var Hi = calState.Hinv;
    var s = envSpans();
    if (!Hi || !s) return null;
    var x = Hi[0][0] * clientX + Hi[0][1] * clientY + Hi[0][2];
    var y = Hi[1][0] * clientX + Hi[1][1] * clientY + Hi[1][2];
    var w = Hi[2][0] * clientX + Hi[2][1] * clientY + Hi[2][2];
    x /= w; y /= w;
    var mx = s.x0 + x / GRID_K;
    var my = s.y0 + s.yspan - y / GRID_K;
    return {
        x: Math.max(s.x0, Math.min(s.x0 + s.xspan, mx)),
        y: Math.max(s.y0, Math.min(s.y0 + s.yspan, my)),
    };
}

// Machine coordinates → svg px in the live grid
function machineToSvg(mx, my) {
    var s = envSpans();
    return {
        x: (mx - s.x0) * GRID_K,
        y: (s.yspan - (my - s.y0)) * GRID_K,
    };
}

function polyArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return Math.abs(a / 2);
}

function pointInZone(z, p) {
    if (z.type === "rect") {
        return p.x >= Math.min(z.x0, z.x1) && p.x <= Math.max(z.x0, z.x1) &&
               p.y >= Math.min(z.y0, z.y1) && p.y <= Math.max(z.y0, z.y1);
    }
    var inside = false, pts = z.pts || [];
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i][1] > p.y) !== (pts[j][1] > p.y) &&
            p.x < ((pts[j][0] - pts[i][0]) * (p.y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0])
            inside = !inside;
    }
    return inside;
}

function zoneMarkup(z, cls) {
    if (z.type === "rect") {
        var a = machineToSvg(Math.min(z.x0, z.x1), Math.max(z.y0, z.y1));
        var b = machineToSvg(Math.max(z.x0, z.x1), Math.min(z.y0, z.y1));
        return '<rect class="' + cls + '" x="' + a.x + '" y="' + a.y +
            '" width="' + (b.x - a.x) + '" height="' + (b.y - a.y) + '"/>';
    }
    var pts = (z.pts || []).map(function (p) {
        var q = machineToSvg(p[0], p[1]);
        return q.x + "," + q.y;
    }).join(" ");
    return '<polygon class="' + cls + '" points="' + pts + '"/>';
}

function renderZones() {
    var live = document.getElementById("live-grid");
    if (!live) return;
    var g = live.querySelector("#zones");
    if (!g) {
        g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("id", "zones");
        // Zones sit above gridlines but under the crosshair
        var pos = live.querySelector("#cam-pos");
        live.insertBefore(g, pos || null);
    }
    var parts = calState.zones.map(function (z) { return zoneMarkup(z, "ko-zone"); });
    // In-progress stroke preview
    var st = calState.zoneStroke;
    if (st && st.type === "rect" && st.p1) {
        parts.push(zoneMarkup({ type: "rect", x0: st.p0.x, y0: st.p0.y, x1: st.p1.x, y1: st.p1.y }, "ko-zone ko-draft"));
    } else if (st && st.type === "poly" && st.pts.length > 1) {
        parts.push(zoneMarkup({ type: "poly", pts: st.pts }, "ko-zone ko-draft"));
    }
    g.innerHTML = parts.join("");
}

function saveZones() {
    fabmo.setConfig({ machine: { keepout: { zones: calState.zones, savedAt: Date.now() } } }, function (err) {
        if (err) fabmo.notify("error", "Saving keep-out zones failed: " + err);
    });
}

// ---- zone edit mode ----

function setZoneTool(tool) {
    calState.zoneTool = tool;
    ["rect", "draw", "erase"].forEach(function (t) {
        document.getElementById("btn-zone-" + t).classList.toggle("active", t === tool);
    });
    var hints = {
        rect: "Drag a rectangle around the obstacle",
        draw: "Draw around the obstacle freehand",
        erase: "Tap a zone to remove it",
    };
    document.getElementById("zone-hint").textContent = hints[tool];
}

function enterZoneMode() {
    if (!calForDisplayed()) return;
    calState.zoneMode = true;
    document.getElementById("zone-bar").style.display = "flex";
    document.getElementById("zone-capture").style.display = "block";
    document.getElementById("btn-calibrate").style.display = "none";
    setZoneTool(calState.zoneTool || "rect");
    refreshLiveOverlay();
}

function exitZoneMode() {
    calState.zoneMode = false;
    calState.zoneStroke = null;
    document.getElementById("zone-bar").style.display = "none";
    document.getElementById("zone-capture").style.display = "none";
    document.getElementById("btn-calibrate").style.display = "inline-block";
    refreshLiveOverlay();
}

function setupZones() {
    var capture = document.getElementById("zone-capture");

    document.getElementById("btn-zones").onclick = enterZoneMode;
    document.getElementById("btn-zone-done").onclick = exitZoneMode;
    ["rect", "draw", "erase"].forEach(function (t) {
        document.getElementById("btn-zone-" + t).onclick = function () { setZoneTool(t); };
    });

    capture.addEventListener("pointerdown", function (e) {
        if (!calState.zoneMode) return;
        e.preventDefault();
        capture.setPointerCapture(e.pointerId);
        var p = screenToMachine(e.clientX, e.clientY);
        if (!p) return;
        if (calState.zoneTool === "erase") {
            // Topmost (most recent) zone under the tap goes away
            for (var i = calState.zones.length - 1; i >= 0; i--) {
                if (pointInZone(calState.zones[i], p)) {
                    calState.zones.splice(i, 1);
                    saveZones();
                    renderZones();
                    break;
                }
            }
            return;
        }
        calState.zoneStroke = calState.zoneTool === "rect"
            ? { type: "rect", p0: p, p1: null }
            : { type: "poly", pts: [[p.x, p.y]] };
    });

    capture.addEventListener("pointermove", function (e) {
        var st = calState.zoneStroke;
        if (!st) return;
        var p = screenToMachine(e.clientX, e.clientY);
        if (!p) return;
        if (st.type === "rect") {
            st.p1 = p;
        } else {
            var last = st.pts[st.pts.length - 1];
            var d = Math.hypot(p.x - last[0], p.y - last[1]);
            if (d >= ZONE_PT_SPACING && st.pts.length < ZONE_MAX_PTS) st.pts.push([p.x, p.y]);
        }
        renderZones();
    });

    var finish = function () {
        var st = calState.zoneStroke;
        calState.zoneStroke = null;
        if (!st) return;
        var zone = null;
        if (st.type === "rect" && st.p1) {
            var area = Math.abs(st.p1.x - st.p0.x) * Math.abs(st.p1.y - st.p0.y);
            if (area >= ZONE_MIN_AREA) {
                zone = { id: "z" + Date.now(), type: "rect", x0: st.p0.x, y0: st.p0.y, x1: st.p1.x, y1: st.p1.y };
            }
        } else if (st.type === "poly" && st.pts.length >= 3 && polyArea(st.pts) >= ZONE_MIN_AREA) {
            zone = { id: "z" + Date.now(), type: "poly", pts: st.pts };
        }
        if (zone) {
            calState.zones.push(zone);
            saveZones();
        }
        renderZones();
    };
    capture.addEventListener("pointerup", finish);
    capture.addEventListener("pointercancel", finish);
}

// ---------------------------------------------------------------------------
// Table photo ("clean plate")
//
// A gantry-free, top-down photo of the table, stitched from camera frames
// taken with the machine parked at a few known X positions. The gantry beam
// spans the whole Y travel, so each frame hides only a band of X around the
// machine's position — park at three well-spread X stations and every point
// of the table is visible in at least one frame. Frames are inverse-warped
// through the saved AR calibration into machine space and composited. The
// result backs the flat Table View, so keep-out zones get drawn over the
// actual clamps and the crosshair rides over the actual material.
//
// Perspective: from an oblique camera the occluded region is not the
// gantry's plan footprint but its shadow cast from the camera's eye onto
// the table plane — it trails toward the far side of the table and widens
// with distance, easily past any fixed band. So the band is only a
// DISQUALIFIER, never the trusted occlusion edge. Safety comes from two
// model-free rules: (1) each pixel's reference is the frame whose station
// is farthest away in X — a shadow only reaches a third of the table from
// its beam if the camera sits at gantry height, where it can't see the
// table at all; (2) other candidate frames are blended in only where they
// AGREE with that reference, so a frame polluted by a long perspective
// shadow (or the dust hose straying outside the band) disagrees and is
// rejected pixel-by-pixel, with no camera model needed.
//
// The scan jogs X only — Y and Z stay where the user left them — as a plain
// G-code job (G0 + G4 dwells), so the normal Stop machinery applies. Frames
// are grabbed off a second, CORS-enabled stream client while position
// reports hold still inside a dwell; pixel readback is proven BEFORE any
// motion starts. The photo persists in this browser's localStorage.

var PLATE = {
    stations: [0.12, 0.5, 0.88], // fractions of table X span to park at
    band: 0.18,                  // gantry occlusion half-width (fraction of X span)
    maxPx: 1400,                 // longest plate edge, pixels
    dwell: 3,                    // seconds of G4 dwell at each station
    jpegQ: 0.85,
    storageKey: "fabmo_table_photo",
};

var scanState = null; // active scan, or null

function plateStreamURL(port) {
    return "http://" + location.hostname + ":" + (port === 2 ? 3142 : 3141) +
        "/?" + Math.random();
}

// Any saved calibration, regardless of which camera is currently displayed —
// the scan captures from the calibrated camera's own stream.
function calAnyCamera() {
    var c = calState.cal;
    return (c && c.calibrated && c.corners && c.corners.tl && c.corners.tr &&
        c.corners.br && c.corners.bl) ? c : null;
}

function loadPlate() {
    try {
        var rec = JSON.parse(localStorage.getItem(PLATE.storageKey));
        if (rec && rec.dataUrl && rec.table) {
            calState.plate = rec;
            document.getElementById("plate-view").src = rec.dataUrl;
        }
    } catch (e) {
        calState.plate = null;
    }
}

// Only show a stored photo that covers the table currently configured
function plateMatchesTable() {
    var s = envSpans();
    var p = calState.plate;
    if (!s || !p || !p.table) return false;
    var t = s.table, q = p.table;
    var tol = Math.max(t.x1 - t.x0, t.y1 - t.y0) * 0.01;
    return Math.abs(t.x0 - q.x0) < tol && Math.abs(t.y0 - q.y0) < tol &&
        Math.abs(t.x1 - q.x1) < tol && Math.abs(t.y1 - q.y1) < tol;
}

function plateAge() {
    var m = Math.round((Date.now() - calState.plate.savedAt) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " hr ago";
    return Math.round(h / 24) + " days ago";
}

// Lay the photo onto the table rect of the flat view (the plate is already
// top-down machine space, so this is a plain scale, no homography).
function positionPlate() {
    var img = document.getElementById("plate-view");
    if (calState.viewMode !== "table" || calState.calibrating ||
        !calState.plate || !plateMatchesTable()) {
        img.style.display = "none";
        return;
    }
    var corners = flatCorners();
    if (!corners) {
        img.style.display = "none";
        return;
    }
    var w = window.innerWidth, h = window.innerHeight;
    img.style.left = (corners.tl.x * w) + "px";
    img.style.top = (corners.tl.y * h) + "px";
    img.style.width = ((corners.tr.x - corners.tl.x) * w) + "px";
    img.style.height = ((corners.bl.y - corners.tl.y) * h) + "px";
    img.style.display = "block";
}

function setScanMsg(msg) {
    document.getElementById("scan-msg").textContent = msg;
}

function openScanBar() {
    if (calState.mstate !== "idle") {
        fabmo.notify("warning", "The machine must be idle to scan the table.");
        return;
    }
    document.getElementById("scan-bar").style.display = "flex";
    document.getElementById("btn-scan-start").style.display = "inline-block";
    document.getElementById("btn-scan-stop").style.display = "none";
    document.getElementById("btn-scan-cancel").style.display = "inline-block";
    document.getElementById("btn-scan").style.display = "none";
    setScanMsg("The machine will jog across X (Y and Z stay put) and " +
        "photograph the table between moves. Raise the bit clear of clamps " +
        "and material first.");
}

function closeScanBar() {
    if (scanState && scanState.img) scanState.img.src = "";
    scanState = null;
    document.getElementById("scan-bar").style.display = "none";
    refreshLiveOverlay();
}

function failScan(msg) {
    // A mid-scan failure leaves the jog job running — bring it to a stop
    // ("stopped" here is a G4 dwell in progress, see plateOnStatus)
    if (scanState && scanState.sawRunning &&
        (calState.mstate === "running" || calState.mstate === "stopped")) {
        fabmo.stop();
    }
    if (msg) fabmo.notify("error", msg);
    closeScanBar();
}

function startScan() {
    if (scanState) return; // double-click guard
    refreshARConfig(function () {
        if (scanState) return;
        var cal = calAnyCamera();
        var s = envSpans();
        if (!cal || !s) {
            failScan("Scanning needs a saved AR calibration.");
            return;
        }
        var t = s.table;
        var xspan = t.x1 - t.x0;
        var stations = PLATE.stations.map(function (f) { return t.x0 + f * xspan; });
        // Start from the end nearest the current position
        var curX = calState.pos.x + calState.g55.x;
        if (Math.abs(curX - stations[stations.length - 1]) < Math.abs(curX - stations[0])) {
            stations.reverse();
        }
        var sc = scanState = {
            cal: JSON.parse(JSON.stringify(cal)),
            stations: stations,
            eps: Math.max(0.05, xspan * 0.002),
            band: PLATE.band * xspan,
            frames: [],
            stable: 0,
            lastX: null,
            started: false,
            sawRunning: false,
            img: new Image(),
        };
        document.getElementById("btn-scan-start").style.display = "none";
        document.getElementById("btn-scan-cancel").style.display = "none";
        document.getElementById("btn-scan-stop").style.display = "inline-block";
        setScanMsg("Connecting to camera…");
        // A separate CORS-enabled stream client: the display <img>s stay
        // non-CORS so the live view can never break against an older
        // camera server that doesn't send the CORS header.
        var port = sc.cal.port || 1;
        var timer = setTimeout(function () {
            if (scanState === sc && !sc.started) {
                failScan("The camera stream did not respond — is the camera server running?");
            }
        }, 8000);
        sc.img.crossOrigin = "anonymous";
        sc.img.onerror = function () {
            clearTimeout(timer);
            if (scanState === sc && !sc.started) {
                failScan("The camera server refused a capture connection. " +
                    "Restart the camera service (camera-server-" + port + ") and retry.");
            }
        };
        sc.img.onload = function () {
            if (scanState !== sc || sc.started) return;
            clearTimeout(timer);
            // Prove pixel readback works BEFORE any motion starts
            try {
                var cv = document.createElement("canvas");
                cv.width = cv.height = 2;
                var cx = cv.getContext("2d");
                cx.drawImage(sc.img, 0, 0, 2, 2);
                cx.getImageData(0, 0, 1, 1);
            } catch (e) {
                failScan("The camera stream does not allow image capture — " +
                    "restart the camera service (camera-server-" + port + ") after updating.");
                return;
            }
            sc.started = true;
            runScanJob(sc);
        };
        sc.img.src = plateStreamURL(port);
    });
}

function runScanJob(sc) {
    // G4 dwells rather than SBP PAUSE: no dashboard modal, and the position
    // stream keeps flowing while the machine holds still — which is exactly
    // the capture signal. G20/G21 reasserts the machine's configured units.
    var lines = ["( FabMo camera table scan )",
        calState.units === "mm" ? "G21" : "G20",
        "G4 P0.5"];
    sc.stations.forEach(function (mx) {
        lines.push("G0 X" + (mx - calState.g55.x).toFixed(4));
        lines.push("G4 P" + PLATE.dwell);
    });
    setScanMsg("Scanning 1/" + sc.stations.length + "… (Z does not move)");
    fabmo.runGCode(lines.join("\n"), function (err) {
        if (err && scanState === sc) {
            failScan("Could not start the scan: " + (err.message || JSON.stringify(err)));
        }
    });
    // If the job never reaches "running", don't sit here forever
    setTimeout(function () {
        if (scanState === sc && !sc.sawRunning) {
            failScan("The scan job never started.");
        }
    }, 20000);
}

// Ride the status reports: inside a dwell at a station the position holds
// still — two consecutive on-target reports mean the frame is clean to grab.
// Bench-measured state sequence for a G0+G4 job on the immediate gcode
// runtime: "running" through moves, "stopped" for the whole of each G4
// dwell, "idle" after the job — so "stopped" means dwelling, NOT aborted,
// and capture keys off position stillness alone.
function plateOnStatus(status) {
    var sc = scanState;
    if (!sc || !sc.started) return;
    var state = status.state;
    var mx = (Number(status.posx) || 0) + calState.g55.x;
    // Until the job is actually underway, ignore idle reports — the machine
    // may already be sitting at the first station. The scan only starts
    // from idle, so running/stopped both imply the job is active.
    if (state === "running" || state === "stopped") sc.sawRunning = true;
    if (!sc.sawRunning) return;
    if (state === "paused") {
        // Feedhold — someone wants the machine still; don't keep scanning
        failScan("Scan interrupted.");
        return;
    }
    var target = sc.stations[sc.frames.length];
    if (target !== undefined && state !== "idle") {
        if (Math.abs(mx - target) <= sc.eps &&
            sc.lastX !== null && Math.abs(mx - sc.lastX) <= sc.eps * 0.5) {
            sc.stable++;
            if (sc.stable >= 2) grabScanFrame(sc, target);
        } else {
            sc.stable = 0;
        }
        sc.lastX = mx;
    }
    if (state === "idle") {
        // Job over. The last dwell can end before two stable reports arrive
        // — if we came to rest on target, grab the final frame now. A scan
        // the user stopped early lands here too, with frames missing; the
        // composite merges what it got over the previous photo.
        if (target !== undefined && Math.abs(mx - target) <= sc.eps) {
            grabScanFrame(sc, target);
        }
        finishScan(sc);
    }
}

function grabScanFrame(sc, target) {
    var img = sc.img;
    if (!img.naturalWidth) return; // no frame decoded yet — try next report
    var cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    var data;
    try {
        data = ctx.getImageData(0, 0, cv.width, cv.height);
    } catch (e) {
        failScan("The browser blocked camera capture mid-scan.");
        return;
    }
    sc.frames.push({ station: target, data: data });
    sc.stable = 0;
    if (sc.frames.length < sc.stations.length) {
        setScanMsg("Scanning " + (sc.frames.length + 1) + "/" + sc.stations.length + "…");
    }
}

function finishScan(sc) {
    scanState = null;
    sc.img.src = "";
    if (!sc.frames.length) {
        failScan("The scan ended before any pictures were taken.");
        return;
    }
    if (sc.frames.length < sc.stations.length) {
        fabmo.notify("warning", "Scan ended early — building the photo from " +
            sc.frames.length + " of " + sc.stations.length + " views.");
    }
    setScanMsg("Building table photo…");
    // Let the message paint before the heavy loop
    setTimeout(function () {
        try {
            compositePlate(sc);
            fabmo.notify("success", "Table photo updated.");
        } catch (e) {
            console.error(e);
            fabmo.notify("error", "Building the table photo failed: " + e.message);
        }
        document.getElementById("scan-bar").style.display = "none";
        refreshLiveOverlay();
    }, 50);
}

function projectPx(H, x, y) {
    var w = H[2][0] * x + H[2][1] * y + H[2][2];
    return [
        (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
        (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
    ];
}

// Webcams auto-expose, so frames of the same table differ in brightness and
// would seam where the composite switches source. Gains are estimated from
// PAIRED per-pixel ratios: at each sampled pixel the cross-frame median is
// the consensus value, and each frame's gain is the median over pixels of
// consensus/value. Occluded pixels (gantry or its perspective shadow, at
// any camera angle) produce outlier ratios in well under half of any one
// frame's samples, so the medians ignore them — where unpaired statistics
// fail outright, because each frame hides a DIFFERENT part of the table.
function plateGains(sc, H, t, k, pw, ph) {
    var n = sc.frames.length;
    var gains = [], samples = [];
    for (var i = 0; i < n; i++) {
        gains.push([1, 1, 1]);
        samples.push([[], [], []]);
    }
    if (n < 2) return gains;
    var w0 = sc.frames[0].data.width, h0 = sc.frames[0].data.height;
    var step = Math.max(2, Math.floor(pw / 220));
    for (var py = 0; py < ph; py += step) {
        for (var px = 0; px < pw; px += step) {
            var p = projectPx(H, px + 0.5, py + 0.5);
            var sx = Math.round(p[0]), sy = Math.round(p[1]);
            if (sx < 0 || sy < 0 || sx >= w0 || sy >= h0) continue;
            var idx = (sy * w0 + sx) * 4;
            for (var f2 = 0; f2 < n; f2++) {
                var d = sc.frames[f2].data.data;
                samples[f2][0].push(d[idx]);
                samples[f2][1].push(d[idx + 1]);
                samples[f2][2].push(d[idx + 2]);
            }
        }
    }
    var m = samples[0][0].length;
    if (m < 50) return gains;
    var byValue = function (a, b) { return a - b; };
    // Each frame's exposure relative to frame 0 is the median of per-pixel
    // paired ratios v0/vf. A pixel occluded in frame 0 gives a near-zero
    // outlier, one occluded in frame f a huge one — both sides stay well
    // under half the samples, so the median sits in the clean middle. Then
    // normalize so the mean gain is 1: output brightness = mean exposure.
    for (var ch = 0; ch < 3; ch++) {
        var rel = [1];
        for (var f = 1; f < n; f++) {
            var ratios = [];
            for (var s = 0; s < m; s++) {
                var a = samples[0][ch][s], b = samples[f][ch][s];
                if (a < 4 && b < 4) continue; // both too dark to carry info
                ratios.push((a + 1) / (b + 1));
            }
            if (ratios.length < 50) { rel.push(1); continue; }
            ratios.sort(byValue);
            rel.push(ratios[ratios.length >> 1]);
        }
        var mean = 0;
        for (var f2 = 0; f2 < n; f2++) mean += rel[f2];
        mean /= n;
        for (var f3 = 0; f3 < n; f3++) {
            gains[f3][ch] = Math.max(0.7, Math.min(1.4, rel[f3] / mean));
        }
    }
    return gains;
}

function compositePlate(sc) {
    var s = envSpans();
    if (!s) throw new Error("no machine envelope");
    var t = s.table;
    var xspan = t.x1 - t.x0, yspan = t.y1 - t.y0;
    var k = PLATE.maxPx / Math.max(xspan, yspan);
    var pw = Math.max(16, Math.round(xspan * k));
    var ph = Math.max(16, Math.round(yspan * k));
    var c = sc.cal.corners;
    var nw = sc.frames[0].data.width, nh = sc.frames[0].data.height;
    // Plate px (row 0 = machine ymax, the shared TL convention) → camera
    // frame px, via the saved table-corner calibration. One homography
    // serves every frame — the camera never moved.
    var H = h_quadToQuad(
        [[0, 0], [pw, 0], [pw, ph], [0, ph]],
        [[c.tl.x * nw, c.tl.y * nh], [c.tr.x * nw, c.tr.y * nh],
         [c.br.x * nw, c.br.y * nh], [c.bl.x * nw, c.bl.y * nh]]
    );
    var cv = document.createElement("canvas");
    cv.width = pw;
    cv.height = ph;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#30353a";
    ctx.fillRect(0, 0, pw, ph);
    // Start from the previous photo when it covers the same table, so a
    // partial scan refreshes what it saw and keeps the rest.
    var prev = document.getElementById("plate-view");
    if (calState.plate && plateMatchesTable() &&
        prev.naturalWidth === pw && prev.naturalHeight === ph) {
        ctx.drawImage(prev, 0, 0);
    }
    var out = ctx.getImageData(0, 0, pw, ph);
    var od = out.data;
    var gains = plateGains(sc, H, t, k, pw, ph);
    var n = sc.frames.length;
    // Gain-corrected bilinear sample; the corner indices are shared by all
    // frames because the camera never moved (one homography for the scan).
    var sampleRGB = function (fd, i00, i10, i01, i11, fx, fy, gain, rgb) {
        for (var ch = 0; ch < 3; ch++) {
            var v = fd[i00 + ch] * (1 - fx) * (1 - fy) +
                    fd[i10 + ch] * fx * (1 - fy) +
                    fd[i01 + ch] * (1 - fx) * fy +
                    fd[i11 + ch] * fx * fy;
            v *= gain[ch];
            rgb[ch] = v > 255 ? 255 : v;
        }
    };
    var AGREE = 90; // summed |ΔRGB| under which two frames see the same thing
    var ref = [0, 0, 0], cand = [0, 0, 0], acc = [0, 0, 0];
    for (var py = 0; py < ph; py++) {
        for (var px = 0; px < pw; px++) {
            var mx = t.x0 + (px + 0.5) / k;
            // The gantry beam spans all of Y, so the X band around each
            // frame's station disqualifies it. The REFERENCE is the frame
            // whose station is farthest — the only frame that stays clean
            // under perspective (see the header comment).
            var best = -1, bestD = 0;
            for (var f = 0; f < n; f++) {
                var dist = Math.abs(mx - sc.frames[f].station);
                if (dist > sc.band && dist > bestD) { bestD = dist; best = f; }
            }
            if (best < 0) continue;
            var p = projectPx(H, px + 0.5, py + 0.5);
            var sx = p[0], sy = p[1];
            if (sx < 0 || sy < 0 || sx > nw - 1.001 || sy > nh - 1.001) continue;
            var x0 = Math.floor(sx), y0 = Math.floor(sy);
            var fx = sx - x0, fy = sy - y0;
            var i00 = (y0 * nw + x0) * 4;
            var i10 = i00 + 4, i01 = i00 + nw * 4, i11 = i00 + nw * 4 + 4;
            sampleRGB(sc.frames[best].data.data, i00, i10, i01, i11, fx, fy, gains[best], ref);
            // Blend in the other candidates ONLY where they agree with the
            // reference — a perspective gantry shadow or a strayed dust
            // hose makes a frame disagree and it is rejected per-pixel.
            // Weight = margin beyond the band, so blends fade continuously
            // and station handoffs don't seam.
            var wRef = bestD - sc.band;
            acc[0] = ref[0] * wRef;
            acc[1] = ref[1] * wRef;
            acc[2] = ref[2] * wRef;
            var wsum = wRef;
            for (var f2 = 0; f2 < n; f2++) {
                if (f2 === best) continue;
                var dist2 = Math.abs(mx - sc.frames[f2].station);
                if (dist2 <= sc.band) continue;
                sampleRGB(sc.frames[f2].data.data, i00, i10, i01, i11, fx, fy, gains[f2], cand);
                if (Math.abs(cand[0] - ref[0]) + Math.abs(cand[1] - ref[1]) +
                    Math.abs(cand[2] - ref[2]) > AGREE) continue;
                var w2 = dist2 - sc.band;
                acc[0] += cand[0] * w2;
                acc[1] += cand[1] * w2;
                acc[2] += cand[2] * w2;
                wsum += w2;
            }
            var oi = (py * pw + px) * 4;
            od[oi] = acc[0] / wsum;
            od[oi + 1] = acc[1] / wsum;
            od[oi + 2] = acc[2] / wsum;
            od[oi + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
    var rec = {
        dataUrl: cv.toDataURL("image/jpeg", PLATE.jpegQ),
        savedAt: Date.now(),
        table: { x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 },
        pw: pw,
        ph: ph,
    };
    try {
        localStorage.setItem(PLATE.storageKey, JSON.stringify(rec));
    } catch (e) {
        fabmo.notify("warning", "The table photo could not be saved and will be lost on reload.");
    }
    calState.plate = rec;
    document.getElementById("plate-view").src = rec.dataUrl;
    // Reveal the result
    calState.viewMode = "table";
    document.getElementById("cam-label").innerHTML = "table view";
}
