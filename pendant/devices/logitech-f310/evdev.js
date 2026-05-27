// Linux evdev (/dev/input/event*) parser and device locator.
//
// Used by the F310 adapter (and any future evdev-based device — generic
// gamepads, foot pedals, etc.). Dependency-free: just fs reads of the binary
// event stream and sysfs lookups for vendor/product IDs.
//
// Event-stream format (struct input_event):
//
//   64-bit Linux (aarch64/x86_64):  24 bytes total
//     [0..7]   tv_sec   (long)
//     [8..15]  tv_usec  (long)
//     [16..17] type     (u16)
//     [18..19] code     (u16)
//     [20..23] value    (s32, little-endian)
//
//   32-bit Linux:  16 bytes total
//     [0..3]   tv_sec   (long)
//     [4..7]   tv_usec  (long)
//     [8..9]   type     (u16)
//     [10..11] code     (u16)
//     [12..15] value    (s32)
//
// Type/code definitions match the kernel's include/uapi/linux/input-event-codes.h.

var fs = require("fs");
var path = require("path");
var os = require("os");

var IS_64 = ["arm64", "aarch64", "x64", "ppc64", "s390x"].indexOf(os.arch()) !== -1;
var EVENT_SIZE = IS_64 ? 24 : 16;
var TYPE_OFFSET = IS_64 ? 16 : 8;

// Common evdev type codes (subset).
var EV = {
    SYN: 0x00,
    KEY: 0x01,
    ABS: 0x03,
};

// Pure: parse one input_event from a Buffer starting at offset. Returns null
// if there isn't a full event's worth of bytes available.
function parseEvent(buf, offset) {
    offset = offset || 0;
    if (!buf || buf.length - offset < EVENT_SIZE) return null;
    return {
        type: buf.readUInt16LE(offset + TYPE_OFFSET),
        code: buf.readUInt16LE(offset + TYPE_OFFSET + 2),
        value: buf.readInt32LE(offset + TYPE_OFFSET + 4),
    };
}

// Pure: yield every event in a buffer (which may contain N events back-to-back).
function parseEvents(buf) {
    var out = [];
    for (var i = 0; i + EVENT_SIZE <= buf.length; i += EVENT_SIZE) {
        out.push(parseEvent(buf, i));
    }
    return out;
}

// Look up an /dev/input/event* device's USB vendor/product IDs via sysfs.
// Returns {vendor, product} as numbers, or null if the device doesn't exist or
// the sysfs entries aren't readable.
function getDeviceIds(eventDevPath) {
    var name = path.basename(eventDevPath); // e.g. "event5"
    var idDir = "/sys/class/input/" + name + "/device/id";
    try {
        var vendor = parseInt(fs.readFileSync(path.join(idDir, "vendor"), "utf8").trim(), 16);
        var product = parseInt(fs.readFileSync(path.join(idDir, "product"), "utf8").trim(), 16);
        if (isNaN(vendor) || isNaN(product)) return null;
        return { vendor: vendor, product: product };
    } catch (e) {
        return null;
    }
}

// Scan /dev/input/event* for a device matching any of the supplied
// {vendor, product} pairs. Returns the matching path or null.
function findDevice(matchers) {
    var entries;
    try {
        entries = fs.readdirSync("/dev/input").filter(function (n) {
            return /^event\d+$/.test(n);
        });
    } catch (e) {
        return null;
    }
    for (var i = 0; i < entries.length; i++) {
        var devPath = "/dev/input/" + entries[i];
        var ids = getDeviceIds(devPath);
        if (!ids) continue;
        for (var j = 0; j < matchers.length; j++) {
            if (matchers[j].vendor === ids.vendor && matchers[j].product === ids.product) {
                return devPath;
            }
        }
    }
    return null;
}

module.exports = {
    EV: EV,
    EVENT_SIZE: EVENT_SIZE,
    parseEvent: parseEvent,
    parseEvents: parseEvents,
    getDeviceIds: getDeviceIds,
    findDevice: findDevice,
};
