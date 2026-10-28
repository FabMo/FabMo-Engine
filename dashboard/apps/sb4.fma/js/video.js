
initVideo = function() {
var img = document.getElementById('video');
var img1 = document.getElementById('video1');

function resize() {                                 // use the retained setting
    let layout = localStorage.getItem("fabmo_sb4_video_layout") || "none";
    switch (layout) {
    case 'none':
        break;
    case 'cam1': // Cam1
        img.width = g.COnt_Width;
        img.height = g.COnt_Height;
        img1.width = 0;
        img1.height = 0;
        //img.src = 'http://' + location.hostname + ':3141?' + Math.random();
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
    default:
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
    let layout = localStorage.getItem("fabmo_sb4_video_layout") || "none";

    // Detection goes through shared-video's getCameraStatus(), which aborts
    // its probes on a deadline and maintains fabmo_sb4_has_video itself.
    let detect = (window.FabMoVideo && window.FabMoVideo.getCameraStatus)
        ? window.FabMoVideo.getCameraStatus()
        : Promise.resolve({ camera1: false, camera2: false });

    detect.then(function (status) {
        whenLoaded(function () {
            if (status.camera1 && (layout === 'cam1' || layout === 'both')) {
                img.src = 'http://' + location.hostname + ':3141?' + Math.random();
            } else {
                img.removeAttribute('src');
            }
            if (status.camera2 && (layout === 'cam2' || layout === 'both')) {
                img1.src = 'http://' + location.hostname + ':3142?' + Math.random();
            } else {
                img1.removeAttribute('src');
            }
            resize();
        });
    });
}

$('#sbp-container').on('click', function () {     // move forward to next layout on click
    console.log("Video layout change requested");
    let layout = localStorage.getItem("fabmo_sb4_video_layout") || "none";
    console.log("Current layout: " + layout);
    switch (layout) {
        case 'none':
            break;
        case 'both': // Next Cam1
            layout = 'cam1';
            img.width = g.COnt_Width;
            img.height = g.COnt_Height;
            img1.width = 0;
            img1.height = 0;
            break;
        case 'cam1': // Next Cam2
            layout = 'cam2';
            img.width = 0;
            img.height = 0;
            img1.width = g.COnt_Width;
            img1.height = g.COnt_Height;
            break;
        case 'cam2': // Next both
            layout = 'both';
            img.width = g.COnt_Width/2;
            img.height = g.COnt_Height;
            img1.width = g.COnt_Width/2;
            img1.height = g.COnt_Height;
            break;
        case 'none': // Next Both
        default:
    }
    console.log("New layout: " + layout);
    localStorage.setItem("fabmo_sb4_video_layout", layout);
    reload();
});

// Initial load
// Defer initial load to allow page to render correctly
setTimeout(reload, 150);

};

