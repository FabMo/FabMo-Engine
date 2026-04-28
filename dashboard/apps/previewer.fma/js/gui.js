/**
 * Handles buttons and dialogs.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util = require('./util');
var cookie = require('./cookie');  // ADD THIS LINE - cookie module was missing!


module.exports = function(callbacks) {
  var self = this;


  // Position element
  function place(e, x, y) {
    e.style.left = x + 'px';
    e.style.top = y + 'px';
  }


  function show(e, visible) {e.style.display = visible ? 'block' : 'none'}
  function visible(e) {return e.style.display == 'block'}
  function toggle(e) {show(e, !visible(e));}


  function get(name, callback) {
    var e = $('#preview #button-' + name)[0];
    if (e && callback) {
      e.onclick = callback;
    }
    return e;
  }


  function position() {
    var size = 32;
    var margin = 5;

    // Left-side view buttons (absolutely positioned)
    var x = margin, y = margin;
    if (self.buttons.showX) place(self.buttons.showX, x, y);
    if (self.buttons.showY) place(self.buttons.showY, x, y + size + margin);
    if (self.buttons.showZ) place(self.buttons.showZ, x, y + (size + margin) * 2);
    if (self.buttons.showOrtho) place(self.buttons.showOrtho, x, y + (size + margin) * 3);
    if (self.buttons.showPerspective) place(self.buttons.showPerspective, x, y + (size + margin) * 3);
    if (self.buttons.help) place(self.buttons.help, x + 25, y + (size + margin) * 4.2);

    // Bottom bar buttons are positioned by flexbox — no place() needed

    var helpBtn = $('#preview #button-help');
    if (helpBtn.length) helpBtn.show();
  }


  /// Called when canvas is resized
  self.resize = function(width, height) {
    self.width = width;
    self.height = height;
    position();
  }


  self.showLoading = function(msg) {
    self.loading.innerHTML = msg || 'Loading file. Please wait.';
    show(self.loading, true);
  }


  self.showLoadingSize = function(size) {
    var msg = 'Loaded ' + util.toSIBytes(size) + '.  Please wait.';
    self.showLoading(msg);
  }


  self.showLoadingProgress = function(progress) {
    var msg = 'Processing GCode.  Please wait.' +
        '<progress max="100" value="' + (100 * progress) + '"></progress>';
    self.showLoading(msg);
  }


  self.hideLoading = function() {show(self.loading, false)}


  self.showSoftLimitWarning = function (violations, units) {
    if (!self.softLimitWarning) return;
    var $list = $(self.softLimitWarning).find('.soft-limit-warning-list').empty();
    var u = units || '';
    for (var i = 0; i < violations.length; i++) {
      var v = violations[i];
      var line = v.axis.toUpperCase() + ' exceeds ' + v.direction +
                 ' by ' + v.overage.toFixed(2) + ' ' + u;
      $('<li>').text(line).appendTo($list);
    }
    show(self.softLimitWarning, true);
  }


  self.hideSoftLimitWarning = function () {
    if (self.softLimitWarning) show(self.softLimitWarning, false);
  }


  self.showErrors = function (errors) {
    var tbody = $('#preview .errors tbody').empty();

    for (var i = 0; i < errors.length; i++)
      $('<tr>')
      .append($('<td>').text(errors[i].line))
      .append($('<td>').text(errors[i].message))
      .appendTo(tbody);

    show(self.errors, true);
  }


  function onHelp()     {show(self.help, true)}
  function onClose(e)   {show($(e.target).parents('.dialog')[0], false)}
  function onSettings() {
    show(self.settings, true);
    
    // Show/hide V-bit angle based on tool type selection
    var toolType = $('[name="tool-type"]').val();
    updateVbitAngleVisibility(toolType);
  }

  function updateVbitAngleVisibility(toolType) {
    if (toolType === 'vbit') {
      $('.vbit-angle-setting').show();
    } else {
      $('.vbit-angle-setting').hide();
    }
  }

  // Buttons
  self.buttons = {};
  self.buttons.showX    = get('x', callbacks.showX);
  self.buttons.showY    = get('y', callbacks.showY);
  self.buttons.showZ    = get('z', callbacks.showZ);
  self.buttons.showOrtho  = get('ortho', callbacks.toggleView);
  self.buttons.showPerspective  = get('perspective', callbacks.toggleView);
  
  // Debug: Log button elements
  console.log('Ortho button:', self.buttons.showOrtho);
  console.log('Perspective button:', self.buttons.showPerspective);
  
  self.buttons.play     = get('play', callbacks.play);
  self.buttons.pause    = get('pause', callbacks.pause);
  self.buttons.stop     = get('stop', callbacks.stop);
  self.buttons.reset    = get('reset', callbacks.reset);
  self.buttons.stepBack = get('step-back', function() { if (callbacks.stepBackward) callbacks.stepBackward(); });
  self.buttons.stepFwd  = get('step-fwd', function() { if (callbacks.stepForward) callbacks.stepForward(); });
  self.buttons.skipBack = get('skip-back', function() { if (callbacks.skipToCutStart) callbacks.skipToCutStart(); });
  self.buttons.skipFwd  = get('skip-fwd', function() { if (callbacks.skipToCutEnd) callbacks.skipToCutEnd(); });
  self.buttons.settings = get('settings', onSettings);
  self.buttons.help     = get('help', onHelp);

  // Dialogs
  self.loading           = $('#preview .loading')[0];
  self.errors            = $('#preview .errors')[0];
  self.help              = $('#preview .help')[0];
  self.settings          = $('#preview .settings')[0];
  self.softLimitWarning  = $('#preview .soft-limit-warning')[0];
  $('#preview .dialog .close').click(onClose);

  $('.reset-material').click(function() {
    if (callbacks.resetMaterial) callbacks.resetMaterial();
  });

  // Timeline scrubber with hold-to-zoom
  self.timeline = $('#preview #timeline')[0];
  self.timelineDuration = 0;

  var zoomMode = false;
  var zoomRange = null;  // {startTime, endTime}
  var holdTimer = null;
  var HOLD_DELAY = 1500;  // ms before zoom activates
  var stripesDiv = document.getElementById('timeline-stripes');

  // Toggle zoom class on the timeline input — CSS handles the stripe visuals
  function setZoomStripes(zoomed) {
    if (!self.timeline) return;
    if (zoomed) {
      self.timeline.classList.add('zoomed');
    } else {
      self.timeline.classList.remove('zoomed');
    }
  }

  // Convert slider value to time (zoom-aware)
  function sliderToTime(value) {
    if (zoomMode && zoomRange) {
      return (value / 1000) * (zoomRange.endTime - zoomRange.startTime) + zoomRange.startTime;
    }
    return (value / 1000) * self.timelineDuration;
  }

  // Convert time to slider value (zoom-aware)
  function timeToSlider(time) {
    if (zoomMode && zoomRange) {
      return ((time - zoomRange.startTime) / (zoomRange.endTime - zoomRange.startTime)) * 1000;
    }
    return (time / self.timelineDuration) * 1000;
  }

  self.setTimelineDuration = function(duration) {
    self.timelineDuration = duration;
    if (self.timeline) {
      self.timeline.max = 1000;
      self.timeline.value = 0;
    }
    setZoomStripes(false);
  };

  self.updateTimeline = function(time) {
    if (self.timeline && self.timelineDuration > 0 && !self.timelineScrubbing) {
      self.timeline.value = timeToSlider(time);
    }
  };

  if (self.timeline) {
    self.timeline.addEventListener('input', function() {
      self.timelineScrubbing = true;
      var time = sliderToTime(parseFloat(self.timeline.value));
      if (callbacks.scrub) callbacks.scrub(time);
    });

    self.timeline.addEventListener('change', function() {
      self.timelineScrubbing = false;
    });

    // Hold-to-zoom: mousedown starts a timer
    self.timeline.addEventListener('mousedown', function() {
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function() {
        if (!callbacks.getZoomRange) return;
        var range = callbacks.getZoomRange();
        if (!range || range.endTime <= range.startTime) return;

        // Enter zoom mode
        zoomMode = true;
        zoomRange = range;

        // Remap slider to zoomed range
        var currentTime = sliderToTime(parseFloat(self.timeline.value));
        // Recalculate with new zoom range active
        self.timeline.value = Math.max(0, Math.min(1000,
          ((currentTime - zoomRange.startTime) / (zoomRange.endTime - zoomRange.startTime)) * 1000
        ));

        setZoomStripes(true);
      }, HOLD_DELAY);
    });

    // Animate slider value smoothly from current to target
    var slideAnim = null;
    function animateSliderTo(targetValue, duration) {
      if (slideAnim) cancelAnimationFrame(slideAnim);
      var startValue = parseFloat(self.timeline.value);
      var startTime = performance.now();
      duration = duration || 400;

      function step(now) {
        var t = Math.min(1, (now - startTime) / duration);
        // Ease-out cubic
        t = 1 - Math.pow(1 - t, 3);
        self.timeline.value = startValue + (targetValue - startValue) * t;
        if (t < 1) {
          slideAnim = requestAnimationFrame(step);
        } else {
          slideAnim = null;
          self.timelineScrubbing = false;
        }
      }
      self.timelineScrubbing = true;  // prevent updateTimeline from interfering
      slideAnim = requestAnimationFrame(step);
    }

    // On release: exit zoom, slide to true position
    function exitZoom() {
      clearTimeout(holdTimer);
      if (!zoomMode) return;

      // Calculate the actual time from the zoomed slider position
      var zoomedTime = sliderToTime(parseFloat(self.timeline.value));

      // Exit zoom mode
      zoomMode = false;
      zoomRange = null;

      // Animate slider to its true full-range position
      var targetValue = (zoomedTime / self.timelineDuration) * 1000;
      setZoomStripes(false);
      animateSliderTo(targetValue, 400);
    }

    self.timeline.addEventListener('mouseup', exitZoom);
    self.timeline.addEventListener('mouseleave', function() {
      clearTimeout(holdTimer);
      // Don't exit zoom on mouseleave if still dragging — only cancel the hold timer
    });
  }

  // Stripes are always visible via CSS on the track pseudo-element
  
  // --- In/Out point management ---
  self.inPoint = null;   // {time, sourceLine, moveIndex}
  self.outPoint = null;

  var inBtn = $('#preview #button-in');
  var outBtn = $('#preview #button-out');
  var clearBtn = $('#preview #button-clear-inout');
  var inoutInfo = $('#preview #inout-info');
  var rangeOverlay = $('#preview #timeline-range');

  function getCurrentTime() {
    if (!self.timeline || !self.timelineDuration) return 0;
    return (parseFloat(self.timeline.value) / 1000) * self.timelineDuration;
  }

  function updateRangeOverlay() {
    if (!self.timeline || !self.timelineDuration) return;
    var tl = $(self.timeline);
    var tlOffset = tl.position();
    var tlWidth = tl.outerWidth();

    if (self.inPoint && self.outPoint) {
      var leftPct = self.inPoint.time / self.timelineDuration;
      var rightPct = self.outPoint.time / self.timelineDuration;
      var left = tlOffset.left + leftPct * tlWidth;
      var width = (rightPct - leftPct) * tlWidth;
      rangeOverlay.css({
        display: 'block',
        left: left + 'px',
        width: Math.max(2, width) + 'px',
        top: (tlOffset.top + tl.outerHeight() / 2 - 4) + 'px'
      });
    } else {
      rangeOverlay.css('display', 'none');
    }
  }

  function updateInOutInfo() {
    var parts = [];
    if (self.inPoint) parts.push('In: ' + self.inPoint.sourceLine);
    if (self.outPoint) parts.push('Out: ' + self.outPoint.sourceLine);
    inoutInfo.text(parts.join(' | '));

    inBtn.toggleClass('active', !!self.inPoint);
    outBtn.toggleClass('active', !!self.outPoint);
    updateRangeOverlay();
  }

  self.setInPoint = function(time, sourceLine, moveIndex) {
    self.inPoint = { time: time, sourceLine: sourceLine, moveIndex: moveIndex };
    // If out-point exists and is before in-point, clear it
    if (self.outPoint && self.outPoint.time <= time) self.outPoint = null;
    updateInOutInfo();
    if (callbacks.inOutChanged) callbacks.inOutChanged(self.inPoint, self.outPoint);
  };

  self.setOutPoint = function(time, sourceLine, moveIndex) {
    self.outPoint = { time: time, sourceLine: sourceLine, moveIndex: moveIndex };
    // If in-point exists and is after out-point, clear it
    if (self.inPoint && self.inPoint.time >= time) self.inPoint = null;
    updateInOutInfo();
    if (callbacks.inOutChanged) callbacks.inOutChanged(self.inPoint, self.outPoint);
  };

  self.clearInOut = function() {
    self.inPoint = null;
    self.outPoint = null;
    updateInOutInfo();
    if (callbacks.inOutChanged) callbacks.inOutChanged(null, null);
  };

  self.getInOut = function() {
    return { inPoint: self.inPoint, outPoint: self.outPoint };
  };

  if (inBtn.length) {
    inBtn.click(function() {
      if (callbacks.setInPoint) callbacks.setInPoint();
    });
  }
  if (outBtn.length) {
    outBtn.click(function() {
      if (callbacks.setOutPoint) callbacks.setOutPoint();
    });
  }
  if (clearBtn.length) {
    clearBtn.click(function() {
      self.clearInOut();
    });
  }

  // Keyboard shortcuts: I for in, O for out
  $(document).on('keydown', function(e) {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
        e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'i' || e.key === 'I') {
      if (callbacks.setInPoint) callbacks.setInPoint();
      e.preventDefault();
    } else if (e.key === 'o' || e.key === 'O') {
      if (callbacks.setOutPoint) callbacks.setOutPoint();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      if (e.shiftKey) {
        if (callbacks.skipToCutStart) callbacks.skipToCutStart();
      } else {
        if (callbacks.stepBackward) callbacks.stepBackward();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      if (e.shiftKey) {
        if (callbacks.skipToCutEnd) callbacks.skipToCutEnd();
      } else {
        if (callbacks.stepForward) callbacks.stepForward();
      }
      e.preventDefault();
    }
  });

  // Update range overlay when window resizes
  $(window).on('resize', updateRangeOverlay);

  // Quick-toggle visual sync: toggle .active class when checkbox changes
  $('#preview .bottom-bar .quick-toggle input[type="checkbox"]').each(function() {
    var label = $(this).parent();
    // Set initial state from checkbox
    if ($(this).prop('checked')) label.addClass('active');
    else label.removeClass('active');
    // Update on change
    $(this).on('change', function() {
      if ($(this).prop('checked')) label.addClass('active');
      else label.removeClass('active');
    });
  });

  // Also sync when connectSetting initializes the checkbox (after a short delay)
  setTimeout(function() {
    $('#preview .bottom-bar .quick-toggle input[type="checkbox"]').each(function() {
      var label = $(this).parent();
      if ($(this).prop('checked')) label.addClass('active');
      else label.removeClass('active');
    });
  }, 100);

  // ENSURE resolution dropdown shows current value on open
  $('#preview .settings [name="material-resolution"]').on('focus', function() {
    var currentRes = cookie.get('material-resolution', 1000);
    $(this).val(currentRes);
  });
}
