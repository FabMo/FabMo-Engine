var machine = require("../machine").machine;
var log = require("../log").logger("routes");

/**
 * @api {post} /reconnect Reconnect to G2
 * @apiGroup State
 * @apiDescription Trigger an explicit, user-initiated reconnection to the G2
 * motion controller. Auto-reconnect on runtime disconnect has been removed;
 * the dashboard's persistent disconnect dialog calls this when the user
 * confirms recovery.
 * @apiSuccess {String} status `success` if reconnection sequence started,
 *                              `idle` if already connected
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var reconnect = function (req, res, next) {
    try {
        var driver = machine && machine.driver;
        if (!driver) {
            return res.json({
                status: "error",
                message: "Driver not initialized",
            });
        }
        if (driver.connected && !driver._disconnected) {
            return res.json({
                status: "idle",
                message: "G2 already connected",
            });
        }
        log.info("User-initiated G2 reconnect via /reconnect");
        driver.reconnect();
        res.json({ status: "success", data: null });
    } catch (e) {
        log.error("Error invoking driver.reconnect: " + e);
        res.json({ status: "error", message: String(e) });
    }
};

/**
 * @api {post} /reconnect/cancel Cancel reconnect retry loop
 * @apiGroup State
 * @apiDescription Stop the user-initiated reconnect retry loop. The disconnect
 * modal is restored so the user can choose whether to try again later.
 * @apiSuccess {String} status `success` if a loop was running and was cancelled,
 *                              `idle` if no retry loop was in progress
 */
// eslint-disable-next-line no-unused-vars
var cancelReconnect = function (req, res, next) {
    try {
        var driver = machine && machine.driver;
        if (!driver) {
            return res.json({
                status: "error",
                message: "Driver not initialized",
            });
        }
        var cancelled = driver.cancelReconnect();
        res.json({
            status: cancelled ? "success" : "idle",
            data: null,
        });
    } catch (e) {
        log.error("Error invoking driver.cancelReconnect: " + e);
        res.json({ status: "error", message: String(e) });
    }
};

module.exports = function (server) {
    server.post("/reconnect", reconnect);
    server.post("/reconnect/cancel", cancelReconnect);
};
