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
 
 
   self.update = function (bounds, metric) {
     self.bounds = bounds = typeof bounds == 'undefined' ? self.bounds : bounds;
     self.metric = metric = typeof metric == 'undefined' ? self.metric : metric;
 
     scene.remove(self.table);
 
     var tabX = bounds.max.x - bounds.min.x; 
     var tabY = bounds.max.y - bounds.min.y;
     var locTabX = bounds.loc.x;
     var locTabY = bounds.loc.y;
     var locTabZ = bounds.loc.z;

console.log("update1- ", self.zzoff, metric, self.zzoff_metric);     
     if (self.zzoff_metric == metric) self.zzoff_setting.val(self.zzoff);
     else if (metric) self.zzoff_setting.val(self.zzoff * 25.4);
     else self.zzoff_setting.val((self.zzoff / 25.4).toFixed(3));
console.log("update2- ", self.zzoff, metric, self.zzoff_metric);     
 
     var zzoff = (self.zzoff_metric ? 25.4 : 1) / self.zzoff;
console.log("update3- ", self.zzoff, metric, self.zzoff_metric);     
 
     var material = new THREE.MeshPhongMaterial({
        shininess: 30,
        specular: 0x888888,
        color: 0xBBBBBB,
        opacity: 0.2,
        transparent: true
      });
 
     var geometry = new THREE.BoxBufferGeometry(tabX, tabY, .5);  // Use modified "gridHelper" for rectangular X & Y
     self.table = new THREE.Mesh(geometry, material);
     self.table.position.set(locTabX, locTabY, locTabZ);
//     self.scene.add(self.table)
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
     self.zzoff = zzoff <= -10 ? 1 : (zzoff || 1);
console.log("setZZ- ",self.metric,zzoff,self.zzoff);
     self.zzoff_metric = self.metric;
     cookie.set('table-zzoff', self.zzoff);
     cookie.set('table-zzoff-metric', self.metric ? 1 : 0);
     self.update();
   }
 
 
   // Show
   self.show = parseInt(cookie.get('show-table', 1));
   util.connectSetting('show-table', self.show, self.setShow);
 
 
   // Z-Zero Offset for Table
   self.zzoff = parseFloat(cookie.get('table-zzoff', 1));
console.log("at read1- ", self.zzoff, self.ssoff_metric);
   self.zzoff_metric = parseInt(cookie.get('table-zzoff-metric', 0));
   self.zzoff_setting = $('#preview .settings [name="table-zzoff"]');
   util.connectSetting('table-zzoff', self.zzoff, self.setZZoff);
console.log("at read2- ", self.zzoff, self.ssoff_metric);
 
 }
 