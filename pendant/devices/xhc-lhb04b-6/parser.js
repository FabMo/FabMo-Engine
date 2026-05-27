// XHC LHB04B-6 / WHB04B-6 input report parser.
//
// The device sends 8-byte HID input reports on every event:
//   byte 0  header     constant 0x04
//   byte 1  seed       rolling byte (used as XOR key for the display protocol)
//   byte 2  button1    primary button code (0 if none)
//   byte 3  button2    second simultaneously-pressed button or modifier (0 if none)
//   byte 4  feedRotary right rotary: feedrate / step-size selector
//   byte 5  axisRotary left rotary: axis selector
//   byte 6  wheelDelta signed int8 jog-wheel delta (-128..+127)
//   byte 7  crc        checksum (we don't currently validate)
//
// Layout cross-referenced against LinuxCNC's xhc-whb04b-6 HAL component
// (src/hal/user_comps/xhc-whb04b-6/usb.h, UsbInPackage) and the
// pedropaulovc/whb04b-6 C# reverse-engineered driver. The wired LHB04B-6
// reuses the WHB04B-6 HID descriptor verbatim.

var HEADER_BYTE = 0x04;
var REPORT_LENGTH = 8;

// Pure: parse a Buffer into a normalized event object. Returns null if the
// buffer doesn't look like a valid input report (wrong length or header).
function parse(buf) {
    if (!buf || buf.length !== REPORT_LENGTH) {
        return null;
    }
    if (buf[0] !== HEADER_BYTE) {
        return null;
    }
    return {
        header: buf[0],
        seed: buf[1],
        button1: buf[2],
        button2: buf[3],
        feedRotary: buf[4],
        axisRotary: buf[5],
        wheelDelta: buf.readInt8(6),
        crc: buf[7],
    };
}

module.exports = {
    parse: parse,
    HEADER_BYTE: HEADER_BYTE,
    REPORT_LENGTH: REPORT_LENGTH,
};
