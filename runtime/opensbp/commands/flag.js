var flags = require("../../../flags");

// Set Flag: set or clear a named machine condition flag (see flags.js).
//
//   SF, <name> [, <1|0>]
//
// With no second argument (or 1), the flag is SET. With 0, the flag is
// CLEARED — the intended use at the end of a recovery/homing routine:
//
//   SF, "DRIVER_FAULT", 0
//
// The flag must be defined in the machine config (machine.flags.<name>);
// setting or clearing an undefined flag is an error so a typo can't
// silently skip the protection. Clearing a flag bound to an input is
// refused while that input is still in its triggering state.
//
// Takes (args, callback) so the runtime treats it as stack-breaking: it
// executes only after all preceding motion has completed, so a flag is
// never cleared before the routine's moves have actually happened.
exports.SF = function (args, callback) {
    var name = args[0] === undefined || args[0] === null ? "" : String(args[0]).trim();
    if (!name) {
        return callback(new Error("SF: a flag name is required"));
    }
    var value = args[1] === undefined || args[1] === null ? 1 : Number(args[1]);
    var result = value ? flags.set(name, "file") : flags.clear(name, "file");
    if (result && result.error) {
        return callback(new Error("SF: " + result.error));
    }
    callback();
};
