/**
 * Tool widget.
 *
 * Two ways to draw where the tool is:
 *   - a yellow cone (the original marker), and
 *   - a simplified machine: gantry beam with end plates, a Z carriage, a
 *     spindle and a bit. A handful of boxes and cylinders, built once and
 *     only repositioned as the tool moves.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict';


var util   = require('./util');
var cookie = require('./cookie');


// Nominal part sizes in inches, for a 48" gantry. Smaller machines scale down.
var BEAM_THICK = 4;      // along the direction the gantry travels
var BEAM_HEIGHT = 6;
var BEAM_OVERHANG = 3;   // past each table edge
var BEAM_CLEARANCE = 8;  // table top to underside of the beam
var PLATE_WIDTH = 5;     // end plate, along the direction of travel; narrow
                         // enough to stay clear of the spindle in a side view
var PLATE_THICK = 1;
var PLATE_DROP = 2;      // end plate reaches this far below the table top
var CAR_WIDTH = 7;       // Z carriage, along the beam
var CAR_THICK = 1;
var SPINDLE_SIZE = 3.25;    // square body, as on an air-cooled spindle
var SPINDLE_LEN = 7.5;
var COLLET_LEN = 1;
var BIT_LEN = 2;


module.exports = function(scene, update, getTableMesh) {
  var self = this;

  self.gantryAxis = 'y';     // axis the beam spans: 'x', 'y' or 'none'
  self.bitDiameter = 0.25;   // scene units
  self.suppressMachine = false;
  self.position = [0, 0, 0];

  var model = null;          // {group, gantry, car, head, builtFor}


  function machineWanted() {
    return self.showMachine && !self.suppressMachine && !self.hidden &&
      (self.gantryAxis === 'x' || self.gantryAxis === 'y');
  }


  function disposeModel() {
    if (!model) return;
    scene.remove(model.group);
    model.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    model = null;
  }


  function mat(color, opacity) {
    return new THREE.MeshPhongMaterial({
      shininess: 30,
      specular: 0x666666,
      color: color,
      opacity: opacity,
      transparent: opacity < 1
    });
  }


  // The model is built for a beam along Y (travelling in X) with the tool at
  // the origin of each moving part; for a beam along X the whole group is
  // turned a quarter turn about Z and positions are mapped to match.
  function buildModel(table) {
    disposeModel();

    var p = table.geometry.parameters;
    var alongX = self.gantryAxis === 'x';
    var span = alongX ? p.width : p.height;      // table size along the beam
    var d = self.metric ? 25.4 : 1;
    var s = Math.min(1, Math.max(0.35, span / (48 * d))) * d;
    var tableTop = table.position.z + p.depth / 2;

    var beamBottom = tableTop + BEAM_CLEARANCE * s;
    var spindleR = SPINDLE_SIZE * s / 2;   // half the width of the square body
    // Beam sits behind the spindle (on its +travel side).
    var beamOffset = spindleR + CAR_THICK * s + BEAM_THICK * s / 2;

    var group = new THREE.Group();
    // Mid grey: a pale beam vanishes against the light background.
    var steel = mat(0x8d959c, 0.8);
    var blue = mat(0x1f3a6e, 0.75);
    var dark = mat(0x4a4a4a, 0.75);

    // Gantry: follows the tool along the travel axis only.
    var gantry = new THREE.Group();
    var beam = new THREE.Mesh(
      new THREE.BoxBufferGeometry(BEAM_THICK * s, span + 2 * BEAM_OVERHANG * s, BEAM_HEIGHT * s),
      steel);
    beam.position.set(beamOffset, 0, beamBottom + BEAM_HEIGHT * s / 2);
    gantry.add(beam);
    // Outline the beam so its shape reads from any angle.
    var beamEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(beam.geometry),
      new THREE.LineBasicMaterial({color: 0x4a5057}));
    beamEdges.position.copy(beam.position);
    gantry.add(beamEdges);

    var plateBottom = tableTop - PLATE_DROP * s;
    var plateTop = beamBottom + BEAM_HEIGHT * s;
    [-1, 1].forEach(function (side) {
      var plate = new THREE.Mesh(
        new THREE.BoxBufferGeometry(PLATE_WIDTH * s, PLATE_THICK * s, plateTop - plateBottom),
        blue);
      plate.position.set(beamOffset,
                         side * (span / 2 + BEAM_OVERHANG * s + PLATE_THICK * s / 2),
                         (plateTop + plateBottom) / 2);
      gantry.add(plate);
    });
    group.add(gantry);

    // Z carriage: rides the beam, follows the tool in X and Y but not Z.
    var car = new THREE.Mesh(
      new THREE.BoxBufferGeometry(CAR_THICK * s, CAR_WIDTH * s, (BEAM_HEIGHT + 4) * s),
      dark);
    car.position.set(spindleR + CAR_THICK * s / 2, 0, beamBottom + (BEAM_HEIGHT + 4) * s / 2 - 2 * s);
    var carGroup = new THREE.Group();
    carGroup.add(car);
    group.add(carGroup);

    // Head: spindle, collet and bit, follows the tool on all three axes.
    // Its origin is the tip of the bit.
    var head = new THREE.Group();
    var bitLen = BIT_LEN * s;
    var bitR = Math.max(self.bitDiameter / 2, 0.02 * d);
    var bit = new THREE.Mesh(new THREE.CylinderBufferGeometry(bitR, bitR, bitLen, 12), mat(0xffd000, 1));
    bit.rotation.x = Math.PI / 2;
    bit.position.z = bitLen / 2;
    head.add(bit);

    var colletLen = COLLET_LEN * s;
    var collet = new THREE.Mesh(
      new THREE.CylinderBufferGeometry(spindleR * 0.55, Math.max(bitR * 1.5, spindleR * 0.25), colletLen, 12),
      dark);
    collet.rotation.x = Math.PI / 2;
    collet.position.z = bitLen + colletLen / 2;
    head.add(collet);

    var spindleLen = SPINDLE_LEN * s;
    var spindle = new THREE.Mesh(
      new THREE.BoxBufferGeometry(2 * spindleR, 2 * spindleR, spindleLen),
      mat(0x8f969c, 0.85));
    spindle.position.z = bitLen + colletLen + spindleLen / 2;
    head.add(spindle);
    group.add(head);

    if (alongX) group.rotation.z = Math.PI / 2;

    // Centre of the table along the beam, in scene coordinates.
    var beamCentre = alongX ? table.position.x : table.position.y;

    scene.add(group);
    model = {
      group: group, gantry: gantry, car: carGroup, head: head,
      alongX: alongX, beamCentre: beamCentre,
      builtFor: table, bitDiameter: self.bitDiameter, metric: self.metric
    };
  }


  function placeModel() {
    var v = self.position;
    // In the group's own frame +x is the travel direction and +y runs along
    // the beam. With the beam along X the group is turned +90 degrees about
    // Z, so local (x, y) lands on scene (-y, x).
    var travel, along, centre;
    if (model.alongX) {
      travel = v[1]; along = -v[0]; centre = -model.beamCentre;
    } else {
      travel = v[0]; along = v[1]; centre = model.beamCentre;
    }
    model.gantry.position.set(travel, centre, 0);
    model.car.position.set(travel, along, 0);
    model.head.position.set(travel, along, v[2]);
  }


  // Make what is drawn match the current settings, table and position.
  function sync() {
    var table = getTableMesh ? getTableMesh() : null;
    var wantMachine = machineWanted() && !!table;

    if (wantMachine) {
      if (!model || model.builtFor !== table || model.alongX !== (self.gantryAxis === 'x') ||
          model.bitDiameter !== self.bitDiameter || model.metric !== self.metric) {
        buildModel(table);
      }
      placeModel();
      model.group.visible = true;
    } else if (model) {
      model.group.visible = false;
    }

    if (self.mesh) {
      var v = self.position;
      self.mesh.position.set(v[0], v[1], v[2] + self.size / 2);
      self.mesh.visible = !!self.show && !wantMachine && !self.hidden;
    }
  }


  self.setPosition = function (v) {
    self.position = [v[0], v[1], v[2]];
    sync();
  }


  self.update = function (size, position, metric) {
    // Remove previous mesh before creating a new one
    if (self.mesh) {
      scene.remove(self.mesh);
      if (self.mesh.geometry) self.mesh.geometry.dispose();
      if (self.mesh.material) self.mesh.material.dispose();
    }

    var material = new THREE.MeshPhongMaterial({
      shininess: 30,
      specular: 0x888888,
      color: 0xffff00,
      opacity: 0.8,
      transparent: true
    });

    self.size = size / 8;
    self.metric = !!metric;
    var geometry = new THREE.CylinderGeometry(0, self.size / 4, self.size, 32);
    self.mesh = new THREE.Mesh(geometry, material);
    self.mesh.rotation.x = -Math.PI / 2;
    scene.add(self.mesh);

    self.setPosition(position);
  }


  self.setShow = function(show) {
    self.show = show;
    cookie.set('show-tool', show ? 1 : 0);
    sync();
    update();
  }


  self.setShowMachine = function(show) {
    self.showMachine = show;
    cookie.set('show-machine', show ? 1 : 0);
    sync();
    update();
  }


  // Which axis the gantry beam spans ('x' or 'y'); anything else means the
  // machine has no gantry to draw and the cone is used.
  self.setGantryAxis = function (axis) {
    self.gantryAxis = String(axis || 'y').toLowerCase();
    sync();
  }


  self.setBitDiameter = function (diameter) {
    if (!(diameter > 0) || diameter === self.bitDiameter) return;
    self.bitDiameter = diameter;
    sync();
  }


  // Camera overlay views show the real machine, so the model steps aside.
  self.setSuppressMachine = function (suppress) {
    self.suppressMachine = !!suppress;
    sync();
  }


  // Draw nothing at all: another model (the 5-axis head) marks the tool.
  self.setHidden = function (hidden) {
    self.hidden = !!hidden;
    sync();
  }


  // Re-check the table (it is rebuilt when units or stock thickness change).
  self.refresh = sync;


  self.dispose = function () {
    disposeModel();
  }


  // Show
  self.show = parseInt(cookie.get('show-tool', 1));
  util.connectSetting('show-tool', self.show, self.setShow);

  self.showMachine = parseInt(cookie.get('show-machine', 1));
  util.connectSetting('show-machine', self.showMachine, self.setShowMachine);
}
