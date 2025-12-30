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
    console.log('=== CLEANUP BEFORE EXIT CALLED ===');
    
    if (viewer && typeof viewer.cleanup === 'function') {
        console.log('Executing viewer.cleanup()...');
        try {
            viewer.cleanup();
            
            // ADDED: Clear the preview container
            preview.empty();
            
            console.log('Viewer cleanup completed successfully');
        } catch (err) {
            console.error('Error during viewer cleanup:', err);
        }
    }
    
    // ADDED: Null out the viewer reference
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

    $('.run-now').click(function() {
      // CLEANUP BEFORE switching apps
      cleanupBeforeExit();
      
      fabmo.runNext(function(err, data) {
        if (err) fabmo.notify(err);
        else fabmo.launchApp('job-manager');
      });
    });

    // CRITICAL: Assign to module-level viewer variable
    viewer = new Viewer(preview);
    
    // IMPORTANT: Add unload handler AFTER viewer is created
    window.addEventListener('unload', function() {
        console.log('Window unloading - cleaning up viewer');
        cleanupBeforeExit();
    });

    console.log('Viewer initialized:', !!viewer);
    console.log('Viewer.material initialized:', !!(viewer && viewer.material));

    // Setup grid and table
    viewer.setTable(cached_Config.machine.envelope, cached_Config.driver.g55x, cached_Config.driver.g55y, -1);

    // Load point cloud if leveling is enabled
    viewer.loadPointCloud(cached_Config);

    // Resize
    var job_started = false;

    $(window).resize(resize);
    resize();

    fabmo.on('status', function(status) {
      if (job_started)
        viewer.updateStatus(status.line, [status.posx, status.posy, status.posz]);
    });

    fabmo.on('job_start', function() {
      job_started = true;
      viewer.jobStarted();
    });

    fabmo.on('job_end', function() {
      job_started = false;
      viewer.jobEnded()
    });

    // Load GCode
    if (jobID != -1) {
      viewer.gui.showLoading();

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
          console.log('=== RAW GCODE FROM SERVER (first 2000 chars) ===');
          console.log(gcode.substring(0, 2000));
          console.log('=== GCODE LINES COUNT:', gcode.split('\n').length);
          
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
