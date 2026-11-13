// Create: /fabmo/dashboard/static/js/shared-video.js
window.FabMoVideo = (function () {
    // Shared camera detection
    function detectCamera(cameraNum) {
        const port = cameraNum === 1 ? 3141 : 3142;
        const testUrl = `http://${location.hostname}:${port}?${Math.random()}`;

        console.log(`Testing camera ${cameraNum} at ${testUrl}`);

        // The camera serves an endless MJPEG stream, and a camera slot with
        // no device accepts the connection and never answers. Either way the
        // probe's request does not end by itself, and anything that holds a
        // request open during page load holds the document's load event
        // hostage — the dashboard's app-launch gear waits on the iframe load
        // event and would spin forever.
        //
        // Probe with fetch + AbortController: a fetch never delays the load
        // event, and abort() really closes the connection. The old probe was
        // an Image "aborted" by setting src = "" — iOS Safari keeps that
        // request in the load-blocking set, so with a camera attached the
        // Console never finished loading on an iPhone. The server sends its
        // response headers with the first frame, so "headers arrived" means
        // the same thing the image's onload did.
        if (typeof fetch === "function" && typeof AbortController === "function") {
            return new Promise((resolve) => {
                const ctrl = new AbortController();
                let done = false;
                const finish = (ok, why) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timeout);
                    try { ctrl.abort(); } catch (e) { /* already closed */ }
                    console.log(`Camera ${cameraNum} ${why}`);
                    resolve(ok);
                };
                const timeout = setTimeout(() => finish(false, "detection timeout"), 500);
                fetch(testUrl, { mode: "no-cors", cache: "no-store", signal: ctrl.signal }).then(
                    () => finish(true, "detected successfully"),
                    () => finish(false, "failed to load")
                );
            });
        }

        // Fallback for browsers without fetch/AbortController: the image
        // probe, but only once the page has finished loading so it cannot
        // block the load event.
        return new Promise((resolve) => {
            const probe = () => {
                const testImg = new Image();
                const abort = () => {
                    testImg.onload = testImg.onerror = null;
                    testImg.src = "";
                };
                const timeout = setTimeout(() => {
                    abort();
                    console.log(`Camera ${cameraNum} detection timeout`);
                    resolve(false);
                }, 500);
                testImg.onload = () => {
                    clearTimeout(timeout);
                    abort();
                    console.log(`Camera ${cameraNum} detected successfully`);
                    resolve(true);
                };
                testImg.onerror = () => {
                    clearTimeout(timeout);
                    abort();
                    console.log(`Camera ${cameraNum} failed to load`);
                    resolve(false);
                };
                testImg.src = testUrl;
            };
            if (document.readyState === "complete") {
                probe();
            } else {
                window.addEventListener("load", function onLoad() {
                    window.removeEventListener("load", onLoad);
                    probe();
                });
            }
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
