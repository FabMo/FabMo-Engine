var path = require('path');

function listify(x) {
    if(x instanceof Array) {
        return x;
    } else {
        return [x];
    }
}

// Simple queue, faster than using array.shift
function Queue(){

  var queue  = [];
  var offset = 0;

  this.getLength = function(){ return (queue.length - offset); }
  this.getContents = function() { return queue; }
  this.isEmpty = function(){ return (queue.length == 0); }
  this.enqueue = function(item){ queue.push(item); }
  this.dequeue = function(){

    // if the queue is empty, return immediately
    if (queue.length == 0) return undefined;

    // store the item at the front of the queue
    var item = queue[offset];

    // increment the offset and remove the free space if necessary
    if (++ offset * 2 >= queue.length){
      queue  = queue.slice(offset);
      offset = 0;
    }

    // return the dequeued item
    return item;

  }
  this.peek = function(){
    return (queue.length > 0 ? queue[offset] : undefined);
  }
  this.clear = function() {
	queue = [];
	offset = 0;
	}
}

// *TODO:* This is defined in two places, we should fix that.
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];

function allowed_file(filename){
  if (ALLOWED_EXTENSIONS.indexOf(path.extname(filename).toLowerCase()) !== -1) {
    return true;
  }
  else {
    return false;
  }
};


exports.Queue = Queue
exports.allowed_file = allowed_file