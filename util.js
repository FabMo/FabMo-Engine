// Simple queue, faster than using array.shift
function Queue(){

  var queue  = [];
  var offset = 0;

  this.getLength = function(){ return (queue.length - offset); }
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
	this.queue = [];
	this.offset = 0;
	}
}

exports.Queue = Queue
