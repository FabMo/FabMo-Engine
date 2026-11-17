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
