/**
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util          = require('./util');
var cookie        = require('./cookie');
var Path          = require('./path');
var Dimensions    = require('./dimensions');
var Axes          = require('./axes');
var Grid          = require('./grid');
var Tool          = require('./tool');
var Gui           = require('./gui');


module.exports = function(container) {
  var self = this;


  // Renders the screen
  function render() {self.renderer.render(self.scene, self.camera)}


  self.refresh = function() {
    render();
    self.controls.update();
  }


  /// Called when the canvas or container has resized.
  self.resize = function(width, height) {
    self.renderer.setSize(width, height);
    self.camera.aspect = width / height;
    self.camera.updateProjectionMatrix();
    self.gui.resize(width, height);
    self.refresh();
  }


  function snapPlane(plane) {
    var bounds = self.path.bounds;
    var center = util.getCenter(bounds);
    var camera = util.getCenter(bounds);
    var dims = util.getDims(bounds);
    var zoom = 0.75 * util.maxDim(bounds) / Math.tan(Math.PI / 8);

    if (plane == 'yz') camera[0] += zoom + dims[0] / 2;
    else if (plane == 'xz') camera[1] -= zoom + dims[1] / 2;
    else if (plane == 'xy') camera[2] += zoom + dims[2] / 2;
    else {
      camera[1] -= (zoom + dims[1] / 2) / 1.4;
      camera[2] += (zoom + dims[2] / 2) / 1.4;
    }

    var pos = self.controls.object.position;
    self.controls.reset();
    pos.set(camera[0], camera[1], camera[2]);
    self.controls.target.set(center[0], center[1], center[2]);
    self.refresh();
  }


  self.showX   = function () {snapPlane('yz')}
  self.showY   = function () {snapPlane('xz')}
  self.showZ   = function () {snapPlane('xy')}
  self.showISO = function () {snapPlane('iso')}


  function updateLights(bounds) {
    var dims = util.getDims(bounds);

    var lx = dims[0] / 2;
    var ly = dims[1] / 2;
    var lz = dims[2] / 2;

    self.light1.position.set(lx, ly, lz - 10);
    self.light2.position.set(lx, ly, lz + 10);
  }


  function pathLoaded() {
    if (self.path.errors.length)
      self.gui.showErrors(self.path.errors);

    var bounds = self.path.bounds;
    var size = util.maxDim(bounds);

    updateLights(bounds);
    self.dims.update(bounds, self.isMetric());
    self.grid.update(bounds, self.isMetric());
    self.axes.update(size);
    self.tool.update(size, self.path.position);
    self.showISO();
    self.gui.hideLoading();
    self.refresh();
  }


  function pathProgress(progress) {
    self.gui.showLoadingProgress(progress);
    self.refresh();
  }


  self.setGCode = function (gcode) {self.path.load(gcode, pathLoaded)}


  self.isMetric = function () {
    switch (self.units) {
    case 'mm': return true;
    case 'in': return false;
    default: return self.path.metric;
    }
  }


  self.setMetric = function (metric) {
    if (self.path && self.path.bounds) {
      self.dims.update(self.path.bounds, metric);
      self.grid.update(self.path.bounds, metric);
    }
  }


  self.setPathMetric = function (metric) {
    if (self.units == 'auto') self.setMetric(metric);
  }


  self.setUnits = function (units) {
    if (self.units == units) return;
    self.units = units;
    cookie.set('units', units);
    self.setMetric(self.isMetric());
  }


  self.updateStatus = function(line, position) {
    self.path.setMoveLinePosition(line, position);
  }


  self.jobStarted = function () {container.addClass('live')}


  self.jobEnded = function () {
    self.path.setMoveToEnd();
    container.removeClass('live')
  }


  function updatePosition (position) {
    self.tool.setPosition(position);
    self.refresh();
  }


  // Renderer
  self.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  self.renderer.domElement.style.zIndex = 1;
  container.append(self.renderer.domElement);

  self.renderer.setClearColor(0xebebeb);
  self.renderer.setPixelRatio(window.devicePixelRatio);

  self.scene = new THREE.Scene();

  // Camera
  self.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  self.camera.up.set(0, 0, 1);

  // Controls
  self.controls =
    new THREE.OrbitControls(self.camera, self.renderer.domElement);
  self.controls.damping = 0.2;
  self.controls.enableKeys = false;
  self.controls.addEventListener('change', render);

  // Lights
  self.light1 = new THREE.PointLight(0xffffff, 1, 100);
  self.light1.position.set(0, 0, -10);
  self.scene.add(self.light1);

  self.light2 = new THREE.PointLight(0xffffff, 1, 100);
  self.light2.position.set(0, 0, 10);

  self.scene.add(self.light2);

  self.scene.add(new THREE.AmbientLight(0x808080));

  // Widgets
  self.dims = new Dimensions(self.scene, self.refresh);
  self.grid = new Grid(self.scene, self.refresh);
  self.axes = new Axes(self.scene, self.refresh);
  self.tool = new Tool(self.scene, self.refresh);

  // Path
  self.path = new Path(self.scene, {
    metric: self.setPathMetric,
    progress: pathProgress,
    position: updatePosition
  });

  self.showISO();
  self.refresh();

  // Add the GUI
  var callbacks = {
    showX: self.showX,
    showY: self.showY,
    showZ: self.showZ,
    play:  function () {self.path.play()},
    pause: function () {self.path.pause()},
    reset: function () {self.path.reset()}
  }

  self.gui = new Gui(callbacks);

  // Units
  self.units = cookie.get('units', 'auto');
  util.connectSetting('units', self.units, self.setUnits);
}
