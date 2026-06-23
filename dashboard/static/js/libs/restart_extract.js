// Shared restart-from-line file generators. Used by:
//   - the job_manager.fma "Restart from Last Line" action in the history panel
//   - the main dashboard's pause→clear-bit→resume flow
//
// Both produce a runnable SBP or GCode file that begins at inLine of the
// original, prepended with a preamble that re-establishes the modal state
// (tool, spindle, feed, sticky Z) and jogs safely back to the resume point
// before cutting.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RestartExtract = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Extract a runnable SBP selection from the original file starting at
  // inLine. Scans backward from the in-point to find the most recent tool
  // setup commands (&tool, C9, C6, MS) plus the last known X/Y/Z position
  // (Z is sticky in SBP, so we must restore it before resuming XY-only
  // moves). Forward-scan picks up the first XY in the selection so we can
  // jog there at safe-Z before plunging.
  function extractSBPSelection(fileContent, inLine, outLine, safeZ) {
    if (!fileContent || !inLine) return null;
    if (typeof safeZ === "undefined" || safeZ === null) safeZ = 0;

    var allLines = fileContent.split("\n");
    if (!outLine) outLine = allLines.length;

    inLine = Math.max(1, Math.min(inLine, allLines.length));
    outLine = Math.max(inLine, Math.min(outLine, allLines.length));

    var headerLines = [];
    for (var i = 0; i < allLines.length && i < inLine - 1; i++) {
      var line = allLines[i].trim();
      if (line === "" || line.charAt(0) === "'" || line.match(/^&\w+\s*=/)) {
        headerLines.push(allLines[i]);
      } else {
        break;
      }
    }

    var toolSetup = { toolVar: null, toolChange: null, spindleStart: null, moveSpeed: null };
    var lastZ = null, lastX = null, lastY = null;
    for (var j = inLine - 2; j >= 0; j--) {
      var l = allLines[j].trim();
      var upper = l.toUpperCase();
      if (!toolSetup.toolVar && l.match(/^&tool\s*=/i)) toolSetup.toolVar = allLines[j];
      if (!toolSetup.toolChange && upper.match(/^C9\b/)) toolSetup.toolChange = allLines[j];
      if (!toolSetup.spindleStart && upper.match(/^C6\b/)) toolSetup.spindleStart = allLines[j];
      if (!toolSetup.moveSpeed && upper.match(/^MS\s*,/)) toolSetup.moveSpeed = allLines[j];

      var mz = upper.match(/^[MJ]Z\s*,\s*([\d.\-]+)/);
      if (mz && lastZ === null) lastZ = mz[1];
      var mx = upper.match(/^[MJ]X\s*,\s*([\d.\-]+)/);
      if (mx && lastX === null) lastX = mx[1];
      var my = upper.match(/^[MJ]Y\s*,\s*([\d.\-]+)/);
      if (my && lastY === null) lastY = my[1];
      var m2 = upper.match(/^[MJ]2\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (m2) {
        if (lastX === null) lastX = m2[1];
        if (lastY === null) lastY = m2[2];
      }
      var m3 = upper.match(/^[MJ]3\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (m3) {
        if (lastX === null) lastX = m3[1];
        if (lastY === null) lastY = m3[2];
        if (lastZ === null) lastZ = m3[3];
      }
      var mo = upper.match(/^MO\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (mo) {
        if (lastX === null) lastX = mo[1];
        if (lastY === null) lastY = mo[2];
        if (lastZ === null) lastZ = mo[3];
      }
      var cg = upper.match(/^CG\s*,[^,]*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (cg) {
        if (lastX === null) lastX = cg[1];
        if (lastY === null) lastY = cg[2];
      }

      if (toolSetup.toolVar && toolSetup.toolChange && toolSetup.spindleStart && toolSetup.moveSpeed &&
          lastX !== null && lastY !== null && lastZ !== null) break;
    }

    var startX = null, startY = null;
    for (var k = inLine - 1; k < outLine && k < allLines.length; k++) {
      var scanLine = allLines[k].trim().toUpperCase();
      var moveMatch = scanLine.match(/^[MJ][23]\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (moveMatch) { startX = moveMatch[1]; startY = moveMatch[2]; break; }
      var arcMatch = scanLine.match(/^CG\s*,[^,]*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (arcMatch) { startX = arcMatch[1]; startY = arcMatch[2]; break; }
    }
    if (startX === null && lastX !== null) startX = lastX;
    if (startY === null && lastY !== null) startY = lastY;

    var output = [];
    output = output.concat(headerLines);
    output.push("' --- Restart from line " + inLine + " ---");

    if (toolSetup.toolVar) output.push(toolSetup.toolVar);
    if (toolSetup.moveSpeed) output.push(toolSetup.moveSpeed);
    if (toolSetup.toolChange) output.push(toolSetup.toolChange);
    if (toolSetup.spindleStart) output.push(toolSetup.spindleStart);

    output.push("JZ," + safeZ);
    if (startX !== null && startY !== null) {
      output.push("J2," + startX + "," + startY);
    }
    if (lastZ !== null) {
      output.push("MZ," + lastZ);
    }

    output.push("' --- Begin cutting ---");
    for (var p = inLine - 1; p < outLine && p < allLines.length; p++) {
      output.push(allLines[p]);
    }

    output.push("' --- End ---");
    output.push("JZ," + safeZ);
    output.push("C7");

    return output.join("\n");
  }

  // Extract a runnable GCode selection from the original file starting at
  // inLine. Scans backward from the in-point for modal state (units, coord
  // mode, tool, spindle, feed) and forward from the in-point for the first
  // XY so we can jog there at safe-Z before resuming cutting.
  function extractGCodeSelection(fileContent, inLine, outLine, safeZ) {
    if (!fileContent || !inLine) return null;
    if (typeof safeZ === "undefined" || safeZ === null) safeZ = 0;

    var allLines = fileContent.split("\n");
    if (!outLine) outLine = allLines.length;
    inLine = Math.max(1, Math.min(inLine, allLines.length));
    outLine = Math.max(inLine, Math.min(outLine, allLines.length));

    var headerLines = [];
    for (var i = 0; i < allLines.length && i < inLine - 1; i++) {
      var line = allLines[i].trim();
      if (line === "" || line.charAt(0) === "(" || line.charAt(0) === ";" || line.charAt(0) === "%") {
        headerLines.push(allLines[i]);
      } else {
        break;
      }
    }

    var setup = { units: null, coordMode: null, toolChange: null, spindleOn: null, feedRate: null };
    for (var j = inLine - 2; j >= 0; j--) {
      var l = allLines[j].trim().toUpperCase();
      if (!setup.units && l.match(/G2[01]\b/)) setup.units = l.match(/G2[01]\b/)[0];
      if (!setup.coordMode && l.match(/G9[01]\b/)) setup.coordMode = l.match(/G9[01]\b/)[0];
      if (!setup.toolChange) {
        var toolMatch = l.match(/T(\d+)/);
        if (toolMatch) setup.toolChange = "T" + toolMatch[1] + " M6";
      }
      if (!setup.spindleOn) {
        var spindleMatch = l.match(/(M[34])\b/);
        var speedMatch = l.match(/S([\d.]+)/);
        if (spindleMatch) {
          setup.spindleOn = spindleMatch[1];
          if (speedMatch) setup.spindleOn = "S" + speedMatch[1] + " " + setup.spindleOn;
        }
      }
      if (!setup.feedRate) {
        var feedMatch = l.match(/F([\d.]+)/);
        if (feedMatch) setup.feedRate = "F" + feedMatch[1];
      }
      if (setup.units && setup.coordMode && setup.toolChange && setup.spindleOn && setup.feedRate) break;
    }

    if (!setup.spindleOn) {
      var sValue = null, mDir = null;
      for (var jj = inLine - 2; jj >= 0; jj--) {
        var ll = allLines[jj].trim().toUpperCase();
        if (!sValue) { var sm = ll.match(/S([\d.]+)/); if (sm) sValue = sm[1]; }
        if (!mDir) { var mm = ll.match(/(M[34])\b/); if (mm) mDir = mm[1]; }
        if (sValue && mDir) { setup.spindleOn = "S" + sValue + " " + mDir; break; }
      }
    }

    var startX = null, startY = null;
    for (var k = inLine - 1; k < outLine && k < allLines.length; k++) {
      var scanLine = allLines[k].trim().toUpperCase();
      var xMatch = scanLine.match(/X([\d.\-]+)/);
      var yMatch = scanLine.match(/Y([\d.\-]+)/);
      if (xMatch && yMatch) { startX = xMatch[1]; startY = yMatch[1]; break; }
    }

    var output = [];
    output = output.concat(headerLines);
    output.push("(--- Restart from line " + inLine + " ---)");

    if (setup.units) output.push(setup.units);
    if (setup.coordMode) output.push(setup.coordMode);
    if (setup.toolChange) output.push(setup.toolChange);
    if (setup.spindleOn) output.push(setup.spindleOn);

    output.push("G0 Z" + safeZ);
    if (startX !== null && startY !== null) {
      output.push("G0 X" + startX + " Y" + startY);
    }
    if (setup.feedRate) output.push(setup.feedRate);

    output.push("(--- Begin cutting ---)");
    for (var p = inLine - 1; p < outLine && p < allLines.length; p++) {
      output.push(allLines[p]);
    }

    output.push("(--- End ---)");
    output.push("G0 Z" + safeZ);
    output.push("M5");
    output.push("M30");

    return output.join("\n");
  }

  function looksLikeSBPName(name) {
    return /\.(sbp|sbc)$/i.test(name || "");
  }

  return {
    extractSBPSelection: extractSBPSelection,
    extractGCodeSelection: extractGCodeSelection,
    looksLikeSBPName: looksLikeSBPName
  };
});
