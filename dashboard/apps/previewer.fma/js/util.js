/**
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util = {
  webGLEnabled: function() {
    // From http://www.browserleaks.com/webgl#howto-detect-webgl
    if (!!window.WebGLRenderingContext) {
      var canvas = document.createElement("canvas");
      var names = ["webgl", "experimental-webgl", "moz-webgl"];
      var gl = false;

      for (var i = 0; i < names.length; i++) {
        try {
          gl = canvas.getContext(names[i]);
          if (gl && typeof gl.getParameter === "function")
            return true; // WebGL is enabled
        } catch(ignore) {}
      }

      // WebGL is supported, but disabled
    }

    return false; // WebGL not supported
  },


  toSIBytes: function (x) {
    if (100000000 <= x)    return (x / 1000000000).toFixed(1) + ' GiB';
    else if (1000000 <= x) return (x / 1000000).toFixed(1)    + ' MiB';
    else if (1000 <= x)    return (x / 1000).toFixed(1)       + ' KiB';
    return x + ' bytes';
  },


  getDims: function (bounds) {
    var axes = ['x', 'y', 'z'];
    var dims = [];

    for (var i = 0; i < 3; i++) {
      var axis = axes[i];
      dims.push(bounds.max[axis] - bounds.min[axis]);
    }

    return dims;
  },


  maxDim: function (bounds) {
    var dims = util.getDims(bounds);
    var max = 0;

    for (var i = 0; i < 3; i++)
      if (max < dims[i]) max = dims[i];

    return max;
  },


  getCenter: function (bounds) {
    if (bounds === undefined) return [0, 0, 0];

    return [
      bounds.min.x + (bounds.max.x - bounds.min.x) / 2,
      bounds.min.y + (bounds.max.y - bounds.min.y) / 2,
      bounds.min.z + (bounds.max.z - bounds.min.z) / 2
    ]
  },


  sub: function (a, b) {
    var result = [];

    for (var i = 0; i < a.length; i++)
      result.push(a[i] - b[i]);

    return result;
  },


  length: function (v) {
    var l = 0;

    for (var i = 0; i < v.length; i++)
      l += v[i] * v[i];

    return Math.sqrt(l);
  },


  distance: function (a, b) {
    var d = 0;

    for (var i = 0; i < a.length; i++)
      d += Math.pow(a[i] - b[i], 2);

    return Math.sqrt(d);
  },


  normalize: function (v) {
    var l = util.length(v);
    var n = [];

    for (var i = 0; i < v.length; i++)
      n.push(v[i] / l);

    return n;
  },


  dotProduct: function (a, b) {
    var d = 0;

    for (var i = 0; i < a.length; i++)
      d += a[i] * b[i];

    return d;
  },


  angleBetween: function (a, b) {
    return Math.acos(util.dotProduct(util.normalize(a), util.normalize(b)));
  },


  rad2deg: function (r) {return r * 180 / Math.PI},


  connectSetting: function (name, value, cb) {
    $('#preview .settings [name="' + name + '"]').each(function () {
      var e = $(this);
      var checkbox = e.attr('type') == 'checkbox';

      if (checkbox) e.prop('checked', value);
      else e.val(value);

      e.change(function () {
        var value = checkbox ? e.prop('checked') : e.val();
        if (e.attr('type') == 'number') value = parseFloat(value);
        cb(value);
      });
    })
  },


  now: function () {return new Date().getTime() / 1000},


  threeVec: function (v) {return new THREE.Vector3(v[0], v[1], v[2])}
}


module.exports = util;
