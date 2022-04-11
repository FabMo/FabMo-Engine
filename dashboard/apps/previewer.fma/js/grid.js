/**
 * Draws a grid.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util   = require('./util');
var cookie = require('./cookie');


module.exports = function(scene, update) {
  var self = this;


  self.update = function (bounds, metric) {
//    var d = metric ? 25.4 : 1
    self.bounds = bounds = typeof bounds == 'undefined' ? self.bounds : bounds;
//    self.metric = metric = typeof metric == 'undefined' ? self.metric : metric;

    scene.remove(self.grid);

    var gridX = bounds.max.x - bounds.min.x; 
    var gridY = bounds.max.y - bounds.min.y;
    var locGridX = bounds.loc.x;
    var locGridY = bounds.loc.y;
    var step = self.step;

    var material = new THREE.MeshPhongMaterial({
      shininess: 0,
      specular: 0,
      color: 0,
      opacity: 0.2,
      transparent: true
    });

    self.grid = new THREE.XgridHelper(gridX,step,gridY,step);  // Use modified "gridHelper" for rectangular X & Y
    //self.grid = new THREE.GridHelper(size, divs);
    self.grid.material = material;
    self.grid.position.set((locGridX), (locGridY), 0.0);
    self.grid.rotation.x = Math.PI / 2;
    self.grid.visible = !!self.show;
    scene.add(self.grid);
    update();
  }


  self.setShow = function(show) {
    self.show = show;
    self.grid.visible = !!show;
    cookie.set('show-grid', show ? 1 : 0);
    update();
  }


  self.setStep = function(step) {
    self.step = step <= 0 ? 1 : (step || 1);
    self.step_metric = self.metric;
    cookie.set('grid-step', self.step);
    cookie.set('grid-step-metric', self.metric ? 1 : 0);
    self.update();
  }


  // Show
  self.show = parseInt(cookie.get('show-grid', 1));
  util.connectSetting('show-grid', self.show, self.setShow);


  // Step
  self.step = parseFloat(cookie.get('grid-step', 1));
  self.step_metric = parseInt(cookie.get('grid-step-metric', 0));
  self.step_setting = $('#preview .settings [name="grid-step"]');
  util.connectSetting('grid-step', self.step, self.setStep);

}
