
initVideo = function() {
var img = document.getElementById('video');
var img1 = document.getElementById('video1');

// Which cameras answered the last detection. The saved layout is a
// preference ("both", "cam1", "cam2"); what is actually shown is that
// preference cut down to the cameras that exist, so a single camera gets
// the whole pane no matter which port it came up on (a lone camera can
// land on the second port) and a missing one never leaves a dead half.
var present = { camera1: false, camera2: false };

function effectiveLayout() {
    let layout = localStorage.getItem("fabmo_sb4_video_layout") || "none";
    if (layout === 'none') { return 'none'; }
    if (present.camera1 && present.camera2) { return layout; }
    if (present.camera1) { return 'cam1'; }
    if (present.camera2) { return 'cam2'; }
    return 'none';
}

function resize() {                                 // use the retained setting, as far as the cameras allow
    switch (effectiveLayout()) {
    case 'cam1': // Cam1
        img.width = g.COnt_Width;
        img.height = g.COnt_Height;
        img1.width = 0;
        img1.height = 0;
        break;
    case 'cam2': // Cam2
        img.width = 0;
        img.height = 0;
        img1.width = g.COnt_Width;
        img1.height = g.COnt_Height;
        break;
    case 'both': // both
        img.width = g.COnt_Width/2;
        img.height = g.COnt_Height;
        img1.width = g.COnt_Width/2;
        img1.height = g.COnt_Height;
        break;
    case 'none':
    default:
        break;
    }
}

// Run fn only once the document has finished loading. An MJPEG <img>
// request never completes (and with a streamer up but no camera it never
// even answers), so one opened while the document is still loading parks
// readyState at 'interactive' forever -- and the dashboard's app-launch
// gear waits on this iframe's load event.
function whenLoaded(fn) {
    if (document.readyState === 'complete') {
        fn();
    } else {
        window.addEventListener('load', function onLoad() {
            window.removeEventListener('load', onLoad);
            fn();
        });
    }
}

function reload() {
    // Detection goes through shared-video's getCameraStatus(), which aborts
    // its probes on a deadline and maintains fabmo_sb4_has_video itself.
    let detect = (window.FabMoVideo && window.FabMoVideo.getCameraStatus)
        ? window.FabMoVideo.getCameraStatus()
        : Promise.resolve({ camera1: false, camera2: false });

    detect.then(function (status) {
        whenLoaded(function () {
            present = { camera1: !!status.camera1, camera2: !!status.camera2 };
            let layout = effectiveLayout();
            if (layout === 'cam1' || layout === 'both') {
                img.src = 'http://' + location.hostname + ':3141?' + Math.random();
            } else {
                img.removeAttribute('src');
            }
            if (layout === 'cam2' || layout === 'both') {
                img1.src = 'http://' + location.hostname + ':3142?' + Math.random();
            } else {
                img1.removeAttribute('src');
            }
            resize();
        });
    });
}

$('#sbp-container').on('click', function () {     // move forward to next layout on click
    let layout = localStorage.getItem("fabmo_sb4_video_layout") || "none";
    if (layout === 'none') { return; }
    if (!(present.camera1 && present.camera2)) {    // one camera: nothing to cycle through
        return;
    }
    switch (layout) {
        case 'both': layout = 'cam1'; break;
        case 'cam1': layout = 'cam2'; break;
        case 'cam2':
        default:     layout = 'both'; break;
    }
    console.log("New video layout: " + layout);
    localStorage.setItem("fabmo_sb4_video_layout", layout);
    reload();
});

// Initial load
// Defer initial load to allow page to render correctly
setTimeout(reload, 150);

};

