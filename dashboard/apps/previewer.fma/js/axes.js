/**
 * Axes Widget
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict';

var util   = require('./util');
var cookie = require('./cookie');


module.exports = function(scene, update) {
  var self = this;


  function createText(text, size, material) {
    material = new THREE.MeshBasicMaterial(
      {color: material.color, side: THREE.DoubleSide});

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


  function createArrow(size, material) {
    size /= 8;

    var group = new THREE.Group();

    var geometry = new THREE.CylinderGeometry(0, size, size * 1.75, 100);
    var cone = new THREE.Mesh(geometry, material);
    cone.position.y = size * 7.75;
    group.add(cone);

    geometry = new THREE.CylinderGeometry(size / 2, size / 2, size * 7, 100);
    var cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.y = 3.5 * size;
    group.add(cylinder);

    return group;
  }


  function createAxis(name, size, material) {
    var group = new THREE.Group();

    group.add(createArrow(size, material));

    var a = createArrow(size, material);
    a.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI);
    group.add(a);

    var text = createText(name, size / 3, material);
    text.position.y = size * 1.25;
    text.geometry.computeBoundingBox();
    var bb = text.geometry.boundingBox;
    text.position.x = -(bb.max.x - bb.min.x) / 2;
    group.add(text);

    return group;
  }


  self.update = function(size) {
    size /= 15;

    scene.remove(self.group);
    self.group = new THREE.Group();
    scene.add(self.group);
    self.group.visible = !!self.show;

    var material = {shininess: 20, specular: 0x222222};

    material.color = 0xee1111;
    var xAxis = createAxis('X', size, new THREE.MeshPhongMaterial(material));
    xAxis.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    self.group.add(xAxis);

    material.color = 0x11ee11;
    var yAxis = createAxis('Y', size, new THREE.MeshPhongMaterial(material));
    yAxis.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.PI);
    self.group.add(yAxis);

    material.color = 0x1111ee;
    var zAxis = createAxis('Z', size, new THREE.MeshPhongMaterial(material));
    zAxis.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    self.group.add(zAxis);

    update();
  }


  self.setShow = function(show) {
    self.show = show;
    self.group.visible = !!show;
    cookie.set('show-axes', show ? 1 : 0);
    update();
  }


  // Show
  self.show = parseInt(cookie.get('show-axes', 1));
  util.connectSetting('show-axes', self.show, self.setShow);
}
