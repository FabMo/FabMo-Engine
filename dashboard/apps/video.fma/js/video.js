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
            if (calState.calibrating) {
                exitCalibration();
            } else if (calState.zoneMode) {
                exitZoneMode();
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

// The grid/AR rectangle is the physical table: machine 0..size when
// envelope.xsize/ysize are configured. Envelope min/max are soft limits and
// include overtravel, so they overstate the table; they remain the fallback
// for configs predating the size fields.
function envSpans() {
    var e = calState.env || {};
    var xsize = Number(e.xsize), ysize = Number(e.ysize);
    var x0 = xsize > 0 ? 0 : (Number(e.xmin) || 0);
    var y0 = ysize > 0 ? 0 : (Number(e.ymin) || 0);
    var xs = xsize > 0 ? xsize : Number(e.xmax) - x0;
    var ys = ysize > 0 ? ysize : Number(e.ymax) - y0;
    return (xs > 0 && ys > 0) ? { x0: x0, y0: y0, xspan: xs, yspan: ys } : null;
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
    var step = gridStep(Math.min(s.xspan, s.yspan)) * GRID_K;
    for (var x = step; x < W; x += step)
        parts.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" stroke="' + line + '" stroke-width="1"/>');
    for (var y = step; y < H; y += step)
        parts.push('<line x1="0" y1="' + (H - y) + '" x2="' + W + '" y2="' + (H - y) + '" stroke="' + line + '" stroke-width="1"/>');
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="none" stroke="' + line + '" stroke-width="4"/>');
    parts.push('</g>');
    // Origin marker + axis arrows at machine (0,0) = svg bottom-left
    var ax = 0, ay = H;
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
    if (!w || !h || !W || !H) return;
    var Hm = h_quadToQuad(
        [[0, 0], [W, 0], [W, H], [0, H]],
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
    var k = Math.min((w * (1 - 2 * m)) / s.xspan, (h * (1 - 2 * m)) / s.yspan);
    var fw = s.xspan * k, fh = s.yspan * k;
    var left = (w - fw) / 2 / w, top = (h - fh) / 2 / h;
    var right = left + fw / w, bottom = top + fh / h;
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
    document.getElementById("btn-calibrate").style.display = "none";
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
    refreshARConfig(function () {
        refreshLiveOverlay();
    });

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
        updateCrosshair();
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
