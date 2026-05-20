// usb_binder.js
//
// Detect a USB-to-RS485 adapter (for VFD/spindle control) and ensure the
// kernel's cp210x driver is bound to it, so a /dev/ttyUSB* device exists.
//
// Some adapters (notably the "Scilabs" Silicon Labs SpindleControl, VID:PID
// 10c4:83c4) use custom OEM PIDs not in the cp210x driver's built-in table.
// Writing the VID/PID to /sys/bus/usb-serial/drivers/cp210x/new_id tells the
// running driver to also claim that PID, which triggers tty creation.

const fs = require("fs");
const path = require("path");
const log = require("../log").logger("spindleBind");

const SYSFS_USB_DEVICES = "/sys/bus/usb/devices";
const CP210X_NEW_ID = "/sys/bus/usb-serial/drivers/cp210x/new_id";

// Known RS485 adapters. `driver` is the in-kernel module that should claim
// the device; `needsNewId` flags PIDs not in the driver's built-in table.
const KNOWN_ADAPTERS = [
    { vid: "10c4", pid: "83c4", name: "Scilabs (Silicon Labs SpindleControl)", driver: "cp210x", needsNewId: true },
    { vid: "1a86", pid: "55d3", name: "Waveshare USB-to-RS485",                driver: "ch341",  needsNewId: false },
    { vid: "0403", pid: "6001", name: "Sparkfun USB-to-RS485 (FTDI)",          driver: "ftdi_sio", needsNewId: false },
];

function readSysAttr(devPath, attr) {
    try {
        return fs.readFileSync(path.join(devPath, attr), "utf8").trim();
    } catch (e) {
        return null;
    }
}

// Walk /sys/bus/usb/devices/* and return the first entry matching any known
// adapter. Returns { sysPath, vid, pid, info } or null.
function findAdapter() {
    let entries;
    try {
        entries = fs.readdirSync(SYSFS_USB_DEVICES);
    } catch (e) {
        log.error("Cannot read " + SYSFS_USB_DEVICES + ": " + e.message);
        return null;
    }

    for (const entry of entries) {
        const devPath = path.join(SYSFS_USB_DEVICES, entry);
        const vid = readSysAttr(devPath, "idVendor");
        const pid = readSysAttr(devPath, "idProduct");
        if (!vid || !pid) continue;

        const match = KNOWN_ADAPTERS.find(a => a.vid === vid && a.pid === pid);
        if (match) {
            return { sysPath: devPath, vid, pid, info: match };
        }
    }
    return null;
}

// Write "<vid> <pid>" to cp210x new_id. Idempotent: if the PID is already
// bound the kernel returns EBUSY/EEXIST, which we treat as success.
function bindCp210xPid(vid, pid) {
    const line = `${vid} ${pid}`;
    try {
        fs.writeFileSync(CP210X_NEW_ID, line);
        log.info(`cp210x: registered VID:PID ${line}`);
        return true;
    } catch (e) {
        // Already bound is fine
        if (e.code === "EBUSY" || e.code === "EEXIST" || /exists/i.test(e.message)) {
            log.debug(`cp210x: VID:PID ${line} already registered`);
            return true;
        }
        log.error(`cp210x: failed to register ${line}: ${e.message}`);
        return false;
    }
}

// After binding, the cp210x driver creates a tty under the device's interface
// subdirectory. e.g. /sys/bus/usb/devices/1-1.1/1-1.1:1.0/ttyUSB0
function resolveTtyForDevice(sysPath) {
    try {
        const children = fs.readdirSync(sysPath);
        for (const child of children) {
            // Interface subdirs look like "1-1.1:1.0"
            if (!child.includes(":")) continue;
            const ifacePath = path.join(sysPath, child);
            const ttyDir = path.join(ifacePath, "tty");
            if (fs.existsSync(ttyDir)) {
                const ttys = fs.readdirSync(ttyDir);
                if (ttys.length > 0) return "/dev/" + ttys[0];
            }
            // Some kernels expose ttyUSBN directly under the interface dir
            const direct = fs.readdirSync(ifacePath).find(n => /^tty(USB|ACM)\d+$/.test(n));
            if (direct) return "/dev/" + direct;
        }
    } catch (e) {
        log.debug(`resolveTtyForDevice(${sysPath}) failed: ${e.message}`);
    }
    return null;
}

// Wait up to `timeoutMs` for resolveTtyForDevice to find a path.
function waitForTty(sysPath, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            const tty = resolveTtyForDevice(sysPath);
            if (tty) return resolve(tty);
            if (Date.now() - start >= timeoutMs) return resolve(null);
            setTimeout(tick, 100);
        };
        tick();
    });
}

// Top-level: find an adapter, bind its PID if needed, return live tty path.
// Returns { adapter, ttyPath } on success, or { adapter: null } / { adapter, ttyPath: null }.
async function ensureAdapterBound() {
    const found = findAdapter();
    if (!found) {
        log.info("No known RS485 adapter detected on USB bus");
        return { adapter: null, ttyPath: null };
    }
    log.info(`Detected RS485 adapter: ${found.info.name} (${found.vid}:${found.pid})`);

    // Try the existing tty first (already bound from a previous run)
    let ttyPath = resolveTtyForDevice(found.sysPath);
    if (ttyPath) {
        log.info(`Adapter already bound at ${ttyPath}`);
        return { adapter: found, ttyPath };
    }

    if (found.info.needsNewId && found.info.driver === "cp210x") {
        if (!bindCp210xPid(found.vid, found.pid)) {
            return { adapter: found, ttyPath: null };
        }
        ttyPath = await waitForTty(found.sysPath, 2000);
        if (ttyPath) {
            log.info(`Adapter bound at ${ttyPath}`);
            return { adapter: found, ttyPath };
        }
        log.error("Adapter PID registered but no tty appeared");
        return { adapter: found, ttyPath: null };
    }

    // Built-in driver should have claimed it automatically; if not, that's
    // out of scope here (likely a kernel module not loaded, or hardware).
    log.error(`Adapter found but no tty present and driver ${found.info.driver} should auto-bind`);
    return { adapter: found, ttyPath: null };
}

module.exports = {
    KNOWN_ADAPTERS,
    findAdapter,
    bindCp210xPid,
    resolveTtyForDevice,
    waitForTty,
    ensureAdapterBound,
};
