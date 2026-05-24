// XHC LHB04B-6 / WHB04B-6 LCD output encoder.
//
// Pure: state → array of three 8-byte HID OUT report Buffers. The caller
// device.write()s each in order; the pendant assembles them into a single
// 21-byte display frame.
//
// On-wire layout (UsbOutPackageData, packed, all little-endian):
//   off  size  field
//   0    2     header           = 0xfdfe
//   2    1     seed             — echo of input report byte 1 (rolling)
//   3    1     displayModeFlags — bits 0-1=stepMode, 6=isReset, 7=isRelative
//   4    4     row1Coordinate (X)
//   8    4     row2Coordinate (Y)
//   12   4     row3Coordinate (Z)
//   16   2     feedRate
//   18   2     spindleFeedRate
//   20   1     padding
//
// Coordinate format per row (4 bytes):
//   0-1: integerValue (uint16)
//   2:   fractionValue low 8 bits  (fraction is 0..9999, "thousandths of unit"
//        scaled by 10)
//   3:   bits 0-6 = fractionValue bits 8..14; bit 7 = sign (1 = negative)
//
// Transmission: payload is split into 3 chunks of 7 bytes; each chunk is
// prefixed with HID report ID 0x06 to form an 8-byte output report.
//
// Reference: LinuxCNC src/hal/user_comps/xhc-whb04b-6/{usb.h,usb.cc} —
// UsbOutPackageData / UsbOutPackageAxisCoordinate::setCoordinate.

var STEP_MODE = {
    CON: 0x00,      // "CON:<xx>%"
    STEP: 0x01,     // "STP:<x.xxxx>"
    MPG: 0x02,      // "MPG:<xx>%"
    PERCENT: 0x03,  // "<xx>%"
};

var HEADER = 0xfdfe;
var REPORT_ID = 0x06;
var PAYLOAD_BYTES = 21;
var BLOCKS = 3;
var BLOCK_PAYLOAD_BYTES = 7;
var REPORT_BYTES = BLOCK_PAYLOAD_BYTES + 1;

// Write one 4-byte coordinate at offset `off` inside `buf`.
function encodeCoordinate(value, buf, off) {
    var sign = value < 0 ? 1 : 0;
    var absVal = Math.abs(value);
    var scaled = Math.round(absVal * 10000);
    if (!isFinite(scaled) || scaled < 0) scaled = 0;
    var integerVal = Math.floor(scaled / 10000) & 0xffff;
    var fraction = scaled % 10000;         // 0..9999 → fits 14 bits
    buf[off] = integerVal & 0xff;
    buf[off + 1] = (integerVal >> 8) & 0xff;
    buf[off + 2] = fraction & 0xff;
    buf[off + 3] = ((fraction >> 8) & 0x7f) | (sign << 7);
}

function encodeFlags(opts) {
    var byte = (opts && opts.stepMode != null ? opts.stepMode : STEP_MODE.CON) & 0x03;
    if (opts && opts.isReset) byte |= 1 << 6;
    if (opts && opts.isRelative) byte |= 1 << 7;
    return byte & 0xff;
}

function clampU16(v) {
    if (!isFinite(v) || v < 0) return 0;
    if (v > 0xffff) return 0xffff;
    return Math.round(v);
}

// Encode the 21-byte payload (exposed for tests; production callers want
// encode() instead, which adds the report-ID framing).
function encodePayload(state) {
    state = state || {};
    var buf = Buffer.alloc(PAYLOAD_BYTES);
    buf[0] = HEADER & 0xff;
    buf[1] = (HEADER >> 8) & 0xff;
    buf[2] = (state.seed || 0) & 0xff;
    buf[3] = encodeFlags({
        stepMode: state.stepMode,
        isReset: state.isReset,
        isRelative: state.isRelative,
    });
    var coords = state.coordinates || [0, 0, 0];
    encodeCoordinate(coords[0] || 0, buf, 4);
    encodeCoordinate(coords[1] || 0, buf, 8);
    encodeCoordinate(coords[2] || 0, buf, 12);
    var feed = clampU16(state.feedRate);
    var spindle = clampU16(state.spindleSpeed);
    buf[16] = feed & 0xff;
    buf[17] = (feed >> 8) & 0xff;
    buf[18] = spindle & 0xff;
    buf[19] = (spindle >> 8) & 0xff;
    // buf[20] padding stays 0
    return buf;
}

// Encode `state` into the three 8-byte HID OUT reports the pendant expects.
function encode(state) {
    var payload = encodePayload(state);
    var reports = new Array(BLOCKS);
    for (var i = 0; i < BLOCKS; i++) {
        var report = Buffer.alloc(REPORT_BYTES);
        report[0] = REPORT_ID;
        payload.copy(report, 1, i * BLOCK_PAYLOAD_BYTES, (i + 1) * BLOCK_PAYLOAD_BYTES);
        reports[i] = report;
    }
    return reports;
}

module.exports = {
    STEP_MODE: STEP_MODE,
    HEADER: HEADER,
    REPORT_ID: REPORT_ID,
    PAYLOAD_BYTES: PAYLOAD_BYTES,
    BLOCKS: BLOCKS,
    REPORT_BYTES: REPORT_BYTES,
    encodeCoordinate: encodeCoordinate,
    encodeFlags: encodeFlags,
    encodePayload: encodePayload,
    encode: encode,
};
