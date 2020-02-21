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


function getVector(move, buffer, offset) {
  var v = [];

  for (var i = 0; i < 3; i++)
    v.push(move.buffers[buffer].array[move.index + offset + i]);

  return v;
}


function Move (buffers, index, line, rapid, feed, startTime) {
  this.buffers   = buffers;
  this.index     = index;
  this.line      = line;
  this.rapid     = rapid;
  this.feed      = feed;
  this.startTime = startTime;

  this.start  = getVector(this, 0, 0);
  this.end    = getVector(this, 0, 3);
  this.length = util.distance(this.start, this.end);

};


Move.prototype.setVector = function(buffer, offset, v) {
  for (var i = 0; i < 3; i++)
    this.buffers[buffer].array[this.index + offset + i] = v[i];

  this.buffers[buffer].needsUpdate = true;
}


Move.prototype.getLine      = function () {return this.line}
Move.prototype.getFeed      = function () {return this.feed}
Move.prototype.getStartTime = function () {return this.startTime}


Move.prototype.getEndTime   = function () {
  return this.startTime + this.getDuration()
}


Move.prototype.compareTime = function (t) {
  if (t < this.startTime) return -1;
  if (this.getEndTime() <= t) return 1;
  return 0;
}


Move.prototype.getLength    = function () {return this.length}
Move.prototype.getDuration  = function () {return this.length / this.feed * 60}
Move.prototype.getColor     = function () {return getVector(this, 1, 0)}


Move.prototype.setColor = function (color) {
  this.setVector(1, 0, color)
  this.setVector(1, 3, color)
}


Move.prototype.setDone = function (done) {
  this.setColor(done ? magenta : (this.rapid ? red : green));
}


Move.prototype.setStart = function (start) {this.setVector(0, 0, start)}


Move.prototype.getUnitVector = function () {
    var unit   = [];

    for (var i = 0; i < 3; i++)
      unit.push((this.end[i] - this.start[i]) / this.length);

    return unit;
  }


Move.prototype.getPositionAt = function (time) {
  var dist  = (time - this.startTime) / 60 * this.feed;
  var unit  = this.getUnitVector();
  var p     = [];

  for (var i = 0; i < 3; i++)
    p.push(this.start[i] + unit[i] * dist);

  return p;
}


Move.prototype.nearest = function (p) {
  if (!this.length) return this.end;

  var start = util.threeVec(this.start);
  var end   = util.threeVec(this.end);

  var line = new THREE.Line3(start, end);
  p = util.threeVec(p);
  line.closestPointToPoint(p, true, p);

  return [p.x, p.y, p.z];
}


Move.prototype.distanceTo = function (p) {
  return util.distance(p, this.nearest(p))
}


Move.prototype.timeNearest = function (p) {
  var dist = util.distance(this.start, this.nearest(p));
  return this.startTime + dist / this.feed * 60;
}


module.exports = Move;
