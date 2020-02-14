/**
 * A GCode move.
 *
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 */

'use strict';


var util  = require('./util');


var red     = [1, 0, 0];
var green   = [0, 1, 0];
var magenta = [1, 0, 1];


module.exports = function(buffers, index, line, rapid, feed, startTime) {
  var self = this;


  function getVector(buffer, offset) {
    var v = [];

    for (var i = 0; i < 3; i++)
      v.push(buffers[buffer].array[index + offset + i]);

    return v;
  }


  function setVector(buffer, offset, v) {
    for (var i = 0; i < 3; i++)
      buffers[buffer].array[index + offset + i] = v[i];

    buffers[buffer].needsUpdate = true;
  }


  self.getLine      = function () {return line}
  self.getFeed      = function () {return feed}
  self.getStartTime = function () {return startTime}
  self.getEndTime   = function () {return startTime + self.getDuration()}


  self.compareTime = function (t) {
    if (t < startTime) return -1;
    if (self.getEndTime() <= t) return 1;
    return 0;
  }


  self.getStart     = function () {return self.start}
  self.getEnd       = function () {return self.end}
  self.getLength    = function () {return self.length}
  self.getDuration  = function () {return self.length / feed * 60}
  self.getColor     = function () {return getVector(1, 0)}


  self.setColor = function (color) {
    setVector(1, 0, color)
    setVector(1, 3, color)
  }


  self.setDone = function (done) {
    self.setColor(done ? magenta : (rapid ? red : green));
  }


  self.setStart = function (start) {setVector(0, 0, start)}


  self.getUnitVector = function () {
    var start  = self.getStart();
    var end    = self.getEnd();
    var unit   = [];

    for (var i = 0; i < 3; i++)
      unit.push((end[i] - start[i]) / self.length);

    return unit;
  }


  self.getPositionAt = function (time) {
    var dist  = (time - startTime) / 60 * feed;
    var start = self.getStart();
    var unit  = self.getUnitVector();
    var p     = [];

    for (var i = 0; i < 3; i++)
      p.push(start[i] + unit[i] * dist);

    return p;
  }


  self.nearest = function (p) {
    if (!self.length) return self.getEnd();

    var start = util.threeVec(self.getStart());
    var end   = util.threeVec(self.getEnd());

    var line = new THREE.Line3(start, end);
    p = util.threeVec(p);
    line.closestPointToPoint(p, true, p);

    return [p.x, p.y, p.z];
  }


  self.distanceTo = function (p) {return util.distance(p, self.nearest(p))}


  self.timeNearest = function (p) {
    var dist = util.distance(self.getStart(), self.nearest(p));
    return startTime + dist / feed * 60;
  }


  function computeLength() {
    return util.distance(self.getStart(), self.getEnd());
  }


  self.start = getVector(0, 0);
  self.end = getVector(0, 3);
  self.length = computeLength();
}
