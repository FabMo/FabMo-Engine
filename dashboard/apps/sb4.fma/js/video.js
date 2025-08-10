
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

function reload() {
    let cam1Available = false;
    let cam2Available = false;

    img.onload = function() {
        cam1Available = true;
        checkVideoAvailability();
        resize();
    };
    img.onerror = function() {
        console.log("Camera 1 not available");
        img.removeAttribute('src');
        checkVideoAvailability();
    };
    img.src = 'http://' + location.hostname + ':3141?' + Math.random();

    img1.onload = function() {
        cam2Available = true;
        checkVideoAvailability();
        resize();
    };
    img1.onerror = function() {
        console.log("Camera 2 not available");
        img1.removeAttribute('src');
        checkVideoAvailability();
    };
    img1.src = 'http://' + location.hostname + ':3142?' + Math.random();

    function checkVideoAvailability() {
        // Set availability based on actual camera detection
        if (cam1Available || cam2Available) {
            localStorage.setItem("fabmo_sb4_has_video", "true");
        } else {
            localStorage.setItem("fabmo_sb4_has_video", "false");
        }
    }
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

