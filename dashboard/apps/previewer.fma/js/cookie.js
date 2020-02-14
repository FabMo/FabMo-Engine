/**
 * Get and set cookies.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict'


var prefix = 'preview-';


module.exports = {
  get: function (name, defaultValue) {
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    name = prefix + name + '=';

    for (var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == ' ') c = c.substring(1);
      if (!c.indexOf(name)) return c.substring(name.length, c.length);
    }

    return defaultValue;
  },


  set: function (name, value, days) {
    var offset = 2147483647; // Max value
    if (typeof days != 'undefined') offset = days * 24 * 60 * 60 * 1000;
    var d = new Date();
    d.setTime(d.getTime() + offset);
    var expires = 'expires=' + d.toUTCString();
    document.cookie = prefix + name + '=' + value + ';' + expires + ';path=/';
  }
}
