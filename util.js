var path = require('path');
var log = require('./log').logger('util');
var fs = require('fs');
var q = require('q');
var fs = require('fs');
var uuid = require('node-uuid');
var fs = require('fs');
var escapeRE = require('escape-regexp-component');
var exec = require('child_process').exec;
var stream = require('stream');
var util = require('util');
var mime = require('mime');
var restify = require('restify');
var errors = require('restify');

ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];
ALLOWED_APP_EXTENSIONS = ['.zip', '.fma'];

GCODE_EXTENSIONS = ['.nc','.g','.gc','.gcode'];
OPENSBP_EXTENSIONS = ['.sbp', '.sbc'];

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

function doshell(command, callback){
    exec(command, function(error, stdout, stderr) {
        callback(stdout);
    });
}

function extend(a,b, force) {
    for(k in b) {
        if(a.hasOwnProperty(k) || force) {
            if(typeof b[k] === 'object' && b[k] !== null) {
                if(typeof a[k] === 'object' && a[k] !== null) {
                    extend(a[k], b[k], force);
                } else {
                    if(force) {
                        a[k] = b[k];
                    } else {
                        log.warn('Object format error in extend.');
                    }
                }
            } else {
                a[k] = b[k];
            }
        }
    }
}

exports.filename = function(pathname) {
    parts = pathname.split(path.sep);
    return parts[parts.legnth-1];
};

var createUniqueFilename = function (filename) {
    var extension = (/[.]/.exec(filename)) ? /[^.]+$/.exec(filename) : undefined;
    return uuid.v1() + (extension ? ('.' + extension) : '');
};

// Simple queue, faster than using array.shift
function Queue(){

  var queue  = [];
  var offset = 0;

  this.getLength = function(){ return (queue.length - offset); };
  this.getContents = function() { return queue; };
  this.isEmpty = function(){ return (queue.length === 0); };
  this.enqueue = function(item){ queue.push(item); };
  this.multiEnqueue = function(iterable) {
    iterable.forEach(function(item) {
      queue.push(item);
    });
  }
  this.dequeue = function(){

    // if the queue is empty, return immediately
    if (queue.length === 0) return undefined;

    // store the item at the front of the queue
    var item = queue[offset];

    // increment the offset and remove the free space if necessary
    if (++ offset * 2 >= queue.length){
      queue  = queue.slice(offset);
      offset = 0;
    }

    // return the dequeued item
    return item;

  };
  this.multiDequeue = function(count) {

    // If asking for more items than are in the queue, return everything
    count = count > queue.length ? queue.length : count;

    // store the item at the front of the queue
    var items = queue.slice(offset, offset+count);

    // add to the offset and remove the free space if necessary
    offset += count;
    if (offset * 2 >= queue.length){
      queue  = queue.slice(offset);
      offset = 0;
    }

    // return the dequeued item
    return items;

  };

  this.peek = function(){
    return (queue.length > 0 ? queue[offset] : undefined);
  };
  this.clear = function() {
	queue = [];
	offset = 0;
	};
}

function allowed_file(filename){
    return isGCodeFile(filename) || isOpenSBPFile(filename);
}

function allowedAppFile(filename) {
  if (ALLOWED_APP_EXTENSIONS.indexOf(path.extname(filename).toLowerCase()) !== -1) {
    return true;
  }
  else {
    return false;
  }
}

function isGCodeFile(pathname) {
    return (GCODE_EXTENSIONS.indexOf(path.extname(pathname).toLowerCase()) !== -1)
}

function isOpenSBPFile(pathname) {
    return (OPENSBP_EXTENSIONS.indexOf(path.extname(pathname).toLowerCase()) !== -1)
}

/**
 * Move a file from src to dest, avoiding cross-device rename failures.
 * This method will first try fs.rename and call the supplied callback if it succeeds. Otherwise
 * it will pump the conent of src into dest and unlink src upon completion.
 *
 * This might take a little more time than a single fs.rename, but it avoids error when
 * trying to rename files from one device to the other.
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
		});
	});
};

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

// TODO better error handling here
function walkDir(filename) {
    var stats = fs.lstatSync(filename),
        info = {
            path: filename,
            text: path.basename(filename),
            name: path.basename(filename)
        };

    if (stats.isDirectory()) {
        info.type = "dir";
        info.children = fs.readdirSync(filename).map(function(child) {
            return walkDir(filename + '/' + child);
        });
    } else {
        // Assuming it's a file. In real life it could be a symlink or
        // something else!
        info.type = "file";
        info.children = null;
    }

    return info;
}

function fixJSON(json) {
    var retval = {};

    for(var key in json) {
        if (typeof json[key] === 'object') {
            var value = fixJSON(json[key]);
        } else {
            var value = Number(json[key]);
            if(typeof value === 'undefined' || isNaN(value)) {
                if(json[key] === 'true') {
                    value = true;
                } else if(json[key] === 'false') {
                    value = false;
                } else {
                    value = json[key];
                }
            }
        }
        if(key[0] === '_') {
            key = key.slice(1);
        }
        retval[key] = value;
    }
    return retval;
}

function Watchdog(timeout,exit_code){
    var watchdog_flag;
    var watchdog_timeout=timeout||1000;
    var watchdog_exit_code=exit_code||20;

    watchdog_exit = function(){
        //throw new Error("G2 is not responding");
        //process.exit(this.watchdog_exit_code);
    };

    this.start = function(){
        if(this.watchdog_flag===undefined){
            this.watchdog_flag=setTimeout(watchdog_exit,watchdog_timeout);
        }
        else{
            this.reset();
        }
    };

    this.stop= function(){
        if(this.watchdog_flag){
            clearTimeout(this.watchdog_flag);
            this.watchdog_flag=undefined;
        }
    };

    this.reset = function(){
        if(this.watchdog_flag){
            clearTimeout(this.watchdog_flag);
            this.watchdog_flag=setTimeout(watchdog_exit,watchdog_timeout);
        }
    };
}

var getClientAddress = function (req) {
        return (req.headers['x-forwarded-for'] || '').split(',')[0]
        || req.connection.remoteAddress;
};

var isANumber = function(n) {
    try {
        var n = Number(n);
        return n == n;
    } catch(e) {
        return false;
    }
}

var mm2in = function(mm) {
  return mm/25.4;
}

var in2mm = function(inch) {
  return inch*25.4;
}

var unitType = function(u) {
  u = String(u).trim().toLowerCase()
  switch(u) {
    case '0':
    case 'in':
      return 'in';
      break;
    case '1':
    case 'mm':
      return 'mm';
      break;
    default:
      throw new Error('Invalid unit type specifier: ' + u);
      break;
  }
}



function LineNumberer(options) {
  // allow use without new
  if (!(this instanceof LineNumberer)) {
    return new LineNumberer(options);
  }
  this.count = 0;
  // init Transform
  stream.Transform.call(this, options);
}
util.inherits(LineNumberer, stream.Transform);



LineNumberer.prototype._transform = function(chunk, enc, next) {
  var data = chunk.toString();
  if (this._lastLineData) { data = this._lastLineData + data; }

  var lines = data.split('\n');
  this._lastLineData = lines.splice(lines.length-1,1)[0];
  block = []
  for(var i=0; i<lines.length; i++) {
    this.count += 1;
    //this.push("N" + this.count + " " + lines[i] + '\n');
    block.push("N" + this.count + " " + lines[i]);
  }

  this.push(block.join('\n'))
  next();
};

LineNumberer.prototype._flush = function(done) {
  if (this._lastLineData) { this.push(this._lastLineData); }
  this._lastLineData = null;
  done();
};

var countLineNumbers = function(filename, callback) {
    var i;
    var lines = 0;
    require('fs').createReadStream(filename)
      .on('data', function(chunk) {
        for (i=0; i < chunk.length; ++i)
          if (chunk[i] == 10) lines++;
      })
      .on('end', function() {
        callback(null, lines)
      });
}

exports.countLineNumbers = countLineNumbers;
exports.LineNumberer = LineNumberer;


exports.serveStatic = serveStatic;
exports.Queue = Queue;
exports.Watchdog = Watchdog;
exports.allowed_file = allowed_file;
exports.allowedAppFile = allowedAppFile;
exports.move = move;
exports.walkDir = walkDir;
exports.createUniqueFilename = createUniqueFilename;
exports.fixJSON = fixJSON;
exports.extend = extend;
exports.doshell = doshell;
exports.getClientAddress = getClientAddress;
exports.isANumber = isANumber;
exports.in2mm = in2mm;
exports.mm2in = mm2in;
exports.unitType = unitType;
