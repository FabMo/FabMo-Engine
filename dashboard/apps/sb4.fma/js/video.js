
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

    async function reload() {
        // Use shared camera detection
        const cameraStatus = await window.FabMoVideo.getCameraStatus();
        
        if (cameraStatus.camera1) {
            img.src = 'http://' + location.hostname + ':3141?' + Math.random();
        } else {
            img.removeAttribute('src');
        }
        
        if (cameraStatus.camera2) {
            img1.src = 'http://' + location.hostname + ':3142?' + Math.random();
        } else {
            img1.removeAttribute('src');
        }
        
        resize();
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

