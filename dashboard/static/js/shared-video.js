// Create: /fabmo/dashboard/static/js/shared-video.js
window.FabMoVideo = (function () {
    // Shared camera detection
    function detectCamera(cameraNum) {
        return new Promise((resolve) => {
            const port = cameraNum === 1 ? 3141 : 3142;
            const testUrl = `http://${location.hostname}:${port}?${Math.random()}`;

            console.log(`Testing camera ${cameraNum} at ${testUrl}`);

            const testImg = new Image();
            const timeout = setTimeout(() => {
                console.log(`Camera ${cameraNum} detection timeout`);
                resolve(false);
            }, 2000);

            testImg.onload = () => {
                clearTimeout(timeout);
                console.log(`Camera ${cameraNum} detected successfully`);
                resolve(true);
            };

            testImg.onerror = () => {
                clearTimeout(timeout);
                console.log(`Camera ${cameraNum} failed to load`);
                resolve(false);
            };

            testImg.src = testUrl;
        });
    }

    // Shared camera status
    async function getCameraStatus() {
        const [camera1_detected, camera2_detected] = await Promise.all([detectCamera(1), detectCamera(2)]);

        const status = {
            camera1: camera1_detected,
            camera2: camera2_detected,
            count: (camera1_detected ? 1 : 0) + (camera2_detected ? 1 : 0),
        };

        // Update localStorage for all apps
        localStorage.setItem("fabmo_videos", status.count);
        localStorage.setItem("camera1", camera1_detected);
        localStorage.setItem("camera2", camera2_detected);
        localStorage.setItem("fabmo_sb4_has_video", status.count > 0 ? "true" : "false");

        return status;
    }

    return {
        detectCamera: detectCamera,
        getCameraStatus: getCameraStatus,
    };
})();
