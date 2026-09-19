// Shared hotplug supervisor for pendant device adapters.
//
// USB pendants come and go mid-session — wireless receivers drop off the bus
// and re-enumerate when the handset powers on / re-pairs, and gamepads get
// unplugged — so a one-shot boot-time open goes permanently dead the first
// time that happens. supervise() wraps an adapter's single-connection
// attach() in a retry loop: attach immediately, rescan every RESCAN_MS while
// detached, and resume rescanning when the adapter reports a mid-session
// disconnect.

var log = require("../log").logger("pendant");

// How often to look for a device while detached. Enumeration is a cheap
// udev/sysfs read; 3 s keeps power-the-handset-on → jogging snappy.
var RESCAN_MS = 3000;

// opts:
//   name  — handle name reported to pendant/index.js
//   label — human-readable device name for log lines
//   attach(onDisconnect) — try one attach; returns a per-connection handle
//       ({close}) or null when the device is absent / won't open. If the
//       connection dies mid-session the adapter must tear itself down and
//       then call onDisconnect (at most once).
function supervise(opts) {
    var connection = null;
    var closed = false;
    var rescanTimer = null;

    function stopRescan() {
        if (rescanTimer) {
            clearInterval(rescanTimer);
            rescanTimer = null;
        }
    }

    function startRescan() {
        if (closed || rescanTimer) return;
        rescanTimer = setInterval(function () {
            connection = opts.attach(onDisconnect);
            if (connection) stopRescan();
        }, RESCAN_MS);
    }

    function onDisconnect() {
        connection = null;
        if (closed) return;
        log.info(opts.label + " disconnected; watching for reconnect");
        startRescan();
    }

    connection = opts.attach(onDisconnect);
    if (!connection) {
        log.info(opts.label + " not detected; watching for hotplug");
        startRescan();
    }

    return {
        name: opts.name,
        close: function () {
            closed = true;
            stopRescan();
            if (connection) {
                connection.close();
                connection = null;
            }
        },
    };
}

module.exports = {
    supervise: supervise,
    RESCAN_MS: RESCAN_MS,
};
