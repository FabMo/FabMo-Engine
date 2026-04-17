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
  self.buttons.settings = get('settings', onSettings);
  self.buttons.help     = get('help', onHelp);

  // Dialogs
  self.loading   = $('#preview .loading')[0];
  self.errors    = $('#preview .errors')[0];
  self.help      = $('#preview .help')[0];
  self.settings  = $('#preview .settings')[0];
  $('#preview .dialog .close').click(onClose);

  $('.reset-material').click(function() {
    if (callbacks.resetMaterial) callbacks.resetMaterial();
  });

  // Style the bottom bar via JS to avoid CSS caching issues
  var bottomBar = $('#preview .bottom-bar');
  if (bottomBar.length) {
    bottomBar.css({
      position: 'absolute',
      bottom: '0',
      left: '0',
      right: '0',
      height: '42px',
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
      zIndex: 2,
      background: 'rgba(235, 235, 235, 0.85)',
      borderTop: '1px solid #ccc'
    });
    bottomBar.find('img').css({
      width: '32px',
      height: '32px',
      cursor: 'pointer',
      marginRight: '5px',
      flexShrink: 0
    });
    bottomBar.find('#timeline').css({
      flex: '1',
      minWidth: '0',
      margin: '0 8px',
      height: '8px',
      cursor: 'pointer'
    });
  }

  // Timeline scrubber
  self.timeline = $('#preview #timeline')[0];
  self.timelineDuration = 0;

  self.setTimelineDuration = function(duration) {
    self.timelineDuration = duration;
    if (self.timeline) {
      self.timeline.max = 1000;
      self.timeline.value = 0;
    }
  };

  self.updateTimeline = function(time) {
    if (self.timeline && self.timelineDuration > 0 && !self.timelineScrubbing) {
      self.timeline.value = (time / self.timelineDuration) * 1000;
    }
  };

  if (self.timeline) {
    self.timeline.addEventListener('input', function() {
      self.timelineScrubbing = true;
      var time = (parseFloat(self.timeline.value) / 1000) * self.timelineDuration;
      if (callbacks.scrub) callbacks.scrub(time);
    });
    self.timeline.addEventListener('change', function() {
      self.timelineScrubbing = false;
    });
  }
  
  // ENSURE resolution dropdown shows current value on open
  $('#preview .settings [name="material-resolution"]').on('focus', function() {
    var currentRes = cookie.get('material-resolution', 200);
    $(this).val(currentRes);
  });
}
