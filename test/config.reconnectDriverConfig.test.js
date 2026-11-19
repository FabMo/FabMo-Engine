// Regression: when the first G2 connect at startup fails, config.driver is
// replaced with a dummy Config. A later successful reconnect then called
// init(driver, callback) on that dummy, which crashed with
// "TypeError: callback is not a function" and left the machine not_ready.

const config = require("../config");

describe("configureDriver after a failed initial connect", () => {
    test("restores the real G2Config instead of initializing the dummy", (done) => {
        const real = config.driver;
        const fakeDriver = { fake: true };

        const init = jest.spyOn(real, "init").mockImplementation((driver, cb) => cb(null));
        const sr = jest.spyOn(real, "configureStatusReports").mockImplementation((cb) => cb(null));

        // Startup with no connection: dummy takes over
        config.configureDriver(null, () => {});
        expect(config.driver).not.toBe(real);

        // Reconnect succeeds
        config.configureDriver(fakeDriver, (err, driverConfig) => {
            expect(err).toBeFalsy();
            expect(config.driver).toBe(real);
            expect(driverConfig).toBe(real);
            expect(init).toHaveBeenCalledWith(fakeDriver, expect.any(Function));
            expect(sr).toHaveBeenCalled();
            done();
        });
    });
});
