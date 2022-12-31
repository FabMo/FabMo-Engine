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
  var readingMachineUnit = true;
  var iniMetric; 
  var step;

  self.update = function (bounds, metric) {
    self.bounds = bounds = typeof bounds == 'undefined' ? self.bounds : bounds;
    var defaultStep_metric = 25;                                        
    var defaultStep_in = 1;                             
    if (bounds.max.x >= 48 || bounds.max.y >= 48) {                   // ... adjust grid steps depending on size
        defaultStep_metric = 250;
        defaultStep_in = 12;
    }    
    self.step = parseFloat(cookie.get('grid-step', defaultStep_in));
    self.step_metric = parseFloat(cookie.get('grid-step-metric', defaultStep_metric));
    
    scene.remove(self.grid);
    if (readingMachineUnit) {
        readingMachineUnit = false;                                   // ... keep track of machine unit type; that initially passed
        iniMetric = metric;
     }
    var gridX = bounds.max.x - bounds.min.x; 
    var gridY = bounds.max.y - bounds.min.y;
    var locGridX = bounds.loc.x;
    var locGridY = bounds.loc.y;

    var material = new THREE.MeshPhongMaterial({
      shininess: 0,
      specular: 0,
      color: 0,
      opacity: 0.2,
      transparent: true
    });

    if (iniMetric) {
        step = self.step_metric;
        self.step_setting = $('#preview .settings [name="grid-step"]');
        util.connectSetting('grid-step', self.step_metric, self.setStep);
    } else {
        step = self.step;
        self.step_setting = $('#preview .settings [name="grid-step"]');
        util.connectSetting('grid-step', self.step, self.setStep);
    }

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
    if (iniMetric) {
        self.step_metric = step;
        cookie.set('grid-step-metric', self.step_metric);
    } else {
        self.step = step;
        cookie.set('grid-step', self.step);
    }
    self.update();
  }


  // Show
  self.show = parseInt(cookie.get('show-grid', 1));
  util.connectSetting('show-grid', self.show, self.setShow);

}
