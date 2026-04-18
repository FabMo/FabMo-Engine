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
var viewer = null;  // Module-level viewer reference
var originalFileContent = null;  // Raw SBP file content for in/out extraction

var cached_Config = null;
var cached_Status = null;

function resize() {
  var width = window.innerWidth - 4;
  var height = window.innerHeight - $('#topbar').height() - 3;
  preview.size(width, height);
  if (viewer) {
    viewer.resize(width, height);
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
 * Parse VCarve/ShopBot metadata from original file header.
 * Looks for Z origin mode and material thickness in both SBP and GCode formats.
 */
function parseFileMetadata(content) {
  if (typeof content !== 'string') return null;

  var metadata = {};
  var lines = content.split('\n');
  var limit = Math.min(lines.length, 50); // Only scan header

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
  }

  if (metadata.zOrigin || metadata.materialThickness) {
    console.log('Parsed file metadata:', JSON.stringify(metadata));
    return metadata;
  }
  return null;
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
    // Check for in/out selection
    var inOut = viewer ? viewer.getInOutPoints() : null;
    var hasSelection = inOut && (inOut.inPoint || inOut.outPoint);

    if (hasSelection && originalFileContent) {
      // Run only the selected portion with tool setup preamble
      var inLine = inOut.inPoint ? inOut.inPoint.sourceLine : 1;
      var outLine = inOut.outPoint ? inOut.outPoint.sourceLine : null;
      var safeZ = (cached_Config && cached_Config.opensbp) ? cached_Config.opensbp.safeZpullUp : 0;
      var sbpCode = extractSBPSelection(originalFileContent, inLine, outLine, safeZ);

      if (sbpCode) {
        $('.run-now').hide();
        fabmo.runSBP(sbpCode, function(err, data) {
          if (err) {
            fabmo.notify(err, 'error');
            $('.run-now').show();
          }
        });
      } else {
        fabmo.notify('Could not extract selection from file', 'error');
      }
    } else {
      // No selection — run the full job as before
      $('.run-now').hide();
      fabmo.runNext(function(err, data) {
        if (err) {
          fabmo.notify(err, 'error');
          $('.run-now').show();
        }
      });
    }
  });

  // Submit Trimmed Job: delete current job, submit extracted SBP as new job
  $('.submit-trimmed').click(function() {
    var inOut = viewer ? viewer.getInOutPoints() : null;
    if (!inOut || (!inOut.inPoint && !inOut.outPoint) || !originalFileContent) {
      fabmo.notify('Set In and Out points first', 'error');
      return;
    }

    var inLine = inOut.inPoint ? inOut.inPoint.sourceLine : 1;
    var outLine = inOut.outPoint ? inOut.outPoint.sourceLine : null;
    var sbpCode = extractSBPSelection(originalFileContent, inLine, outLine);
    if (!sbpCode) {
      fabmo.notify('Could not extract selection from file', 'error');
      return;
    }

    var currentJobID = cookie.get('job-id');
    if (!currentJobID || currentJobID == -1) {
      fabmo.notify('No current job to replace', 'error');
      return;
    }

    $('.submit-trimmed').css('opacity', '0.5').css('pointer-events', 'none');

    // Create a File object with .sbp extension so the job system recognizes it
    var fileName = 'trimmed_L' + inLine + '-L' + (outLine || 'end') + '.sbp';
    var file = new File([sbpCode], fileName, { type: 'text/plain' });

    // Delete the current job, then submit the trimmed one
    fabmo.deleteJob(currentJobID, function(err) {
      if (err) {
        console.warn('Could not delete original job:', err);
        // Continue anyway — still submit the trimmed job
      }

      fabmo.submitJob(file, {}, function(err, data) {
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

    // CRITICAL: Assign to module-level viewer variable
    viewer = new Viewer(preview);
    
    // IMPORTANT: Add unload handler AFTER viewer is created
    window.addEventListener('unload', function() {
        console.log('Window unloading - cleaning up viewer');
        cleanupBeforeExit();
    });

    // Setup grid and table
    viewer.setTable(cached_Config.machine.envelope, cached_Config.driver.g55x, cached_Config.driver.g55y, -1);

    // Load point cloud if leveling is enabled
    viewer.loadPointCloud(cached_Config);

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
