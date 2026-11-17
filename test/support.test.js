// Remote support: deciding whether a connection came in over the support
// tunnel. Start requests, the audit log and (later) the motion confirmation
// all hang off this, so the address ranges are pinned down here.
const support = require("../support");

describe("support.isTunnelAddress", () => {
    test("Tailscale IPv4 range 100.64.0.0/10 is the tunnel", () => {
        expect(support.isTunnelAddress("100.64.0.1")).toBe(true);
        expect(support.isTunnelAddress("100.106.227.64")).toBe(true);
        expect(support.isTunnelAddress("100.127.255.254")).toBe(true);
    });

    test("IPv4-mapped and Tailscale IPv6 addresses are the tunnel", () => {
        expect(support.isTunnelAddress("::ffff:100.106.227.64")).toBe(true);
        expect(support.isTunnelAddress("fd7a:115c:a1e0::7533:e341")).toBe(true);
        expect(support.isTunnelAddress("FD7A:115C:A1E0::1")).toBe(true);
    });

    test("the shop's own network and loopback are not", () => {
        ["192.168.33.77", "10.100.64.1", "172.16.0.9", "127.0.0.1", "::1", "::ffff:192.168.1.5"].forEach((a) => {
            expect(support.isTunnelAddress(a)).toBe(false);
        });
    });

    test("addresses just outside the range are not", () => {
        expect(support.isTunnelAddress("100.63.255.255")).toBe(false);
        expect(support.isTunnelAddress("100.128.0.1")).toBe(false);
        expect(support.isTunnelAddress("fd7a:115c:a1e1::1")).toBe(false);
    });

    test("nothing, or junk, is not", () => {
        [undefined, null, "", "unknown", "100.64", "100.64.0.1.5"].forEach((a) => {
            expect(support.isTunnelAddress(a)).toBe(false);
        });
    });
});

describe("what counts as moving the machine", () => {
    test("requests that move the machine or run code", () => {
        [
            ["POST", "/code"],
            ["POST", "/code/"],
            ["POST", "//code"],
            ["POST", "/macros/3/run"],
            ["POST", "/jobs/queue/run"],
            ["POST", "/job/abc123/ghost"],
            ["POST", "/resume"],
            ["POST", "/g2/raw"],
            ["POST", "/code?x=1"],
        ].forEach(([m, u]) => expect([m, u, support.isMotionRequest(m, u)]).toEqual([m, u, true]));
    });

    test("stopping, reading and settings are never treated as motion", () => {
        [
            ["POST", "/pause"],
            ["POST", "/quit"],
            ["POST", "/kill"],
            ["POST", "/config"],
            ["POST", "/job"],
            ["POST", "/macros/3"],
            ["POST", "/code/check_bounds"],
            ["POST", "/support/stop"],
            ["GET", "/code"],
            ["GET", "/status"],
            ["DELETE", "/jobs/queue"],
        ].forEach(([m, u]) => expect([m, u, support.isMotionRequest(m, u)]).toEqual([m, u, false]));
    });

    test("websocket runtime messages: everything but the stopping ones", () => {
        expect(support.isMotionCode({ rt: "manual", data: { cmd: "start", axis: "x" } })).toBe(true);
        expect(support.isMotionCode({ rt: "manual", data: { cmd: "enter" } })).toBe(true);
        expect(support.isMotionCode({ rt: "manual", data: { cmd: "goto" } })).toBe(true);
        expect(support.isMotionCode({ rt: "manual", data: { cmd: "output" } })).toBe(true);
        expect(support.isMotionCode({ rt: "sbp", data: "MX,1" })).toBe(true);
        ["stop", "quit", "exit", "nudge_cancel"].forEach((cmd) => {
            expect(support.isMotionCode({ rt: "manual", data: { cmd } })).toBe(false);
        });
    });
});
