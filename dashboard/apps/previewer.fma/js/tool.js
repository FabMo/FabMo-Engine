/**
 * Tool widget.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict';


var util   = require('./util');
var cookie = require('./cookie');


module.exports = function(scene, update) {
  var self = this;


  self.setPosition = function (v) {
    self.mesh.position.set(v[0], v[1], v[2] + self.size / 2)
  }


  self.update = function (size, position) {
    var material = new THREE.MeshPhongMaterial({
      shininess: 30,
      specular: 0x888888,
      color: 0xffff00,
      opacity: 0.8,
      transparent: true
    });

    self.size = size / 8;
    var geometry = new THREE.CylinderGeometry(0, self.size / 4, self.size, 32);
    self.mesh = new THREE.Mesh(geometry, material);
    self.mesh.rotation.x = -Math.PI / 2;
    self.setPosition(position);

    scene.add(self.mesh);
    self.mesh.visible = !!self.show;
  }


  self.setShow = function(show) {
    self.show = show;
    self.mesh.visible = !!show;
    cookie.set('show-tool', show ? 1 : 0);
    update();
  }


  // Show
  self.show = parseInt(cookie.get('show-tool', 1));
  util.connectSetting('show-tool', self.show, self.setShow);
}
