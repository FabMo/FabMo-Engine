var machine = require("../machine").machine;
var log = require("../log").logger("api");

/**
 * @api {post} /code Execute tool runtime code
 * @apiGroup Direct
 * @apiDescription Run the POSTed code using the specified runtime.
 * @apiParam {Object} runtime Name of the runtime to run the code.  Currently suppored: `g` | `sbp`
 * @apiParam {Object} cmd The actual code to run.
 * @apiParam {Boolean} [debug] If true, run in input-simulation (debug) mode. SBP runtime only.
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var code = function (req, res, next) {
    var answer = {
        status: "success",
        data: null,
    };

    if (machine.status.state === "idle") {
        if (req.params.cmd !== undefined) {
            if (req.params.runtime !== undefined) {
                var rt = req.params.runtime.toLowerCase().trim();
                var debug = !!req.params.debug;
                switch (rt) {
                    case "opensbp":
                    case "sbp":
                        machine.sbp(req.params.cmd, { debug: debug });
                        break;

                    case "g":
                    case "nc":
                    case "gcode":
                        if (debug) {
                            log.warn("debug flag ignored for gcode runtime");
                        }
                        machine.gcode(req.params.cmd);
                        break;

                    default:
                        answer = {
                            status: "error",
                            message: "Runtime '" + rt + "' is unknown.",
                        };
                        break;
                }
            } else {
                answer = {
                    status: "error",
                    message: "No runtime specified in request.",
                };
            }
        } else {
            answer = {
                status: "error",
                message: "No code specified in request.",
            };
        }
    } else {
        answer = {
            status: "error",
            message: "Machine is not in 'idle' state.",
        };
    }
    res.json(answer);
};

/**
 * @api {post} /code/sim_input Force a simulated input value (debug mode)
 * @apiGroup Direct
 * @apiDescription While the SBP runtime is running in debug/simulation mode,
 *   set the value of a simulated input. IF INPUT(n) and other expression reads
 *   of input state will see the forced value.
 * @apiParam {Number} inp Input number (1-based, 1..12)
 * @apiParam {Boolean} state Forced input state
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
// eslint-disable-next-line no-unused-vars
var simInput = function (req, res, next) {
    var inp = parseInt(req.params.inp, 10);
    var state = !!req.params.state;
    if (!Number.isFinite(inp) || inp < 1 || inp > 12) {
        return res.json({ status: "error", message: "inp must be an integer 1..12" });
    }
    var rt = machine.sbp_runtime;
    if (!rt || !rt.simulation_mode) {
        return res.json({
            status: "error",
            message: "SBP runtime is not in simulation mode",
        });
    }
    rt.setSimulatedInput(inp, state);
    res.json({ status: "success", data: { inp: inp, state: state } });
};

module.exports = function (server) {
    server.post("/code", code);
    server.post("/code/sim_input", simInput);
};
