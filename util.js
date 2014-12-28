var path = require('path');
var log = require('./log').logger('util');
var fs = require('fs');
var q = require('q');

var fs = require('fs');
var escapeRE = require('escape-regexp-component');

var mime = require('mime');
var restify = require('restify');
var errors = restify.errors;

var MethodNotAllowedError = errors.MethodNotAllowedError;
var NotAuthorizedError = errors.NotAuthorizedError;
var ResourceNotFoundError = errors.ResourceNotFoundError;

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


// Copyright 2012 Mark Cavage, Inc.  All rights reserved.



///--- Functions

function serveStatic(opts) {
    opts = opts || {};
    /*
    assert.object(opts, 'options');
    assert.string(opts.directory, 'options.directory');
    assert.optionalNumber(opts.maxAge, 'options.maxAge');
    assert.optionalObject(opts.match, 'options.match');
    assert.optionalString(opts.charSet, 'options.charSet');
    */

    var p = path.normalize(opts.directory).replace(/\\/g, '/');
    var re = new RegExp('^' + escapeRE(p) + '/?.*');

    function serveFileFromStats(file, err, stats, isGzip, req, res, next) {
        if (err) {
            next(new ResourceNotFoundError(err,
                req.path()));
            return;
        } else if (!stats.isFile()) {
            next(new ResourceNotFoundError('%s does not exist', req.path()));
            return;
        }

        if (res.handledGzip && isGzip) {
            res.handledGzip();
        }

        var fstream = fs.createReadStream(file + (isGzip ? '.gz' : ''));
        var maxAge = opts.maxAge === undefined ? 3600 : opts.maxAge;
        fstream.once('open', function (fd) {
            res.cache({maxAge: maxAge});
            res.set('Content-Length', stats.size);
            res.set('Content-Type', mime.lookup(file));
            res.set('Last-Modified', stats.mtime);
            if (opts.charSet) {
                var type = res.getHeader('Content-Type') +
                    '; charset=' + opts.charSet;
                res.setHeader('Content-Type', type);
            }
            if (opts.etag) {
                res.set('ETag', opts.etag(stats, opts));
            }
            res.writeHead(200);
            fstream.pipe(res);
            fstream.once('end', function () {
                next(false);
            });
        });
    }

    function serveNormal(file, req, res, next) {
        fs.stat(file, function (err, stats) {
            if (!err && stats.isDirectory() && opts.default) {
                // Serve an index.html page or similar
                file = path.join(file, opts.default);
                fs.stat(file, function (dirErr, dirStats) {
                    serveFileFromStats(file,
                        dirErr,
                        dirStats,
                        false,
                        req,
                        res,
                        next);
                });
            } else {
                serveFileFromStats(file,
                    err,
                    stats,
                    false,
                    req,
                    res,
                    next);
            }
        });
    }

    function serve(req, res, next) {
        var uricomp = decodeURIComponent(req.path());
        console.log("URI COMPONENT: " + uricomp)
        console.log("DIR: " + opts.directory)
        var file = path.join(opts.directory, uricomp);

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next(new MethodNotAllowedError(req.method));
            return;
        }

        if (!re.test(file.replace(/\\/g, '/'))) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.match && !opts.match.test(file)) {
            next(new NotAuthorizedError(req.path()));
            return;
        }

        if (opts.gzip && req.acceptsEncoding('gzip')) {
            fs.stat(file + '.gz', function (err, stats) {
                if (!err) {
                    res.setHeader('Content-Encoding', 'gzip');
                    serveFileFromStats(file,
                        err,
                        stats,
                        true,
                        req,
                        res,
                        next);
                } else {
                    serveNormal(file, req, res, next);
                }
            });
        } else {
            serveNormal(file, req, res, next);
        }

    }

    return (serve);
}

var walk = function(dir, obj, done) {
  var results = {};
  fs.readdir(dir, function(err, list) {

    if (err) return done(err);

    var pending = list.length;
    if (!pending) return done(null, obj);

    list.forEach(function(file) {
      path = dir + '/' + file;
      fs.stat(path, function(err, stat) {
        if (stat && stat.isDirectory()) {
          dirobject =  {    name: file, 
                            path: path,
                            type: 'dir',
                            created : stat.ctime, 
                            modified : stat.mtime, 
                            children:[]
                        };
          obj.children.push(dirobject);
          walk(file, dirobject, function(err, res) {
            if (!--pending) done(null, obj);
          });
        } else {
          fileobject =  {   name: file,
                            path: path,
                            type: 'file',
                            created : stat.ctime, 
                            modified : stat.mtime, 
                            children:null
                        };
          obj.children.push(fileobject);
          //results.push(file);
          if (!--pending) done(null, obj);
        }
      });
    });
  });
};

var walkDir = function(dir, callback) {
    obj = {
        children : [],
        name : '/',
        path : '/',
        type : 'dir'
    }
    return walk(dir, obj, callback);
}

exports.serveStatic = serveStatic;
exports.Queue = Queue;
exports.allowed_file = allowed_file;
exports.move = move;
exports.walkDir = walkDir;