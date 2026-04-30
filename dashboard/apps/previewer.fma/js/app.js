/**
 * FabMo previewer app.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


// THREE.js
window.THREE = require('./three');
require('./OrbitControls');
require('./XgridHelper');

var font = require('./helvetiker_regular.typeface.js');
THREE.__font__ = (new THREE.FontLoader()).parse(font);

require('jquery');

var Viewer = require('./viewer');
var util   = require('./util');
var cookie = require('./cookie');
var Fabmo  = require('../../../static/js/libs/fabmo.js');

var preview = $('#preview');
var fabmo = new Fabmo();
window.fabmo = fabmo;  // exposed so the AR module in viewer.js can persist calibration
var viewer = null;  // Module-level viewer reference
var originalFileContent = null;  // Raw SBP file content for in/out extraction

var cached_Config = null;
var cached_Status = null;

function resize() {
  var width = window.innerWidth - 4;
  var fullHeight = window.innerHeight - $('#topbar').height() - 3;
  var canvasHeight = fullHeight;
  // In AR / overhead modes the bottom bar would overlay the canvas (and
  // hide live-table content under it). Shrink the canvas so it ends at
  // the top of the bar, but pin #preview to fullHeight so the bar stays
  // anchored to the viewport bottom (it's positioned `bottom:0` inside
  // #preview, and #preview is inline-block whose natural height comes
  // from the canvas).
  if (viewer && viewer.ar && (viewer.ar.enabled || viewer.ar.overhead)) {
    var $bb = $('#preview .bottom-bar');
    if ($bb.length) canvasHeight = fullHeight - $bb.outerHeight();
    preview.css({ height: fullHeight + 'px', width: width + 'px' });
  } else {
    preview.css({ height: '', width: '' });
  }
  if (viewer) {
    viewer.resize(width, canvasHeight);
  }
}

function getMachineData(err, callback) {
    fabmo.getConfig(function (err, config) {
        cached_Config = config;
        if (!err) {
          callback();
        } else {
          fabmo.notify('error', 'Could not load machine data!');
        }
    });
}

function getStartStatus(err, callback) {
    fabmo.requestStatus(function (err, status) {
        var startPosx = status.posx;
        cached_Status = status;             
        if (!err) {
          callback();
        } else {
          fabmo.notify('error', 'Could not load status data!');
        }
    });
}

// CLEANUP FUNCTION - Now cleans up entire viewer
function cleanupBeforeExit() {
    
    if (viewer && typeof viewer.cleanup === 'function') {
        try {
            viewer.cleanup();
            
            // Clear the preview container
            preview.empty();
            
        } catch (err) {
            console.error('Error during viewer cleanup:', err);
        }
    }
    
    // Null out the viewer reference
    viewer = null;
}

$(function () {                             
  if (!util.webGLEnabled()) {
    fabmo.notify('error', 'WebGL is not enabled. Impossible to preview.');
    return;
  }
  let err = null;
  getMachineData(err, nowGetStatus);       
})

function nowGetStatus() {                  
    let err = null;
    getStartStatus(err, nowPreviewJob);  
}

/**
 * Parse tool info from a VCarve/ShopBot &ToolName variable value.
 * Extracts tool type, diameter, and V-bit angle from descriptive names like:
 *   "End Mill (1/4")"        -> flat, 0.25"
 *   "Ball Nose (0.125 inch)" -> ball, 0.125"
 *   "V Bit (90 deg)"         -> vbit, angle 90
 *   "End Mill (6mm)"         -> flat, ~0.2362"
 */
function parseToolName(toolName) {
  if (typeof toolName !== 'string') return null;

  var result = {};
  var name = toolName.trim();
  // Strip surrounding quotes from variable-style values like &ToolName = "..."
  // but preserve " as inch mark in unquoted comment-style values like End Mill (3/8")
  if (name.charAt(0) === '"') {
    name = name.substring(1).replace(/"$/, '');
  }

  // Tool type keywords
  if (/v[\s\-]?bit|vee[\s\-]?bit/i.test(name)) {
    result.toolType = 'vbit';
  } else if (/ball[\s\-]?(nose|end)/i.test(name)) {
    result.toolType = 'ball';
  } else if (/end[\s\-]?mill|flat|straight|router/i.test(name)) {
    result.toolType = 'flat';
  }

  // V-bit angle: "90 deg", "60 degrees", "90°"
  var angleMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:deg(?:rees?)?|°)/i);
  if (angleMatch) {
    result.vbitAngle = parseFloat(angleMatch[1]);
  }

  // Diameter — try patterns in order of specificity

  // Fraction + inch unit: 1/4", 1/8 in, 3/8 inch
  var fracInch = name.match(/(\d+)\s*\/\s*(\d+)\s*(?:"|(?:inch(?:es)?|in)\b)/i);
  if (fracInch) {
    result.toolDiameter = parseInt(fracInch[1]) / parseInt(fracInch[2]);
  }

  // Decimal + inch unit: 0.25", 0.250 in, 0.5 inch
  if (!result.toolDiameter) {
    var decInch = name.match(/(\d+\.?\d*)\s*(?:"|(?:inch(?:es)?|in)\b)/i);
    if (decInch) {
      var val = parseFloat(decInch[1]);
      if (val > 0 && val < 10) {
        result.toolDiameter = val;
      }
    }
  }

  // Metric: 6mm, 3.175 mm
  if (!result.toolDiameter) {
    var mmMatch = name.match(/(\d+\.?\d*)\s*mm\b/i);
    if (mmMatch) {
      result.toolDiameter = Math.round(parseFloat(mmMatch[1]) / 25.4 * 10000) / 10000;
    }
  }

  // Bare fraction in parentheses: (1/4), (3/8) — assume inches
  if (!result.toolDiameter) {
    var bareFrac = name.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
    if (bareFrac) {
      result.toolDiameter = parseInt(bareFrac[1]) / parseInt(bareFrac[2]);
    }
  }

  // Bare decimal in parentheses: (0.250) — assume inches
  if (!result.toolDiameter) {
    var bareDec = name.match(/\(\s*(\d+\.\d+)\s*\)/);
    if (bareDec) {
      var val = parseFloat(bareDec[1]);
      if (val > 0 && val < 10) {
        result.toolDiameter = val;
      }
    }
  }

  if (result.toolType || result.toolDiameter || result.vbitAngle) {
    console.log('Parsed tool name "' + name + '":', JSON.stringify(result));
    return result;
  }
  return null;
}

/**
 * Parse VCarve/ShopBot metadata from original file header.
 * Looks for Z origin mode, material thickness, and tool info in both SBP and GCode formats.
 * Scans up to 200 lines to find the first toolpath comment block.
 */
function parseFileMetadata(content) {
  if (typeof content !== 'string') return null;

  var metadata = {};
  var lines = content.split('\n');
  var limit = Math.min(lines.length, 200);
  var toolInfoFromComment = false;

  for (var i = 0; i < limit; i++) {
    var line = lines[i].trim();

    // SBP: &PWZorigin = Material Surface (or Table Surface)
    var zOriginMatch = line.match(/&PWZorigin\s*=\s*(.*)/i);
    if (zOriginMatch) {
      metadata.zOrigin = zOriginMatch[1].trim().toLowerCase();
    }

    // SBP: &PWMaterial = 0.500
    var materialMatch = line.match(/&PWMaterial\s*=\s*([\d.]+)/i);
    if (materialMatch) {
      metadata.materialThickness = parseFloat(materialMatch[1]);
    }

    // SBP comment: 'Depth of material in Z = 0.500
    var depthMatch = line.match(/Depth of material in Z\s*=\s*([\d.]+)/i);
    if (depthMatch && !metadata.materialThickness) {
      metadata.materialThickness = parseFloat(depthMatch[1]);
    }

    // GCode comment: (Z Origin = Material Surface)
    var gcodeOriginMatch = line.match(/\(\s*Z\s*Origin\s*=\s*(.*?)\s*\)/i);
    if (gcodeOriginMatch) {
      metadata.zOrigin = gcodeOriginMatch[1].trim().toLowerCase();
    }

    // SBP comment: 'Toolpath Name = Profile 3
    var pathNameMatch = line.match(/^'\s*Toolpath\s*Name\s*=\s*(.*)/i);
    if (pathNameMatch && !metadata.toolpathName) {
      metadata.toolpathName = pathNameMatch[1].trim();
    }

    // SBP comment: 'Tool Name   = End Mill (3/8")
    // This per-path format overrides the &ToolName variable
    var toolCommentMatch = line.match(/^'\s*Tool\s*Name\s*=\s*(.*)/i);
    if (toolCommentMatch && !toolInfoFromComment) {
      var toolInfo = parseToolName(toolCommentMatch[1]);
      if (toolInfo) {
        metadata.toolInfo = toolInfo;
        toolInfoFromComment = true;
      }
    }

    // SBP variable: &ToolName = "End Mill (1/4")" (fallback if no comment-style)
    if (!toolInfoFromComment) {
      var toolNameMatch = line.match(/&ToolName\s*=\s*(.*)/i);
      if (toolNameMatch && !metadata.toolInfo) {
        var toolInfo = parseToolName(toolNameMatch[1]);
        if (toolInfo) {
          metadata.toolInfo = toolInfo;
        }
      }
    }
  }

  if (metadata.zOrigin || metadata.materialThickness || metadata.toolInfo || metadata.toolpathName) {
    console.log('Parsed file metadata:', JSON.stringify(metadata));
    return metadata;
  }
  return null;
}

/**
 * Parse all toolpath operation blocks from an SBP file.
 * Each block starts with a 'New Path comment and includes the toolpath name and tool info.
 * Returns an array of operation objects with line ranges for extraction.
 */
function parseOperations(content) {
  if (typeof content !== 'string') return [];

  var lines = content.split('\n');
  var operations = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var lineNum = i + 1; // 1-based

    if (/^'\s*New\s*Path/i.test(line)) {
      if (current) {
        current.endLine = lineNum - 1;
        operations.push(current);
      }
      current = {
        name: null,
        toolName: null,
        toolInfo: null,
        startLine: lineNum,
        endLine: null
      };
      continue;
    }

    if (current) {
      var pathMatch = line.match(/^'\s*Toolpath\s*Name\s*=\s*(.*)/i);
      if (pathMatch && !current.name) {
        current.name = pathMatch[1].trim();
      }

      var toolMatch = line.match(/^'\s*Tool\s*Name\s*=\s*(.*)/i);
      if (toolMatch && !current.toolName) {
        current.toolName = toolMatch[1].trim();
        current.toolInfo = parseToolName(current.toolName);
      }
    }
  }

  // Close last operation
  if (current) {
    current.endLine = lines.length;
    operations.push(current);
  }

  // Merge consecutive duplicates: VCarve prints path info once before the
  // toolchange and again after it. Keep the first's startLine (includes tool
  // setup / C9 / C6 / MS) and the second's endLine (includes cutting moves).
  var merged = [];
  for (var i = 0; i < operations.length; i++) {
    var next = operations[i + 1];
    if (next && operations[i].name && operations[i].name === next.name) {
      next.startLine = operations[i].startLine;
      // skip the first occurrence — the merged next will be pushed on its turn
    } else {
      merged.push(operations[i]);
    }
  }
  operations = merged;

  if (operations.length) {
    console.log('Parsed ' + operations.length + ' operations:',
      operations.map(function(op) { return op.name || '(unnamed)'; }).join(', '));
  }
  return operations;
}

/**
 * Build a combined SBP file from selected operation blocks.
 * Includes the file header (everything before the first 'New Path) plus
 * the selected operation blocks in order, with safe Z between them.
 */
function extractSelectedOperations(fileContent, operations, selectedIndices, safeZ) {
  if (!fileContent || !operations.length || !selectedIndices.length) return null;
  if (typeof safeZ === 'undefined' || safeZ === null) safeZ = 0;

  var allLines = fileContent.split('\n');
  var output = [];

  // Header: everything before first 'New Path
  var firstOpStart = operations[0].startLine;
  for (var i = 0; i < firstOpStart - 1; i++) {
    output.push(allLines[i]);
  }

  output.push("' --- Selected operations (" + selectedIndices.length + " of " + operations.length + ") ---");

  for (var s = 0; s < selectedIndices.length; s++) {
    var op = operations[selectedIndices[s]];
    if (s > 0) {
      output.push("JZ," + safeZ);
    }
    for (var i = op.startLine - 1; i < op.endLine && i < allLines.length; i++) {
      output.push(allLines[i]);
    }
  }

  output.push("' --- End of selection ---");
  output.push("JZ," + safeZ);
  output.push("C7");

  return output.join('\n');
}

/**
 * Extract a runnable SBP selection from the original file using in/out points.
 * Scans backward from the in-point to find the most recent tool setup commands:
 *   &tool = N   (tool number variable)
 *   C9           (toolchange)
 *   C6           (spindle start)
 *   MS,xy,z      (move speed)
 * Builds: preamble header lines + tool setup + selected cutting lines.
 */
function extractSBPSelection(fileContent, inLine, outLine, safeZ) {
  if (!fileContent || !inLine) return null;
  if (typeof safeZ === 'undefined' || safeZ === null) safeZ = 0;

  var allLines = fileContent.split('\n');
  if (!outLine) outLine = allLines.length;

  // Clamp to valid range (1-based line numbers)
  inLine = Math.max(1, Math.min(inLine, allLines.length));
  outLine = Math.max(inLine, Math.min(outLine, allLines.length));

  // Collect header/variable lines from the top of the file (before first motion)
  // These include comments, variable assignments (&var=), unit settings, etc.
  var headerLines = [];
  var headerEnd = 0;
  for (var i = 0; i < allLines.length && i < inLine - 1; i++) {
    var line = allLines[i].trim();
    var upper = line.toUpperCase();
    // Header lines: comments, blank lines, variable assignments, SA/IF/etc
    if (line === '' || line.charAt(0) === "'" ||
        line.match(/^&\w+\s*=/) || line.match(/^'/)) {
      headerLines.push(allLines[i]);
      headerEnd = i + 1;
    } else {
      // Stop collecting header at first non-header line
      break;
    }
  }

  // Scan backward from in-point to find tool setup commands
  var toolSetup = {
    toolVar: null,   // &tool = N
    toolChange: null, // C9
    spindleStart: null, // C6
    moveSpeed: null  // MS,xy,z
  };

  for (var i = inLine - 2; i >= 0; i--) {  // -2 because 1-based, and we want lines before in-point
    var line = allLines[i].trim();
    var upper = line.toUpperCase();

    // &tool = N (tool number assignment)
    if (!toolSetup.toolVar && line.match(/^&tool\s*=/i)) {
      toolSetup.toolVar = allLines[i];
    }

    // C9 (toolchange command)
    if (!toolSetup.toolChange && upper.match(/^C9\b/)) {
      toolSetup.toolChange = allLines[i];
    }

    // C6 (spindle start)
    if (!toolSetup.spindleStart && upper.match(/^C6\b/)) {
      toolSetup.spindleStart = allLines[i];
    }

    // MS,xy,z (move speed)
    if (!toolSetup.moveSpeed && upper.match(/^MS\s*,/)) {
      toolSetup.moveSpeed = allLines[i];
    }

    // Stop scanning once we have all commands
    if (toolSetup.toolVar && toolSetup.toolChange &&
        toolSetup.spindleStart && toolSetup.moveSpeed) {
      break;
    }
  }

  // Scan selected lines for the first XY position (for rapid jog to start)
  var startX = null, startY = null;
  for (var i = inLine - 1; i < outLine && i < allLines.length; i++) {
    var scanLine = allLines[i].trim().toUpperCase();

    // M2,x,y  M3,x,y,z  J2,x,y  J3,x,y,z
    var moveMatch = scanLine.match(/^[MJ][23]\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
    if (moveMatch) {
      startX = moveMatch[1]; startY = moveMatch[2];
      break;
    }
    // CG,dir,endX,endY,...
    var arcMatch = scanLine.match(/^CG\s*,[^,]*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)/);
    if (arcMatch) {
      startX = arcMatch[1]; startY = arcMatch[2];
      break;
    }
  }

  // Build the output file
  var output = [];

  // 1. Header lines (comments, variables from file top)
  output = output.concat(headerLines);
  output.push("' --- Previewer: In/Out selection ---");
  output.push("' In: line " + inLine + "  Out: line " + outLine);

  // 2. Tool setup preamble (in correct order)
  if (toolSetup.toolVar) output.push(toolSetup.toolVar);
  if (toolSetup.moveSpeed) output.push(toolSetup.moveSpeed);
  if (toolSetup.toolChange) output.push(toolSetup.toolChange);
  if (toolSetup.spindleStart) output.push(toolSetup.spindleStart);

  // 3. Jog to safe Z, then rapid to starting XY
  output.push("JZ," + safeZ);
  if (startX !== null && startY !== null) {
    output.push("J2," + startX + "," + startY);
  }

  output.push("' --- Begin selected cutting ---");

  // 4. Selected lines (in-point to out-point, 1-based)
  for (var i = inLine - 1; i < outLine && i < allLines.length; i++) {
    output.push(allLines[i]);
  }

  // 5. End: safe Z then spindle off
  output.push("' --- End of selection ---");
  output.push("JZ," + safeZ);
  output.push("C7");

  console.log('SBP selection: lines ' + inLine + '-' + outLine +
              ', preamble: tool=' + !!toolSetup.toolVar +
              ' C9=' + !!toolSetup.toolChange +
              ' C6=' + !!toolSetup.spindleStart +
              ' MS=' + !!toolSetup.moveSpeed +
              ', startXY=' + startX + ',' + startY);

  return output.join('\n');
}

/**
 * Heuristic SBP-vs-GCode sniff. SBP files have comma-separated commands
 * (M3,x,y,z / JZ,h / MS,…) and `&var = …` assignments; GCode files use
 * G/M codes with X/Y/Z words.
 */
function looksLikeSBP(content) {
  if (!content) return false;
  var sample = content.slice(0, 4096).split('\n');
  for (var i = 0; i < sample.length; i++) {
    var line = sample[i].trim();
    if (!line || line.charAt(0) === "'" || line.charAt(0) === '(') continue;
    if (/^&\w+\s*=/.test(line)) return true;
    if (/^[A-Z][A-Z0-9]?\s*,/i.test(line)) return true;   // M3, MS, JZ, CG, …
    if (/^N?\d*\s*[GM]\d/.test(line)) return false;       // pure GCode line
  }
  return false;
}

/**
 * Slice a GCode file to a line range and bracket it with safe Z + a rapid
 * to the first cut start. Used when the loaded job is plain GCode (no SBP
 * source to expand). Returns the joined string or null if the range is empty.
 */
function extractGCodeSelection(fileContent, inLine, outLine, safeZ) {
  if (!fileContent || !inLine) return null;
  if (typeof safeZ === 'undefined' || safeZ === null) safeZ = 0;

  var allLines = fileContent.split('\n');
  if (!outLine) outLine = allLines.length;
  inLine = Math.max(1, Math.min(inLine, allLines.length));
  outLine = Math.max(inLine, Math.min(outLine, allLines.length));

  // Carry forward modal context (units, plane, distance mode, coord system,
  // feed) seen above the selection so the trimmed job behaves the same.
  var modal = { units: null, distance: null, plane: null, coord: null, feed: null };
  for (var i = 0; i < inLine - 1 && i < allLines.length; i++) {
    var u = allLines[i].toUpperCase();
    var m;
    if ((m = u.match(/\bG(20|21)\b/)))                modal.units    = 'G' + m[1];
    if ((m = u.match(/\bG(90|91)(?!\.)\b/)))          modal.distance = 'G' + m[1];
    if ((m = u.match(/\bG(17|18|19)\b/)))             modal.plane    = 'G' + m[1];
    if ((m = u.match(/\bG(54|55|56|57|58|59)\b/)))    modal.coord    = 'G' + m[1];
    if ((m = u.match(/\bF(\d+(?:\.\d+)?)/)))          modal.feed     = 'F' + m[1];
  }

  // Find first XY in the selection so we can rapid-position before plunging.
  var startX = null, startY = null;
  for (var i = inLine - 1; i < outLine && i < allLines.length; i++) {
    var u = allLines[i].toUpperCase();
    var mx = u.match(/\bX(-?\d+(?:\.\d+)?)/);
    var my = u.match(/\bY(-?\d+(?:\.\d+)?)/);
    if (mx && my) { startX = mx[1]; startY = my[1]; break; }
  }

  var output = [];
  output.push('( --- Previewer: In/Out selection ---)');
  output.push('( In: line ' + inLine + '  Out: line ' + outLine + ')');
  if (modal.units)    output.push(modal.units);
  if (modal.distance) output.push(modal.distance);
  if (modal.plane)    output.push(modal.plane);
  if (modal.coord)    output.push(modal.coord);
  output.push('G0 Z' + safeZ);
  if (startX !== null && startY !== null) output.push('G0 X' + startX + ' Y' + startY);
  if (modal.feed) output.push(modal.feed);
  for (var i = inLine - 1; i < outLine && i < allLines.length; i++) output.push(allLines[i]);
  output.push('G0 Z' + safeZ);
  output.push('M30');
  return output.join('\n');
}

function nowPreviewJob() {
  fabmo.getAppArgs(function(err, args) {
    if (err) console.log(err);

    // Args
    var jobID = args.job || -1;
    if (jobID && jobID != -1) cookie.set('job-id', jobID);
    else jobID = cookie.get('job-id');

    // Run now button
    fabmo.getJobsInQueue(function(err, jobs) {
      if (jobs && jobs.pending.length &&
          jobs.pending[0]._id.toString() === jobID)
        $('.run-now').show();
    });

    // $('.run-now').click(function() {
    //   // CLEANUP BEFORE switching apps
    //   cleanupBeforeExit();
      
    //   fabmo.runNext(function(err, data) {
    //     if (err) fabmo.notify(err);
    //     else fabmo.launchApp('job-manager');
    //   });
    // });


  $('.run-now').click(function() {
    $('.run-now').hide();
    fabmo.runNext(function(err) {
      if (err) {
        fabmo.notify(err, 'error');
        $('.run-now').show();
      }
    });
  });

  // Build a trimmed program from the in/out selection. Returns
  // { code, isSBP, inLine, outLine } or null on failure.
  function buildTrimmedSelection() {
    var inOut = viewer ? viewer.getInOutPoints() : null;
    if (!inOut || (!inOut.inPoint && !inOut.outPoint) || !originalFileContent) {
      fabmo.notify('Set In and/or Out points first', 'error');
      return null;
    }
    var inLine = inOut.inPoint ? inOut.inPoint.sourceLine : 1;
    var outLine = inOut.outPoint ? inOut.outPoint.sourceLine : null;
    var safeZ = (cached_Config && cached_Config.opensbp) ? cached_Config.opensbp.safeZpullUp : 0;
    var isSBP = looksLikeSBP(originalFileContent);
    var code = isSBP
      ? extractSBPSelection(originalFileContent, inLine, outLine, safeZ)
      : extractGCodeSelection(originalFileContent, inLine, outLine, safeZ);
    if (!code) {
      fabmo.notify('Could not extract selection from file', 'error');
      return null;
    }
    return { code: code, isSBP: isSBP, inLine: inLine, outLine: outLine };
  }

  // Run the in/out selection in place (no job submission).
  $('.run-trimmed').click(function() {
    var sel = buildTrimmedSelection();
    if (!sel) return;
    $('.run-trimmed').prop('disabled', true);
    var done = function(err) {
      $('.run-trimmed').prop('disabled', false);
      if (err) fabmo.notify(err, 'error');
    };
    if (sel.isSBP) fabmo.runSBP(sel.code, done);
    else           fabmo.runGCode(sel.code, done);
  });

  // Submit the in/out selection as a new job (replaces current job in queue).
  $('.submit-trimmed').click(function() {
    var sel = buildTrimmedSelection();
    if (!sel) return;

    var currentJobID = cookie.get('job-id');
    if (!currentJobID || currentJobID == -1) {
      fabmo.notify('No current job to replace', 'error');
      return;
    }

    $('.submit-trimmed').css('opacity', '0.5').css('pointer-events', 'none');

    var ext = sel.isSBP ? '.sbp' : '.nc';
    var fileName = 'trimmed_L' + sel.inLine + '-L' + (sel.outLine || 'end') + ext;
    var file = new File([sel.code], fileName, { type: 'text/plain' });

    fabmo.deleteJob(currentJobID, function(err) {
      if (err) console.warn('Could not delete original job:', err);
      fabmo.submitJob(file, {}, function(err) {
        $('.submit-trimmed').css('opacity', '').css('pointer-events', '');
        if (err) {
          fabmo.notify('Failed to submit trimmed job: ' + err, 'error');
        } else {
          cleanupBeforeExit();
          fabmo.launchApp('job-manager');
        }
      });
    });
  });

  // Run Selected Operations
  $('.run-selected-ops').click(function() {
    if (!viewer || !viewer.operations || !originalFileContent) return;

    var selected = viewer.getSelectedOperationIndices();
    if (selected.length === 0) {
      fabmo.notify('No operations selected', 'error');
      return;
    }

    var safeZ = (cached_Config && cached_Config.opensbp) ? cached_Config.opensbp.safeZpullUp : 0;
    var sbpCode = extractSelectedOperations(originalFileContent, viewer.operations, selected, safeZ);

    if (sbpCode) {
      fabmo.runSBP(sbpCode, function(err) {
        if (err) fabmo.notify(err, 'error');
      });
    } else {
      fabmo.notify('Could not build selected operations', 'error');
    }
  });

  // Submit Selected Operations as new job
  $('.submit-selected-ops').click(function() {
    if (!viewer || !viewer.operations || !originalFileContent) return;

    var selected = viewer.getSelectedOperationIndices();
    if (selected.length === 0) {
      fabmo.notify('No operations selected', 'error');
      return;
    }

    var safeZ = (cached_Config && cached_Config.opensbp) ? cached_Config.opensbp.safeZpullUp : 0;
    var sbpCode = extractSelectedOperations(originalFileContent, viewer.operations, selected, safeZ);
    if (!sbpCode) {
      fabmo.notify('Could not build selected operations', 'error');
      return;
    }

    var currentJobID = cookie.get('job-id');
    if (!currentJobID || currentJobID == -1) {
      fabmo.notify('No current job to replace', 'error');
      return;
    }

    $('.submit-selected-ops').css('opacity', '0.5').css('pointer-events', 'none');

    var opNames = selected.map(function(i) { return viewer.operations[i].name || ('op' + (i+1)); });
    var fileName = 'selected_' + opNames.join('_').replace(/\s+/g, '-').substring(0, 40) + '.sbp';
    var file = new File([sbpCode], fileName, { type: 'text/plain' });

    fabmo.deleteJob(currentJobID, function(err) {
      if (err) console.warn('Could not delete original job:', err);

      fabmo.submitJob(file, {}, function(err, data) {
        $('.submit-selected-ops').css('opacity', '').css('pointer-events', '');
        if (err) {
          fabmo.notify('Failed to submit selected operations: ' + err, 'error');
        } else {
          cleanupBeforeExit();
          fabmo.launchApp('job-manager');
        }
      });
    });
  });

    // CRITICAL: Assign to module-level viewer variable
    viewer = new Viewer(preview);
    
    // IMPORTANT: Add unload handler AFTER viewer is created
    window.addEventListener('unload', function() {
        console.log('Window unloading - cleaning up viewer');
        cleanupBeforeExit();
    });

    // Setup grid and table
    viewer.setTable(cached_Config.machine.envelope, cached_Config.driver.g55x, cached_Config.driver.g55y, -1);

    // Provide envelope + active G55 offsets so the previewer can flag files
    // whose cutting extents would exceed the machine soft-limit envelope.
    viewer.setSoftLimits(
      cached_Config.machine.envelope,
      cached_Config.driver.g55x,
      cached_Config.driver.g55y,
      cached_Config.driver.g55z,
      cached_Config.machine.units
    );

    // Load point cloud if leveling is enabled
    viewer.loadPointCloud(cached_Config);

    // Hand the saved AR calibration (if any) to the viewer so the AR toggle
    // skips the calibration flow on subsequent sessions.
    if (viewer.loadARCalibration) viewer.loadARCalibration(cached_Config);

    // Resize
    var job_started = false;
    var prev_state = null;

    $(window).resize(resize);
    resize();

    // fabmo.on('status', function(status) {
    //   if (job_started)
    //     viewer.updateStatus(status.line, [status.posx, status.posy, status.posz]);
    // });


    fabmo.on('status', function(status) {
      // Also update if a job is currently running, even if we missed job_start
      // This handles the case where the user opens the previewer while a job is already running
      var isLive = job_started || status.state === 'running';
      if (isLive)
        viewer.updateStatus(status.line, [status.posx, status.posy, status.posz]);
      
      // When state leaves 'running' while the job still exists (e.g. end-of-file PAUSE),
      // immediately start animating the remaining buffered moves.
      // This fires BEFORE any modal dialog appears, so the preview stays in sync.
      if (prev_state === 'running' && status.state !== 'running' && !!status.job) {
        viewer.finishLive();
      }

      prev_state = status.state;
    });



    fabmo.on('job_start', function() {
      job_started = true;
      prev_state = null;
      viewer.jobStarted();
    });

    fabmo.on('job_end', function() {
      job_started = false;
      viewer.jobEnded()
    });

    // Load GCode
    if (jobID != -1) {
      viewer.gui.showLoading();

      // Fetch original file first to extract VCarve/ShopBot metadata
      // (Z origin mode and material thickness), then load gcode.
      // Using 'complete' ensures gcode loads even if file fetch fails.
      $.ajax({
        type: 'GET',
        url: '/job/' + jobID + '/file',
        success: function(content) {
          originalFileContent = content;
          var metadata = parseFileMetadata(content);
          if (metadata) {
            viewer.setFileMetadata(metadata);
          }
          var operations = parseOperations(content);
          // Always show the operations panel — Setup controls are useful
          // even with no parsed operations (and Run Full Job lives there).
          viewer.setOperations(operations);
        },
        error: function() {
          // File fetch failed — still surface the panel for Setup + Run Full Job
          viewer.setOperations([]);
        },
        complete: function() {
          // Load gcode after metadata is set
          $.ajax({
            type: 'GET',
            url: '/job/' + jobID + '/gcode',

            xhr: function () {
              var xhr = $.ajaxSettings.xhr();
              xhr.onprogress = function (e) {
                viewer.gui.showLoadingSize(e.loaded);
              }

              return xhr;
            },

            success: function (gcode) {
              viewer.gui.showLoadingSize(gcode.length);
              viewer.setGCode(gcode)
            },

            error: function(data) {
              if (data && data.responseJSON)
                fabmo.notify(data.responseJSON.message || data.statusText);

              else fabmo.notify(data.statusText);

              viewer.gui.hideLoading();
            }
          });
        }
      });
    }

    viewer.setUnits(cached_Config.machine.units, cached_Status);   
  });
}

////## th - experiment on FLOW back re: Sb4 and similar apps
$(document).ready(function() {

    // get previous app id and set exit back choice
    let this_App = "previewer";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    // do nothing if current (e.g. refreshes and returns)
    if (this_App != current_App) {
        back_App = current_App;
        if (back_App === null || back_App === "") {back_App = default_App};
        back_App = "job-manager"; // * > always to here for job-manager
        current_App = this_App;
        localStorage.setItem("currentapp", current_App);
        localStorage.setItem("backapp", back_App);
    } 

    // CLEANUP HANDLERS - ONLY on explicit user actions (not beforeunload)
    $(".exit-button").on("click", function(){
        console.log('Exit button clicked - cleaning up before exit');
        cleanupBeforeExit();
        // REMOVED setTimeout - cleanup is synchronous, no delay needed
        fabmo.launchApp(back_App);
    });

    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            console.log('Escape key pressed - cleaning up before exit');
            evt.preventDefault();
            cleanupBeforeExit();
            // REMOVED setTimeout - cleanup is synchronous, no delay needed
            fabmo.launchApp(back_App);
        }
    };

    // REMOVED beforeunload handler - it fires too early in single-page apps
    // The explicit exit/ESC handlers above are sufficient

    // set focus at the end of 'ready.
    $(window).trigger("focus");

})
////##
