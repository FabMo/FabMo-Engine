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

    // Escape key to return to previous app
    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            fabmo.launchApp(back_App);
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
        displayNoCamera();
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
        console.log("Displaying camera 1");
    } else if (cameraStatus.camera2) {
        img1.style.display = 'none';
        img2.style.display = 'block';
        document.getElementById("cam-label").innerHTML = "camera 2";
        console.log("Displaying camera 2");
    }
    
    setupCameraToggle(img1, img2, cameraStatus.count);
}

function displayNoCamera() {
    console.log("No camera feeds available");
    document.getElementById("cam-label").innerHTML = "no camera feeds available";
}

function setupCameraToggle(img1, img2, videoCount) {
    // Only setup toggle if there are multiple cameras
    if (videoCount < 2) return;

    img1.onclick = function() {
        if (camera2_on) {
            img1.style.display = 'none';
            img2.style.display = 'block';
            document.getElementById("cam-label").innerHTML = "camera 2";
        }
    };
    
    img2.onclick = function() {
        if (camera1_on) {
            img1.style.display = 'block';
            img2.style.display = 'none';
            document.getElementById("cam-label").innerHTML = "camera 1";
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