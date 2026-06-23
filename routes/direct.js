var machine = require("../machine").machine;
var config = require("../config");
var bounds = require("../runtime/bounds");
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
                try {
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
                } catch (e) {
                    // machine.sbp/gcode -> executeRuntimeCode -> arm() throws
                    // synchronously when state is busy. Surface as JSON error
                    // instead of letting it escape as an uncaught exception.
                    log.warn("/code: " + e.message);
                    answer = { status: "error", message: e.message };
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

/**
 * @api {post} /code/check_bounds Soft-limit pre-check for editor-run code
 * @apiGroup Direct
 * @apiDescription Compute work-coord extents for the given code and compare
 *   against the current machine envelope + active G55 offsets. Used by the
 *   editor so Run Code Immediately gets the same soft-limit warning as a
 *   submitted job. Does not start motion.
 * @apiParam {String} runtime "sbp" or "gcode"
 * @apiParam {String} cmd The code to analyze
 */
var checkBounds = function (req, res, next) {
    var rt = (req.params && req.params.runtime || "").toLowerCase().trim();
    var cmd = req.params && req.params.cmd;
    if (typeof cmd !== "string" || !cmd) {
        return res.json({ status: "error", message: "No code specified in request." });
    }
    if (rt !== "sbp" && rt !== "opensbp" && rt !== "g" && rt !== "nc" && rt !== "gcode") {
        return res.json({ status: "error", message: "Runtime '" + rt + "' is unknown." });
    }
    var rtNorm = (rt === "sbp" || rt === "opensbp") ? "sbp" : "gcode";

    bounds.computeStringBounds(cmd, rtNorm, function (err, result) {
        if (err) {
            log.warn("/code/check_bounds: " + err.message);
            return res.json({ status: "error", message: err.message });
        }
        var envelope = config.machine.get("envelope");
        var g55 = {
            x: config.driver.get("g55x"),
            y: config.driver.get("g55y"),
            z: config.driver.get("g55z"),
        };
        var check = bounds.checkAgainstEnvelope(result.bounds, envelope, g55);
        res.json({
            status: "success",
            data: {
                runtime: rtNorm,
                bounds: result.bounds,
                exceeds: check.exceeds,
                violations: check.violations,
                durationMs: result.durationMs,
                partial: !!result.partial,
            },
        });
    });
};

/**
 * @api {post} /eval Evaluate a single OpenSBP expression
 * @apiGroup Direct
 * @apiDescription Evaluate an OpenSBP expression and return the resulting value.
 *   Supports the same math (SIN, COS, SQRT, ROUND, MIN, MAX, MOD, PI, ...),
 *   variables ($persistent, &temp, %(N), %config.path), and operators that
 *   work in user code. Powers the dashboard's calculator app.
 * @apiParam {String} expr The expression text (e.g. "SQRT(POW(3,2)+POW(4,2))")
 */
var evalExpr = function (req, res, next) {
    var expr = req.params && req.params.expr;
    if (typeof expr !== "string" || !expr.trim()) {
        return res.json({ status: "fail", message: "Missing 'expr'" });
    }
    expr = expr.trim();

    var parser = require("../runtime/opensbp/sbp_parser");
    var SBPRuntime = require("../runtime/opensbp").SBPRuntime;

    var ast;
    try {
        ast = parser.parse("&__eval__=" + expr);
    } catch (e) {
        return res.json({ status: "fail", message: "Parse error: " + e.message });
    }
    var node = ast && ast.expr;
    if (node === undefined || node === null) {
        return res.json({ status: "fail", message: "Empty expression" });
    }

    var stub = Object.create(SBPRuntime.prototype);
    stub.driver = machine.driver;
    stub.machine = machine;
    stub.pc = 0;
    stub.simulation_mode = false;
    stub.simulated_inputs = {};

    var value;
    try {
        value = stub._eval(node);
    } catch (e) {
        return res.json({ status: "fail", message: e.message });
    }
    res.json({ status: "success", data: { expr: expr, value: value } });
};

module.exports = function (server) {
    server.post("/code", code);
    server.post("/code/sim_input", simInput);
    server.post("/code/check_bounds", checkBounds);
    server.post("/eval", evalExpr);
};
