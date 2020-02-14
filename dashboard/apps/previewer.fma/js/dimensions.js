/**
 * Dimensions widget.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */


'use strict';

var util   = require('./util');
var cookie = require('./cookie');


// Class to create the meshes showing the measure of the path
module.exports = function(scene, update) {
  var self = this;


  function createText(text, size, color) {
    var material =
        new THREE.MeshBasicMaterial({color: color, side: THREE.DoubleSide});

    var geometry = new THREE.TextGeometry(text, {
      font: THREE.__font__,
      weight: 'normal',
      style: 'normal',
      size: size,
      height: 0.001,
      curveSegments: 12
    });

    return new THREE.Mesh(geometry, material);
  }


  function sizeMesh(mesh, axis) {
    mesh.geometry.computeBoundingBox();
    var bb = mesh.geometry.boundingBox;
    return Math.abs(bb.max[axis] - bb.min[axis]);
  }


  function calculateFontSize(width, length, height) {
    var minSize = 0.05, maxSize = 3, coeff = 40;
    var biggest = Math.max(width, length, height);
    var size = minSize;

    size = Math.max(minSize, biggest / coeff);
    size = Math.min(maxSize, size);

    return size;
  }


  self.update = function(bounds, metric) {
    if (bounds === undefined) return;

    scene.remove(self.group);
    self.group = new THREE.Group();
    self.group.visible = !!self.show;
    scene.add(self.group);

    var color = 0x000000;
    var margin = 0.25;
    var type = metric ? 'mm' : 'in';
    var d = metric ? 25.4 : 1;
    var width = Math.abs(bounds.max.x - bounds.min.x);
    var length = Math.abs(bounds.max.y - bounds.min.y);
    var height = Math.abs(bounds.max.z - bounds.min.z);
    var fontSize = calculateFontSize(width, length, height);
    var material = new THREE.LineBasicMaterial({color: color, linewidth: 2});

    // X axis
    var y = bounds.max.y + margin;
    if (width) {
      var geometry = new THREE.Geometry();
      geometry.vertices.push(new THREE.Vector3(bounds.min.x, y, 0));
      geometry.vertices.push(new THREE.Vector3(bounds.max.x, y, 0));
      var lineWidth =  new THREE.Line(geometry, material);
      lineWidth.computeLineDistances();;
      var textW = (width * d).toFixed(2);
      var textWidth = createText(textW + ' ' + type, fontSize, color);
      textWidth.position.x = lineWidth.geometry.vertices[0].x +
        (width - sizeMesh(textWidth, 'x')) / 2;
      textWidth.position.y = lineWidth.geometry.vertices[0].y + fontSize;
      textWidth.position.z = lineWidth.geometry.vertices[0].z;
      self.group.add(lineWidth, textWidth);
    }

    // Y axis
    var x = bounds.max.x + margin;
    if (length) {
      geometry = new THREE.Geometry();
      geometry.vertices.push(new THREE.Vector3(x, bounds.min.y, 0));
      geometry.vertices.push(new THREE.Vector3(x, bounds.max.y, 0));
      var lineLength =  new THREE.Line(geometry, material);
      lineLength.computeLineDistances();;
      var textL = (length * d).toFixed(2);
      var textLength = createText(textL + ' ' + type, fontSize, color);
      textLength.rotateZ(-Math.PI / 2);
      textLength.position.x = lineLength.geometry.vertices[0].x + fontSize;
      textLength.position.y = lineLength.geometry.vertices[0].y +
        (length + sizeMesh(textLength, 'x')) / 2;
      textLength.position.z = lineLength.geometry.vertices[0].z;
      self.group.add(lineLength, textLength);
    }

    // Z axis
    if (height) {
      geometry = new THREE.Geometry();
      geometry.vertices.push(new THREE.Vector3(x, y, bounds.min.z));
      geometry.vertices.push(new THREE.Vector3(x, y, bounds.max.z));
      var lineHeight =  new THREE.Line(geometry, material);
      lineHeight.computeLineDistances();;
      var textH = (height * d).toFixed(2);
      var textHeight = createText(textH + ' ' + type, fontSize, color);
      textHeight.rotateX(Math.PI / 2);
      textHeight.position.x = lineHeight.geometry.vertices[0].x + fontSize;
      textHeight.position.y = lineHeight.geometry.vertices[0].y;
      textHeight.position.z = lineHeight.geometry.vertices[0].z +
        (height - sizeMesh(textHeight, 'y')) / 2;
      self.group.add(lineHeight, textHeight);
    }

    update();
  }


  self.setShow = function(show) {
    self.show = show;
    self.group.visible = !!show;
    cookie.set('show-dims', show ? 1 : 0);
    update();
  }

  // Show
  self.show = parseInt(cookie.get('show-dims', 1));
  util.connectSetting('show-dims', self.show, self.setShow);
}
