/**
 * Handles buttons and dialogs.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util = require('./util');


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
    e.onclick = callback;
    return e;
  }


  function position() {
    var size = 32;
    var margin = 5;

    var x = margin, y = margin;
    place(self.buttons.showX, x, y);
    place(self.buttons.showY, x, y + size + margin);
    place(self.buttons.showZ, x, y + (size + margin) * 2);
    place(self.buttons.help, x + 25, y + (size + margin) * 3.2);

    place(self.buttons.settings, margin, self.height - margin - size);

    x = (self.width / 2) - size - margin / 2;
    y = self.height - margin - size;
    place(self.buttons.play, x, y);
    place(self.buttons.pause, x, y);
    place(self.buttons.reset, (self.width / 2) + margin / 2, y);
    $('#preview #button-help').show();
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


  function onHelp()     {toggle(self.help)}
  function onClose(e)   {show($(e.target).closest('.dialog')[0], false)}
  function onSettings() {toggle(self.settings)}


  // Buttons
  self.buttons = {};
  self.buttons.showX    = get('x',        callbacks.showX);
  self.buttons.showY    = get('y',        callbacks.showY);
  self.buttons.showZ    = get('z',        callbacks.showZ);
  self.buttons.help     = get('help',     onHelp);
  self.buttons.settings = get('settings', onSettings);
  self.buttons.play     = get('play',     callbacks.play);
  self.buttons.pause    = get('pause',    callbacks.pause)
  self.buttons.reset    = get('reset',    callbacks.reset);

  // Dialogs
  self.loading   = $('#preview .loading')[0];
  self.errors    = $('#preview .errors')[0];
  self.help      = $('#preview .help')[0];
  self.settings  = $('#preview .settings')[0];
  $('#preview .dialog .close').click(onClose);
}
