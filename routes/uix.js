var machine = require("../machine").machine;

/**
 * @api {post}    // Respond interactively to user inputs (U_ser I_nput intera_X_tion) during file running, etc.
 * @apiGroup uix  // *have not figured out how to make these calls work as groups
 * @apiDescription Execute the POSTed uixc request
 * @apiParam {Object} uix ITEM.  Currently suppored: `fr_override`
 * @apiParam {Object} new OVR.
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */

// eslint-disable-next-line no-unused-vars
var fr_override = function (req, res, next) {
    var answer = {
        status: "success",
        data: null,
    };
    // Adjust parameter names to match the client's payload
    if (req.body.ovr !== undefined) {
        var OVR = req.body.ovr;
        machine.frOverride(OVR);
    } else {
        answer = {
            status: "error",
            message: "No OVR specified in request.",
        };
    }
    res.json(answer);
};

module.exports = function (server) {
    server.post("/uix/fr_override", fr_override);
};
