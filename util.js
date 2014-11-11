var path = require('path');
var log = require('./log').logger('util');
var fs = require('fs');
var q = require('q');

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

/**
 * Move a file from src to dest, avoiding cross-device rename failures.
 * This method will first try fs.rename and call the supplied callback if it succeeds. Otherwise
 * it will pump the conent of src into dest and unlink src upon completion.
 *
 * This might take a little more time than a single fs.rename, but it avoids error when
 * trying to rename files from one device to the other.
 *
 * @param src {String} absolute path to source file
 * @param dest {String} absolute path to destination file
 * @param cb {Function} callback to execute upon success or failure
 */
var move = function (src, dest, cb) {
	var renameDeferred = q.defer();
 
	fs.rename(src, dest, function (err) {
		if (err) {
			renameDeferred.reject(err);
		}
		else {
			renameDeferred.resolve();
		}
	});
 
	renameDeferred.promise.then(function () {
		// rename worked
		return cb(null);
	}, function (err) {
 
		log.warn('io.move: standard rename failed, trying stream pipe... (' + err + ')');
 
		// rename didn't work, try pumping
		var is = fs.createReadStream(src),
			os = fs.createWriteStream(dest);
 
		is.pipe(os);
 
		is.on('end', function () {
			fs.unlinkSync(src);
			cb(null);
		});
 
		is.on('error', function (err) {
			return cb(err);
		});
 
		os.on('error', function (err) {
			return cb(err);
		})
	});
};

exports.Queue = Queue
exports.allowed_file = allowed_file
exports.move = move
