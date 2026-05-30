/* eslint-disable no-undef */
/*
 * Canned-cut library entry point.
 *
 * Each cut is a pure function: takes parameters + current position,
 * returns G-code lines + a summary. No engine coupling, no I/O.
 * Higher layers (pendant controller, dashboard) are responsible for
 * sourcing the current position and submitting the result to the
 * engine via machine.runFile().
 */
var circularBore = require("./circularBore").circularBore;
var straightLine = require("./straightLine").straightLine;
var planer = require("./planer").planer;

module.exports = {
    circularBore: circularBore,
    straightLine: straightLine,
    planer: planer,
};
