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
var Table         = require('./table');
var Tool          = require('./tool');
var Gui           = require('./gui');


module.exports = function(container) {
  var self = this;

  const tableBounds = {   // Manages pushing and pulling around; Desktop for example
    max: {
        x: 24,
        y: 18,
        z: 1
    },
    min: {
        x: 0,
        y: 0,
        z: 0
    },
    loc: {
        x: 0,
        y: 0,
        z: 0
    },
    offloc: {
        x: 0,
        y: 0,
        z: 0
    }
  }


  // Renders the screen
  function render() {self.renderer.render(self.scene, self.camera)}


  self.refresh = function() {
    render();
    self.controls.update();
  }


  self.setTable = function(envelope, xoff, yoff, zoff) {    // getting data for table, grid, and offset from machine 0
      tableBounds.max.x = envelope.xmax;
      tableBounds.min.x = envelope.xmin;
      tableBounds.max.y = envelope.ymax;
      tableBounds.min.y = envelope.ymin;
      tableBounds.loc.x = (tableBounds.max.x - tableBounds.min.x) / 2;
      tableBounds.loc.y = (tableBounds.max.y - tableBounds.min.y) / 2;
      tableBounds.offloc.x = tableBounds.loc.x - xoff;      // keeping it simple by offsetting table not scene
      tableBounds.offloc.y = tableBounds.loc.y - yoff;
      tableBounds.offloc.z = zoff;
  }


  // Called when the canvas or container has resized; scaling to available window.
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

    var lx = dims[0] / 2;    //2
    var ly = dims[1] / 2;
    var lz = dims[2] / 2;

//    self.light1.position.set(lx, ly, lz - 10);
    self.light2.position.set(lx, ly, lz + 10);
  }


  function pathLoaded() {
    if (self.path.errors.length)
      self.gui.showErrors(self.path.errors);

    var bounds = self.path.bounds;
    var size = util.maxDim(bounds);

    updateLights(bounds);
    self.dims.update(bounds, self.isMetric());
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


  // Get the file path that will be displayed; "bounds" comes from this work
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
      self.grid.update(tableBounds, metric);
      self.table.update(tableBounds, metric);
    }
  }

  // Setting from within file here
  self.setPathMetric = function (metric) {
    self.setMetric(metric);
  }


  // Initially set Units and Location to current machine values 
  self.setUnits = function (units, status) {             
    self.units = units;
    self.setMetric(self.isMetric());
    self.path.metric = (self.isMetric());
    if (status) {self.path.position = [status.posx, status.posy, status.posz]};
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
//  self.light1 = new THREE.PointLight(0xffffff, 1, 100);
//  self.light1.position.set(0, 0, -10);
//  self.scene.add(self.light1);

//   self.light2 = new THREE.PointLight(0xffffff, 1, 100);
//   self.light2.position.set(0, 0, 10);

  self.light2 = new THREE.DirectionalLight(0xffffff, 1);
  self.scene.add(self.light2);

  self.scene.add(new THREE.AmbientLight(0x808080));

  // Widgets
  self.dims = new Dimensions(self.scene, self.refresh);
  self.grid = new Grid(self.scene, self.refresh);
  self.table = new Table(self.scene, self.refresh);
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
  util.connectSetting('units', self.units, self.setUnits);
}
