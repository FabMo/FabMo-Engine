/**
 * Draws a table reflecting machine coordinates, location, and offset.
 *
 * Tempated from: @author Joseph Coffland <joseph@cauldrondevelopment.com> by TH
 *
 * Adapted from code written by Alex Canales.
 */

 'use strict';


 var util   = require('./util');
 var cookie = require('./cookie');
 
 
 module.exports = function(scene, update) {
   var self = this;
   var readingMachineUnit = true;
   var d;
   var iniMetric; 

 
   self.update = function (bounds, metric) {
     self.bounds = bounds = typeof bounds == 'undefined' ? self.bounds : bounds;
     self.metric = metric = typeof metric == 'undefined' ? self.metric : metric;
 
     scene.remove(self.table);
     if (readingMachineUnit) {
        d = metric ? 25.4 : 1
        readingMachineUnit = false;                                   // ... keep track of initial unit type
        iniMetric = metric;
     }
     var tabX = (bounds.max.x - bounds.min.x);                        // Table size
     var tabY = (bounds.max.y - bounds.min.y);
     var thick = .5 * d;                                              // ... just hard code thickness
     var locTabX = bounds.offloc.x;
     var locTabY = bounds.offloc.y;
     var locTabZ = 0;  // unknowable

     var material = new THREE.MeshPhongMaterial({
        shininess: 60,
        specular: 0xDDDDDD,
        color: 0xFFFFFF,
        opacity: 0.5,
        relfectivity: .2,
        transparent: true
      });
 
     var geometry = new THREE.BoxBufferGeometry(tabX, tabY, thick);  // Use modified "gridHelper" for rectangular X & Y
     self.table = new THREE.Mesh(geometry, material);

     if (iniMetric) {
        self.zzoff_setting = $('#preview .settings [name="table-zzoff"]');
        util.connectSetting('table-zzoff', self.zzoff_metric, self.setZZoff);
        locTabZ = self.zzoff_metric + (thick/2 * -1);
    } else {
        self.zzoff_setting = $('#preview .settings [name="table-zzoff"]');
        util.connectSetting('table-zzoff', self.zzoff, self.setZZoff);
        locTabZ = self.zzoff + (thick/2 * -1);
    }

     self.table.position.set(locTabX, locTabY, locTabZ);
     self.table.visible = !!self.show;
     scene.add(self.table);
     update();
   }
 
 
   self.setShow = function(show) {
     self.show = show;
     self.table.visible = !!show;
     cookie.set('show-table', show ? 1 : 0);
     update();
   }
 
   self.setZZoff = function(zzoff) {
    if (iniMetric) {
        self.zzoff_metric = zzoff;
        cookie.set('table-zzoff-metric', self.zzoff_metric);
     } else {
        self.zzoff = zzoff;
        cookie.set('table-zzoff', self.zzoff);
     }
     self.update();
   }
 
 
   // Show
   self.show = parseInt(cookie.get('show-table', 1));
   util.connectSetting('show-table', self.show, self.setShow);
 
 
   // Z-Zero Offset for Table
   self.zzoff = parseFloat(cookie.get('table-zzoff', -1));
   self.zzoff_metric = parseFloat(cookie.get('table-zzoff-metric', -25));
   
 }
