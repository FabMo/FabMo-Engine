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


function resize() {
  var width = window.innerWidth - 4;
  var height = window.innerHeight - $('#topbar').height() - 3;
  preview.size(width, height);
  viewer.resize(width, height);
}


$(function () {
  if (!util.webGLEnabled()) {
    fabmo.notify('error', 'WebGL is not enable. Impossible to preview.');
    return;
  }

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

    // Resize
    resize();
    $(window).resize(resize);

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
})
