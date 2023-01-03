/*
 * updater.js
 *
 * Handle functions of the updater that need to be called from the engine.
 *
 * Currently, this is just the AP collapse.  All other functions are handled through the router.
 *
 */
var got = require("got");
var config = require("./config");
var log = require("./log").logger("updater");

async function postJSON(url, obj) {
    try {
        await got
            .post(url, {
                json: obj,
            })
            .json();
    } catch (err) {
        log.error(err);
    }
}

exports.APModeCollapse = function () {
    var port = config.engine.get("server_port") + 1;
    var url = "http://localhost:" + port + "/network/hotspot/state";
    postJSON(url, { enabled: true });
};
