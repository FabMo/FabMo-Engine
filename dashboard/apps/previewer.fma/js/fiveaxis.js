/**
 * 5-axis head: kinematics and machine model.
 *
 * Ported from the ShopBot Labs 5-axis visualizer
 * (labs.shopbottools.com/apps/5axis_viz), which is modelled on the real
 * machine: A is a turret about Z at the foot of the Z column, B tilts the
 * spindle on it, and X/Y/Z are the position of the A/B pivot.
 */

'use strict';


// Head geometry (inches) and axis conventions, as tuned in the labs app.
var DEFAULTS = {
  aPivotBelowZ: 3,     // Z carriage bottom to A pivot centre
  bPivotOffset: 2,     // A axis to B pivot
  spindleLength: 6,    // B pivot to tool tip
  zTravel: 36,
  aFlip: 1,            // 1 or -1: sense of A
  bFlip: -1,           // 1 or -1: sense of B
  aZero: 90,           // degrees added to A
  bZero: 0,            // degrees added to B
  zZero: -10           // commanded Z at which the tip is on the table
};

var STEEL = 0x888899;
var ALUMINUM = 0xaab0b8;
var SPINDLE_COLOR = 0x445566;
var BIT_COLOR = 0xddcc88;

var KEYS = Object.keys(DEFAULTS);
var LENGTHS = ['aPivotBelowZ', 'bPivotOffset', 'spindleLength', 'zTravel', 'zZero'];


// Settings: the defaults, scaled to the machine's units, overridden by
// anything given (machine.fiveaxis in the config, in machine units).
exports.settings = function (overrides, unitScale) {
  var k = {unit: unitScale || 1};
  KEYS.forEach(function (key) {
    var scaled = LENGTHS.indexOf(key) !== -1 ? DEFAULTS[key] * k.unit : DEFAULTS[key];
    var given = overrides ? Number(overrides[key]) : NaN;
    k[key] = isFinite(given) && overrides[key] !== null && overrides[key] !== '' ? given : scaled;
  });
  return k;
};


// Commanded axis values [x, y, z, a, b] -> the pose the model is drawn in:
// Z measured from the table, angles with flips and zero offsets applied.
exports.tune = function (m, k) {
  return {
    x: m[0], y: m[1],
    z: m[2] - k.zZero,
    a: m[3] * k.aFlip + k.aZero,
    b: m[4] * k.bFlip + k.bZero
  };
};


// Unit vector from the pivot toward the tip. B = 0 hangs straight down;
// B = 90 is horizontal, pointing where A has turned it.
function tipDirection(pos) {
  var a = pos.a * Math.PI / 180, b = pos.b * Math.PI / 180;
  return [Math.sin(a) * Math.sin(b), -Math.cos(a) * Math.sin(b), -Math.cos(b)];
}


// Pivot (B axis centre) for a tuned pose.
exports.pivot = function (pos, k) {
  return [pos.x, pos.y, pos.z + k.spindleLength];
};


// Tool tip for a tuned pose.
exports.tip = function (pos, k) {
  var d = tipDirection(pos), L = k.spindleLength;
  return [pos.x + d[0] * L, pos.y + d[1] * L, pos.z + L + d[2] * L];
};


// Tool tip straight from commanded axis values.
exports.tipOf = function (m, k) {
  return exports.tip(exports.tune(m, k), k);
};


function mesh(geometry, color) {
  return new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({color: color}));
}


/**
 * Build the machine: gantry posts and beam, Y carriage, Z column, A turret,
 * B housing, and the spindle with collet and bit. The table is the
 * previewer's own. yMin/yMax are where the gantry posts stand.
 */
exports.buildMachine = function (k, yMin, yMax) {
  var u = k.unit;
  var root = new THREE.Group();
  var hangLength = k.aPivotBelowZ + k.bPivotOffset + k.spindleLength;
  var beamHeight = hangLength + k.zTravel + 4 * u;
  var depth = yMax - yMin, yMid = (yMin + yMax) / 2;

  // Gantry assembly: everything that moves in X.
  var gantryAssembly = new THREE.Group();
  [yMin, yMax].forEach(function (y) {
    var post = mesh(new THREE.BoxGeometry(3 * u, 3 * u, beamHeight), STEEL);
    post.position.set(0, y, beamHeight / 2);
    gantryAssembly.add(post);
  });
  var beam = mesh(new THREE.BoxGeometry(4 * u, depth, 4 * u), ALUMINUM);
  beam.position.set(0, yMid, beamHeight);
  gantryAssembly.add(beam);
  root.add(gantryAssembly);

  // Y carriage: slides along the beam.
  var yCarriageGroup = new THREE.Group();
  var carriage = mesh(new THREE.BoxGeometry(5 * u, 4 * u, 5 * u), ALUMINUM);
  carriage.position.set(0, 0, beamHeight - 2.5 * u);
  yCarriageGroup.add(carriage);
  root.add(yCarriageGroup);

  // Z column: slides vertically on the Y carriage.
  var zColumnGroup = new THREE.Group();
  var zLen = k.zTravel + 4 * u;
  var zCol = mesh(new THREE.BoxGeometry(3 * u, 3 * u, zLen), ALUMINUM);
  zCol.position.set(0, 0, zLen / 2);
  zColumnGroup.add(zCol);
  root.add(zColumnGroup);

  // A turret at the foot of Z.
  var aGroup = new THREE.Group();
  var aHousing = mesh(new THREE.BoxGeometry(4 * u, 4 * u, k.aPivotBelowZ), SPINDLE_COLOR);
  aHousing.position.set(0, 0, -k.aPivotBelowZ / 2);
  aGroup.add(aHousing);
  root.add(aGroup);

  // B tilt housing, carried by A.
  var bGroup = new THREE.Group();
  bGroup.add(mesh(new THREE.CylinderGeometry(1.5 * u, 1.5 * u, 2.5 * u, 12), SPINDLE_COLOR));
  root.add(bGroup);

  // Spindle, collet and bit, hung from B along -Y of their own group.
  var spindleGroup = new THREE.Group();
  var L = k.spindleLength;
  var bodyLen = L * 0.6;
  var body = mesh(new THREE.CylinderGeometry(1 * u, 1 * u, bodyLen, 12), SPINDLE_COLOR);
  body.position.set(0, -bodyLen / 2, 0);
  spindleGroup.add(body);

  var colletLen = L * 0.15;
  var collet = mesh(new THREE.CylinderGeometry(0.6 * u, 0.3 * u, colletLen, 8), STEEL);
  collet.position.set(0, -bodyLen - colletLen / 2, 0);
  spindleGroup.add(collet);

  var bitLen = L - bodyLen - colletLen;
  var bit = mesh(new THREE.CylinderGeometry(0.15 * u, 0.05 * u, bitLen, 6), BIT_COLOR);
  bit.position.set(0, -bodyLen - colletLen - bitLen / 2, 0);
  spindleGroup.add(bit);
  root.add(spindleGroup);

  // Remember each part's own colour so a style can be undone.
  root.traverse(function (o) {
    if (o.isMesh) o.userData.baseColor = o.material.color.getHex();
  });

  return {
    root: root,
    gantryAssembly: gantryAssembly,
    yCarriageGroup: yCarriageGroup,
    zColumnGroup: zColumnGroup,
    aGroup: aGroup,
    bGroup: bGroup,
    spindleGroup: spindleGroup,
    hangLength: hangLength
  };
};


// Move the model to a tuned pose.
exports.updateMachine = function (model, pos, k) {
  var a = pos.a * Math.PI / 180, b = pos.b * Math.PI / 180;

  model.gantryAssembly.position.x = pos.x;
  model.yCarriageGroup.position.set(pos.x, pos.y, 0);

  var zBottom = model.hangLength + pos.z;
  model.zColumnGroup.position.set(pos.x, pos.y, zBottom);

  model.aGroup.position.set(pos.x, pos.y, zBottom);
  model.aGroup.rotation.z = a;

  var bPivotZ = zBottom - k.aPivotBelowZ - k.bPivotOffset;
  model.bGroup.position.set(pos.x, pos.y, bPivotZ);
  model.bGroup.rotation.z = a;

  model.spindleGroup.position.set(pos.x, pos.y, bPivotZ);
  model.spindleGroup.rotation.copy(new THREE.Euler(-(b - Math.PI / 2), 0, a, 'ZXY'));
};


/**
 * Machine look: 'outlined' (white with black edges, the labs light theme),
 * 'solid' (each part in its own colour) or 'wireframe' (glowing orange).
 */
exports.setStyle = function (model, style) {
  var overlays = [];
  model.root.traverse(function (o) {
    if (o.userData.edgeOverlay) overlays.push(o);
  });
  overlays.forEach(function (o) {
    o.parent.remove(o);
    o.geometry.dispose();
    o.material.dispose();
  });

  model.root.traverse(function (o) {
    if (!o.isMesh) return;
    var mat = o.material;
    mat.wireframe = false;
    mat.transparent = false;
    mat.opacity = 1;
    mat.emissive.setHex(0x000000);
    mat.emissiveIntensity = 1;
    mat.color.setHex(o.userData.baseColor);

    if (style === 'wireframe') {
      mat.wireframe = true;
      mat.transparent = true;
      mat.opacity = 0.8;
      mat.color.setHex(0xf09040);
      mat.emissive.setHex(0xf09040);
      mat.emissiveIntensity = 0.25;
    } else if (style === 'outlined') {
      mat.color.setHex(0xffffff);
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, 15),
        new THREE.LineBasicMaterial({color: 0x000000}));
      edges.userData.edgeOverlay = true;
      o.add(edges);
    }
    mat.needsUpdate = true;
  });
};


exports.dispose = function (model) {
  if (model.root.parent) model.root.parent.remove(model.root);
  model.root.traverse(function (o) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
};
