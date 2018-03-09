/*jslint todo: true, browser: true, continue: true, white: true*/
/*global $*/

/**
 * This file is the main file for the FabMo previewer app. It controls the
 * viewer module initialization.
 */

require('jquery');
var Viewer = require("./viewer").Viewer;
var Fabmo = require('../../../static/js/libs/fabmo.js');

var fabmo = new Fabmo();
var viewer;
var FOOTBAR_HEIGHT = 0;  // Should find a way to access the element


// Start fixing issue with footbar display

/**
 * Resizes the viewer according to the running job footer height. The
 * height should be equal to zero if no job is running.
 *
 * @param {number} footerHeight The footer height.
 */
function resizeAccordingFooter(footerHeight) {
    var width = window.innerWidth;
    var height = window.innerHeight - $("#topbar").height() - footerHeight;
    
    $('#preview').size(width, height);
    viewer.resize(width, height);
}

/**
 * Resizes the viewer. Function to call when the window has been resized.
 */
function resize() {
    fabmo.requestStatus(function(err, status) {
        if(err) {
            resizeAccordingFooter(0);
            return;
        }
        if(status.state !== "running") {
            resizeAccordingFooter(0);
            return;
        }
        resizeAccordingFooter(FOOTBAR_HEIGHT);  //Should access to the element
    });
}

// End fixing issue with footbar display

// Old code to use when the issue with the footbar is fixed
/*
   function resize() {
   var width = window.innerWidth;
   var height = window.innerHeight - $("#topbar").height() - footerHeight;
   $('#preview').size(width, height);
   viewer.resize(width, height);
   }
*/

/**
 * Initializes the handler for updating the live viewer.
 * @param {number} jobId The job id.
 */
function initializeLiveViewerHandler(jobId) {
    fabmo.on("status", function(status) {
        if(status.state !== "running") {
            return;
        }
        if(status.job && status.job._id === jobId && status.line !== null) {
            viewer.updateLiveViewer(status.line);
        }
    });
}

/**
 * Initializes the viewer object.
 * @param {string} gcode The G-Code to display.
 * @param {boolean} isLive Sets if the G-Code should be displayed live.
 * @param {number} jobId The job id.
 */
function initializeViewer(gcode, isLive, jobId) {
    fabmo.getJobsInQueue(function(err, jobs) {
        if (jobs){
            if(jobs.pending[0]._id.toString() === jobId) {
                $('.run-now').show();
            }
        }
    });
    var width = window.innerWidth;
    var height = window.innerHeight - $("#topbar").height();
    $('#preview').size(width, height);
    viewer = new Viewer(
        document.getElementById("preview"),
        width,
        height,
        function(msg) { fabmo.notify('warning', msg); },
        { hideGCode : true },
        isLive
    );
    if(gcode !== "") {
        viewer.setGCode(gcode);
    }

    if(isLive) {
        initializeLiveViewerHandler(jobId);
    }

    resize();
}

$(document).ready(function() {

    $('.run-now').click(function(){
        fabmo.runNext(function(err, data) {
            if (err) {
            fabmo.notify(err);
            } else {
                fabmo.launchApp('job-manager');
            }
        });
    });

    fabmo.getAppArgs(function(err, args) {
        if(err) {
            console.log(err);
        }
        if('job' in args) {
            var url = '/job/' + args.job + '/gcode';
            $.ajax({
                url: url,
                type: 'GET',
                success: function(data){ 
                    var isLive = ('isLive' in args) ? args.isLive : false;
                    initializeViewer(data, isLive, args.job);
                },
                error: function(data) {
                   if(data && data.responseJSON) {
                       fabmo.notify('error', data.responseJSON);
                   }
                }
            });
        } else {
            initializeViewer("", false, -1);
        }
    });

    $(window).resize(function(){
        console.info('resizing');
        resize();
    });
});
