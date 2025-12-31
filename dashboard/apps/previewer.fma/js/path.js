/**
 * Loads, displays and simulates GCode paths.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict';


var parser = require('./parser');
var util   = require('./util');
var cookie = require('./cookie');
var Move   = require('./move');


var buffer_size = 10000;
var max_errors = 100;
var max_arc_error = 0.0001;    // a little more resolution for mm
// var max_arc_error = 0.001;
var rapid_feed = 120;

var red     = [1, 0, 0];
var green   = [0, 1, 0];
var magenta = [1, 0, 1];

var infoLine = "Line: ";

function vertArray(v) {return [v.x, v.y, v.z]}
function vertVector3(v) {return new THREE.Vector3(v.x, v.y, v.z)}


function clean_gcode(s) {
  var in_comment = false;
  var result = [];

  for (var i = 0; i < s.length; i++) {
    var c = s[i].toUpperCase();

    switch (c) {
    case ' ': case '\t': case '\r': case '%': break;
    case '(': in_comment = true; break;
    case ')': in_comment = false; break;
    default: if (!in_comment) result.push(c); break;
    }

}
  return result.join('');
}


module.exports = function(scene, callbacks) {
  var self = this;
  var unitSetInFile = false;


  self.setUnits = function (metric) {      // For changing to New Unit from inside file
    if(self.metric != metric) {            // ... check if different than what we have for machine
      self.metric = metric;
      unitSetInFile = true;
      infoLine = ("File Units Differ from Machine (Display) Units! -- Line: ");
    }                                      // Not sure if we want display in changed-to units or machine units 
//  $('[name="units"]').trigger('change'); // ... remove this line to leave display in machine units 
    callbacks.metric(metric);
  }


  self.newBuffer = function () {
    self.positions = new Float32Array(buffer_size * 6);
    self.colors    = new Float32Array(buffer_size * 6);
    self.fill = 0;

    var positions = new THREE.BufferAttribute(self.positions, 3);
    var colors    = new THREE.BufferAttribute(self.colors, 3);
    self.buffers.push([positions, colors]);
  }


  self.flushBuffer = function () {
    if (typeof self.positions == 'undefined' || self.fill == 0) return;

    if (self.fill < buffer_size) {
      self.positions = self.positions.slice(0, self.fill * 6);
      self.colors = self.colors.slice(0, self.fill * 6);
    }

    var geometry = new THREE.BufferGeometry();
    var buffers = self.buffers[self.buffers.length - 1];

    geometry.setAttribute('position', buffers[0]);
    geometry.setAttribute('color', buffers[1]);

    var material = new THREE.LineBasicMaterial({
      vertexColors: THREE.VertexColors,
      linewidth: 1,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor
    });

    self.obj.add(new THREE.LineSegments(geometry, material));

    self.positions = undefined;
    self.colors = undefined;
    self.fill = 0;
  }


  self.addError = function (type, msg) {
    if (self.errors.length == max_errors)
      self.errors.push({line: self.lines, type: 'error',
                        message: 'Too many errors'});
    if (max_errors < self.errors.legth) return;

    self.errors.push({line: self.lines, type: type, message: msg});

    msg = self.lines + ': ' + msg;
    if      (type == 'error')   console.error(msg);
    else if (type == 'warning') console.warn(msg);
    else if (type == 'debug')   console.debug(msg);
    else                        console.log(msg);
  }


  self.addPoint = function(p) {                        // growing bounds by inspecting all points
    var bounds = self.bounds;
    var axes = ['x', 'y', 'z']

    for (var i = 0; i < 3; i++) {
      var axis = axes[i];

      if (typeof bounds.min[axis] == 'undefined' || p[i] < bounds.min[axis])
        bounds.min[axis] = p[i];

      if (typeof bounds.max[axis] == 'undefined' || bounds.max[axis] < p[i])
        bounds.max[axis] = p[i];
    }
  }


  self.addLine = function(start, end, rapid) {
    if (typeof self.positions == 'undefined') self.newBuffer();

    var color = rapid ? red : green;

    self.addPoint(start);
    self.addPoint(end);

    for (var i = 0; i < 3; i++) {
      self.positions[self.fill * 6 + 0 + i] = start[i];
      self.positions[self.fill * 6 + 3 + i] = end[i];
      self.colors[self.fill * 6 + 0 + i] = color[i];
      self.colors[self.fill * 6 + 3 + i] = color[i];
    }

    var feed = rapid ? rapid_feed : self.feed;
    var move = new Move(self.buffers[self.buffers.length - 1], self.fill * 6,
                        self.lines + 1, rapid, feed, self.duration);
    
    // ADD: Store move metadata for material simulation
    move.start = start;
    move.end = end;
    move.type = 'line';
    move.startTime = self.duration;
    
    self.distance += move.getLength();
    self.duration += move.getDuration();
    
    // ADD: Store end time
    move.endTime = self.duration;
    
    self.moves.push(move);

    if (++self.fill == buffer_size) self.flushBuffer();
  }


  function getPlaneAxes(plane) {
    switch (plane) {
    case 'xy': return [0, 1, 2];
    case 'xz': return [0, 2, 1];
    case 'yz': return [1, 2, 0];
    default: throw 'Invalid plane ' + plane;
    }
  }


  function getPlaneOffsets(plane) {
    switch (plane) {
    case 'xy': return 'ij';
    case 'xz': return 'ik';
    case 'yz': return 'jk';
    default: throw 'Invalid plane ' + plane;
    }
  }


  function checkArc(words, plane) {
    // P word
    if (typeof words.p != 'undefined') {
      if (parseInt(words.p) != words.p)
        self.addError('error', 'P word in arc move must be an integer value.');

      else if (words.p < 1)
        self.addError('error', 'P word in arc move cannot be less than 1.');
    }

    // Offsets
    var offsets = ['i', 'j', 'k'];
    var planeOffsets = getPlaneOffsets(plane);
    var hasOffset = false;

    for (var i = 0; i < 3; i++) {
      var has = isFinite(words[offsets[i]]);

      if (planeOffsets.indexOf(offsets[i]) != -1) {
        if (has) hasOffset = true ;

      } else if (has)
        self.addError('error', 'Invalid offset word ' +
                      offsets[i].toUpperCase() + ' for arc in ' +
                      plane.toUpperCase() + ' plane');
    }

    if (!hasOffset)
      self.addError('error', 'Arc in ' + plane.toUpperCase() + ' plane ' +
                    'needs ' + planeOffsets[0].toUpperCase() + ' or ' +
                    planeOffsets[1].toUpperCase() + ' offset');
  }


  self.addArc = function (start, end, offset, radius, p, plane, clockwise) {
    if (plane == 'xz') clockwise = !clockwise;

    var planeAxis = getPlaneAxes(plane);

    var start2D = [];
    var end2D = [];
    for (var i = 0; i < 2; i++) {
      start2D[i] = start[planeAxis[i]];
      end2D[i]   = end[planeAxis[i]];
    }

    var center2D;

    if (typeof radius != 'undefined') {
      var a = util.distance(start, end);
      if (Math.abs(radius) < a - 0.00001) {
        self.addError('error', 'Impossible radius format arc, replacing with ' +
                      'line segment');
        self.addLine(start, end, false);
        return;
      }

      // Compute arc center
      var m = [start2D[0] + end2D[0] / 2, start2D[1] + end2D[1] / 2];
      var e = util.normalize([start2D[1] - end2D[1], start2D[0] - end2D[0]]);
      var d = util.distance(start, end) / 2;
      var l = radius * radius - d * d;

      // Handle possible small negative caused by rounding errors
      l = l < 0 ? 0 : Math.sqrt(l);
      if (!clockwise) l = -l;
      if (0 < radius) l = -l;

      center2D = [m[0] + e[0] * l, m[1] + e[1] * l];

    } else {
      center2D = [];
      for (i = 0; i < 2; i++) {
        if (isFinite(offset[planeAxis[i]]))
          center2D.push(offset[planeAxis[i]] + start2D[i]);
        else center2D.push(start2D[i]);
      }

      radius = util.distance(start2D, center2D);
      var radiusDiff = Math.abs(radius - util.distance(end2D, center2D));

      if (0.0005 < radiusDiff)
        self.addError('warning', 'Arc radius differs from end point by ' +
                      radiusDiff + ' in');
    }

    // Compute angle
    var startAngle =
        Math.atan2(start2D[1] - center2D[1], start2D[0] - center2D[0]);
    var endAngle =
        Math.atan2(end2D[1] - center2D[1], end2D[0] - center2D[0]);

    var angle = endAngle - startAngle;
    if (0 <= angle) angle -= 2 * Math.PI;
    if (!clockwise) angle += 2 * Math.PI;
    if (!angle) angle = 2 * Math.PI;

    if (typeof p != 'undefined')
      angle += Math.PI * 2 * (p - 1) * (angle < 0 ? -1 : 1);

    // Z offset
    var zStart = start[planeAxis[2]];
    var deltaZ = end[planeAxis[2]] - zStart;

    // Segments from allowed error
    var error = Math.min(max_arc_error, radius);

    var segAngle = 2 * Math.acos(1 - error / radius);
    segAngle = Math.min(2 * Math.PI / 3, segAngle);

    var segments = Math.ceil(Math.abs(angle) / segAngle);

    // ADDED: Debug first segment (only once)
    if (segments > 1) {
      console.log('ARC PARSED: First segment of', segments, 'total');
      console.log('  Radius:', radius.toFixed(4));
      console.log('  Center:', center2D);
      console.log('  Start angle:', (startAngle * 180 / Math.PI).toFixed(2), 'deg');
      console.log('  Total angle:', (angle * 180 / Math.PI).toFixed(2), 'deg');
    }

    // Render arc
    for (var i = 1; i < segments - 1; i++) {
      var a = i * angle / segments;
      var next = [0, 0, 0];

      next[planeAxis[0]] = center2D[0] + radius * Math.cos(startAngle + a);
      next[planeAxis[1]] = center2D[1] + radius * Math.sin(startAngle + a);
      next[planeAxis[2]] = zStart + deltaZ * a / angle;

      self.addLine(self.position, next, false);
      
      // REMOVED: Don't mark individual segments as arcs!
      // The arc has already been linearized - these are just short line segments
      
      self.position = next;
    }

    // Final move to exact end
    self.addLine(self.position, end, false);
    
    // REMOVED: Don't mark final segment either
  }


  self.nextPosition = function (words) {
    var axes  = ['x', 'y', 'z'];
    var scale = 1;
    if (unitSetInFile) scale = self.metric ? 25.4 : .03937;
    var next  = [];

    for (var i = 0; i < 3; i++) {
      var axis = words[axes[i]];
      next[i] = self.position[i];

      if (isFinite(axis))
        next[i] = axis / scale + (self.relative ? next[i] : 0);
    }

    return next;
  }


  self.arcOffset = function (words) {
    var axes    = ['x', 'y', 'z'];
    var offsets = ['i', 'j', 'k'];
    var scale = 1;
    if (unitSetInFile) scale = self.metric ? 25.4 : .03937;
    var result  = [];

    for (var i = 0; i < 3; i++) {
      var offset = words[offsets[i]];
      var axis = self.position[axes[i]];

      if (isFinite(offset))
        result.push(offset / scale - (self.arcRelative ? 0 : axis));
      else result.push(undefined);
    }

    return result;
  }


  self.parseLine = function (line) {
    // TODO parser does not handle number ending with a dot.  E.g. 0.

    var o = parser.parse(clean_gcode(line));
    var result = {cmds: [], words: {}}
    var hasAxis = false;

    for (var i = 0; i < o.words.length; i++) {
      var letter = o.words[i][0];
      var number = o.words[i][1];

      if (letter == 'G' || letter == 'M') result.cmds.push(letter + number)
      else result.words[letter.toLowerCase()] = parseFloat(number, 10);
      if ('XYZ'.indexOf(letter) != -1) hasAxis = true;
    }

    if (!result.cmds.length && typeof self.modalMove != 'undefined' && hasAxis)
      result.cmds.push(self.modalMove);

    return result;
  }


  self.processLine = function (line) {
    try {
      line = self.parseLine(line);

    } catch (e) {
      self.addError('error', e);
      return;
    }

    if (typeof line.words.f != 'undefined')
      self.feed = line.words.f ;
    if (unitSetInFile) self.feed = line.words.f / (self.metric ? 25.4 : .03937);

    var next = self.nextPosition(line.words);

    for (var j = 0; j < line.cmds.length; j++) {
      var cmd = line.cmds[j];
      self.commands++;

      // Check for GCode errors
      var motion = cmd == 'G0' || cmd == 'G1' || cmd == 'G2' || cmd == 'G3';
      if (motion) self.modalMove = cmd;

      if (!self.feed && motion && cmd != 'G0')
        self.addError('error', cmd + ' with zero feed rate');

      if (typeof self.metric == 'undefined' && motion) {
        self.addError('error', cmd + ' with out units set, assuming imperial');
        self.metric = false;
      }

      switch (cmd) {
      case 'G0': case 'G1':
        self.addLine(self.position, next, cmd == 'G0');
        break;

      case 'G2': case 'G3':
        checkArc(line.words, self.plane);
        var offset = self.arcOffset(line.words);
        self.addArc(self.position, next, offset, line.words.r, line.words.p,
                    self.plane, cmd == 'G2');
        break;

      case 'G17':   self.plane       = 'xy';  break;
      case 'G18':   self.plane       = 'xz';  break;
      case 'G19':   self.plane       = 'yz';  break;
      case 'G20':   self.setUnits(false);     break;
      case 'G21':   self.setUnits(true);      break;
      case 'G90':   self.relative    = false; break;
      case 'G90.1': self.arcRelative = false; break;
      case 'G91':   self.relative    = true;  break;
      case 'G91.1': self.arcRelative = true;  break;
      case 'M2':    self.done        = true;  break;
      }

      self.position = next;
    }
  }


  self.process = function (done) {
    for (var i = 0; i < 1000 && !self.done; i++) {
      if (self.gcode.length <= self.lines) break;
      self.processLine(self.gcode[self.lines]);
      self.lines += 1;
    }

    callbacks.progress(self.lines / self.gcode.length);

    if (!self.done && self.lines < self.gcode.length)
      setTimeout(function () {self.process(done)}, 10);

    else {
      if (!self.commands) self.addError('error', 'No commands.');
      self.flushBuffer();
      self.loaded = true;
      console.log('Path distance:', self.distance.toFixed(2),
                  'duration:', self.duration.toFixed(2) + 's');
      done();
    }
  }


  self.load = function (gcode, done) {
    console.log('Path loading');

    if (typeof gcode !== 'string' || gcode  === '') {
      self.addError('error', 'No commands; or, Vectric file with mis-matched Units.');
      done();
      return;
    }

    self.gcode = gcode.split('\n');
    self.process(done);
    self.reset();                            // put cone at starting location
  }


  function findMove(cmp, first, last) {
    if (typeof first == 'undefined') first = 0;
    if (typeof last == 'undefined') last = self.moves.length - 1;
    if (last < first) return undefined;

    if (first == last) return cmp(self.moves[first]) ? undefined : first;

    var mid = first + Math.floor((last - first) / 2);
    var result = cmp(self.moves[mid]);

    if (result < 0) return findMove(cmp, first, mid - 1);
    if (0 < result) return findMove(cmp, mid + 1, last);
    return mid;
  }


  function findMoveAtTime(time, first, last) {
    if (time <= 0) return 0;
    if (self.duration <= time) return self.moves.length - 1;

    function cmp(move) {return move.compareTime(time)}
    return findMove(cmp, first, last);
  }


  function findMoveAtLine(line, first, last) {
    if (line <= 0) return 0;
    if (self.lines < line) return self.moves.length - 1;

    function cmp(move) {return line - move.getLine()}
    var move = findMove(cmp, first, last);

    while (move && self.moves[move - 1].getLine() == line) move--;

    return move;
  }


  function setCurrentLine(line) {
    self.codeLine.text(infoLine + line.toLocaleString());
  }


  self.setMoveTime = function(time) {
    if (!self.loaded || !self.moves.length) return;

    var nextMove = findMoveAtTime(time);
    var move     = self.moves[nextMove];
    var start    = move.start;
    var p        = move.getPositionAt(time);

    // Material simulation during playback
    if (callbacks.materialUpdate && nextMove > self.lastMove) {
      for (var i = self.lastMove; i < nextMove; i++) {
        var currentMove = self.moves[i];
        
        // Only simulate cutting moves (not rapids)
        if (!currentMove.rapid) {
          
          // Check if this is an arc move
          if (currentMove.type === 'arc') {
            
            // CHANGED: Dynamic sampling based on arc length
            var arcLength = currentMove.getLength();
            var samplesPerInch = 1500; // INCREASED from 30 to ensure fine coverage
            var numSegments = Math.max(15, Math.ceil(arcLength * samplesPerInch));
            var prevPos = currentMove.start;
            
            for (var seg = 1; seg <= numSegments; seg++) {
              var t = seg / numSegments;
              var segTime = currentMove.startTime + t * currentMove.getDuration();
              var currentPos = currentMove.getPositionAt(segTime);
              
              // Pass small segments with isArcSegment flag
              callbacks.materialUpdate(prevPos, currentPos, true);
              prevPos = currentPos;
            }
          } else {
            // Linear moves: just start to end
            callbacks.materialUpdate(currentMove.start, currentMove.end, false);
          }
        }
      }
    }

    // Mark lines done
    for (var i = self.lastMove; i < nextMove; i++)
      self.moves[i].setDone(true);

    // Current line
    var verts = self.currentLine.geometry.vertices;
    verts[0].fromArray(start);
    verts[1].fromArray(p);
    self.currentLine.geometry.verticesNeedUpdate = true;
    self.currentLine.visible = true;

    move.setStart(p);
    if (self.lastMove != nextMove) {
      var last = self.moves[self.lastMove];
      last.setStart(last.start)
    }

    callbacks.position(p);

    setCurrentLine(move.getLine());
    
    // Force final material update when simulation completes
    // DO NOT AUTO-RESET - User wants to explore the result!
    if (time >= self.duration && callbacks.materialForceUpdate) {
      callbacks.materialForceUpdate();
    }
    
    self.lastMove = nextMove;
    self.moveTime = time;
  }


  self.setMoveLinePosition = function(line, position) {
    if (!self.loaded) return;
    self.pause();

    var move = findMoveAtLine(line);

    if (typeof position == 'undefined') {
      self.setMoveTime(self.moves[move].getStartTime());
      setCurrentLine(line);
      return;
    }

    var minDist = undefined;
    var minMove = undefined;
    for (var i = move; i < self.moves.length; i++) {
      if (self.moves[i].getLine() != line) break;

      var dist = self.moves[i].distanceTo(position);
      if (typeof minDist == 'undefined' || dist < minDist) {
        minMove = i;
        minDist = dist;
      }
    }

    if (minMove !== undefined)  {
      var time = self.moves[minMove].timeNearest(position);
      self.setMoveTime(time);
    }

    setCurrentLine(line);
  }


  self.setMoveToEnd = function () {
    if (!self.loaded) return;
    self.pause();
    self.setMoveTime(self.duration);
    setCurrentLine(self.lines);
  }


  function isRunning() {return typeof self.animationFrame != 'undefined'}


  function setRunning(running) {
    if (running) self.preview.addClass('running');
    else self.preview.removeClass('running');
  }


  function animate() {
    var timeDiff = util.now() - self.startTime;
    var time = self.offsetTime + timeDiff * self.speed;

    if (self.duration <= time) time = self.duration;
    self.setMoveTime(time);

    if (time == self.duration) self.pause();
    else self.animationFrame = window.requestAnimationFrame(animate);
  }


  self.play = function () {
    setRunning(true);
    if (self.duration <= self.moveTime) self.reset();
    self.offsetTime = self.moveTime;
    self.startTime  = util.now();
    if (!isRunning()) animate();
  }


  self.pause = function () {
    if (!isRunning()) return;
    setRunning(false);
    window.cancelAnimationFrame(self.animationFrame);
    self.animationFrame = undefined;
  }


  self.reset = function () {
    self.pause();

    for (var i = 0; i <= self.lastMove; i++)
      self.moves[i].setDone(false);

    self.setMoveTime(0);
//    self.currentLine.visible = false;    //  don't hide notes on file unit
//    self.codeLine.text('');
  }


  function setSpeed (speed) {
    self.speed = speed;
    cookie.set('speed', speed);

    if (isRunning()) {
      self.pause();
      self.play();
    }
  }


  self.lastMove    = 0;
  self.speed       = 1;
  self.offsetTime  = 0;
  self.moveTime    = 0;
  self.moves       = [];
  self.buffers     = [];
  self.lines       = 0;
  self.distance    = 0;
  self.duration    = 0;
  self.bounds      = {min: {}, max: {}};
  self.position    = [0, 0, 0];
  self.plane       = 'xy';
  self.done        = false;
  self.relative    = false;
  self.arcRelative = true;
  self.errors      = [];
  self.commands    = 0;
  self.codeLine    = $('#preview .code-line');
  self.preview     = $('#preview');
  self.show        = parseInt(cookie.get('show-toolpath', 1)); // Default to visible

  // Playback speed
  self.speed = parseFloat(cookie.get('speed', 1));
  util.connectSetting('speed', self.speed, setSpeed);

  // THREE.js
  self.obj = new THREE.Object3D();
  self.obj.visible = !!self.show;  // Respect initial setting
  scene.add(self.obj);

  var material = new THREE.LineBasicMaterial({color: 0xff00ff});
  var geometry = new THREE.Geometry();
  geometry.vertices.push(new THREE.Vector3(0, 0, 0));
  geometry.vertices.push(new THREE.Vector3(0, 0, 0));
  self.currentLine = new THREE.Line(geometry, material);
  self.currentLine.visible = !!self.show;
  scene.add(self.currentLine);

  // NEW: Add setShow method
  self.setShow = function(show) {
    self.show = show;
    if (self.obj) self.obj.visible = !!show;
    if (self.currentLine) self.currentLine.visible = !!show;
    cookie.set('show-toolpath', show ? 1 : 0);
    if (callbacks.update) callbacks.update();
  };

  util.connectSetting('show-toolpath', self.show, self.setShow);

  /**
   * Remove material along a path (IMPROVED for small arc handling)
   */
  self.removeMaterial = function(start, end, toolType) {
    if (!heightMap) {
      console.warn('Height map not initialized');
      return;
    }
    
    toolType = toolType || 'flat';
    
    // Calculate move distance
    var dx = end[0] - start[0];
    var dy = end[1] - start[1];
    var dz = end[2] - start[2];
    var xyDist = Math.sqrt(dx*dx + dy*dy);
    var totalDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (totalDist < 0.001) return;
    
    // DETECT PLUNGE: mostly vertical movement
    var isPlunge = (xyDist < toolDia * 0.1) && (Math.abs(dz) > toolDia * 0.5);
    
    // DETECT AXIS-ALIGNED MOVES (vertical or horizontal lines)
    var isAxisAligned = false;
    var axisAlignedTolerance = 0.001;
    
    if (Math.abs(dx) < axisAlignedTolerance && Math.abs(dy) > axisAlignedTolerance) {
      isAxisAligned = 'vertical';
    } else if (Math.abs(dy) < axisAlignedTolerance && Math.abs(dx) > axisAlignedTolerance) {
      isAxisAligned = 'horizontal';
    }
    
    // DETECT SMALL SEGMENTS that might be part of small arcs
    // If segment is short but not axis-aligned, it's probably part of a curve
    var isSmallArcSegment = (xyDist < toolDia * 2) && !isAxisAligned && !isPlunge;
    
    if (isPlunge) {
      // For plunges, single point update
      var toolX = start[0];
      var toolY = start[1];
      var toolZ = Math.min(start[2], end[2]);
      
      updateGridUnderTool(toolX, toolY, toolZ, toolType);
    } else if (isSmallArcSegment) {
      // NEW: For small arc segments, use VERY fine interpolation
      // This catches small arcs that are broken into few segments
      var steps = Math.max(8, Math.ceil(totalDist / (heightMap.xStep * 0.15))); // 15% of grid spacing
      
      for (var step = 0; step <= steps; step++) {
        var t = step / steps;
        var toolX = start[0] + dx * t;
        var toolY = start[1] + dy * t;
        var toolZ = start[2] + dz * t;
        
        updateGridUnderTool(toolX, toolY, toolZ, toolType);
      }
    } else if (isAxisAligned) {
      // For axis-aligned moves, use finer interpolation
      var steps = Math.max(5, Math.ceil(totalDist / (heightMap.xStep * 0.3)));
      
      for (var step = 0; step <= steps; step++) {
        var t = step / steps;
        var toolX = start[0] + dx * t;
        var toolY = start[1] + dy * t;
        var toolZ = start[2] + dz * t;
        
        updateGridUnderTool(toolX, toolY, toolZ, toolType);
      }
    } else {
      // For normal moves, standard interpolation
      var steps = Math.max(2, Math.ceil(totalDist / (toolDia * 0.5)));
      
      for (var step = 0; step <= steps; step++) {
        var t = step / steps;
        var toolX = start[0] + dx * t;
        var toolY = start[1] + dy * t;
        var toolZ = start[2] + dz * t;
        
        updateGridUnderTool(toolX, toolY, toolZ, toolType);
      }
    }
    
    var now = Date.now();
    if (isDirty && (now - lastUpdateTime) >= UPDATE_INTERVAL_MS) {
      console.log('Material update: ' + pendingUpdates + ' changes since last render');
      self.updateMesh();
      lastUpdateTime = now;
      isDirty = false;
      pendingUpdates = 0;
    }
  };
}
