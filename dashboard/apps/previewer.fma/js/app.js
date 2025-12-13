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
var viewer;

var cached_Config = null;
var cached_Status = null;

function resize() {
  var width = window.innerWidth - 4;
  var height = window.innerHeight - $('#topbar').height() - 3;
  preview.size(width, height);
  viewer.resize(width, height);
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
        cached_Status = status;             // Make initial status available to this app (location needed)
        if (!err) {
          callback();
        } else {
          fabmo.notify('error', 'Could not load status data!');
        }
    });
}


$(function () {                             // Preview App ENTRY POINT  <<================
  if (!util.webGLEnabled()) {
    fabmo.notify('error', 'WebGL is not enabled. Impossible to preview.');
    return;
  }
  let err = null;
  getMachineData(err, nowGetStatus);       // Need to get tool's units and dimensions before we start
})

function nowGetStatus() {                  // Need to make sure we have current status data for location
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
      fabmo.runNext(function(err, data) {
        if (err) fabmo.notify(err);
        else fabmo.launchApp('job-manager');
      });
    });

    // Viewer
    viewer = new Viewer(preview);

    // Setup grid and table
    viewer.setTable(cached_Config.machine.envelope, cached_Config.driver.g55x, cached_Config.driver.g55y, -1);

    // Load point cloud if leveling is enabled
    if (cached_Config.opensbp.transforms.level.apply === true || 
        cached_Config.opensbp.transforms.level.apply === 'true') {
      console.log('Loading point cloud from:', cached_Config.opensbp.transforms.level.ptDataFile);
      viewer.loadPointCloud(cached_Config);
    } else {
      console.log('Point cloud leveling not enabled');
    }

    // Resize
    resize();
    $(window).resize(resize);

    // Units (pass units and initial status)
    viewer.setUnits(cached_Config.machine.units, cached_Status);

    // Fabmo callbacks
    var job_started = false;
    fabmo.on('status', function(status) {
      if (status.state == 'running' && status.job && status.job._id == jobID &&
          status.line !== null) {
            var p = [status.posx, status.posy, status.posz];
            viewer.updateStatus(status.line, p);
        if (!job_started) {
          job_started = true;
          viewer.jobStarted();
        }
      }
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
          viewer.gui.showLoadingSize(gcode.length);
          viewer.setGCode(gcode)
        },

        error: function(data) {
          if (data && data.responseJSON)
            fabmo.notify('error', data.responseJSON);
        }
      });
    }
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

    $(".exit-button").on("click", function(){
        fabmo.launchApp(back_App);
    });

    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            fabmo.launchApp(back_App);
        }
    };

    // set focus at the end of 'ready.
    $(window).trigger("focus");

})
////##
