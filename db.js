var assert = require('assert');
var fs = require('fs-extra');
var crypto = require('crypto');
var log = require('./log').logger('db');
var config = require('./config');
var util = require('./util');
var ncp = require('ncp').ncp;
var process = require('process');

// Connect to TingoDB database that stores the files
var Engine = require('tingodb')();

job_queue = new util.Queue();

var db;
var files;
var jobs;

Job = function(options) {
    this.file_id = options.file_id || null;
    this.name = options.name || "Untitled Job";
    this.description = options.description || "";
    this.created_at = Date.now();
    this.started_at = null;
    this.finished_at = null;
    this.state = "pending";
};

Job.prototype.clone = function(callback) {
	var job = new Job({
		file_id : this.file_id,
		name : this.name,
		description : this.description
	});
	job.save(callback);
};

Job.prototype.start = function(callback) {
	log.info("Starting job id " + this._id ? this._id : '<volatile job>');
	this.state = 'running';
	this.started_at = Date.now();
	this.save(callback);
};

Job.prototype.finish = function(callback) {
	log.info("Finishing job id " + this._id ? this._id : '<volatile job>');
	this.state = 'finished';
	this.finished_at = Date.now();
	this.save(callback);
};

Job.prototype.fail = function(callback) {
	log.info("Failing job id " + (this._id ? this._id : '<volatile job>'));
	this.state = 'failed';
	this.finished_at = Date.now();
	this.save(callback);
};

Job.prototype.cancel = function(callback) {
	if(this.state === 'pending' || this.state === 'running') {
		log.debug("Cancelling pending job id " + this._id);
		this.state = 'cancelled';
		this.finished_at = Date.now();
		this.save(callback);
	} else {
		setImmediate(callback, new Error('Cannot cancel a job that is ' + this.state));
	}
};

Job.prototype.save = function(callback) {
	if(!this.file_id) {
		log.info('Not saving this job because no file_id')
		return callback(null, this);
	}

	delete this.pending_cancel;

	jobs.save(this, function(err, record) {
		if(!record) {
			return;
		}
		callback(null, this);
	}.bind(this));
	
};

Job.prototype.delete = function(callback){
	jobs.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
};

Job.getPending = function(callback) {
	jobs.find({state:'pending'}).toArray(callback);
};

Job.getHistory = function(options, callback) {
	var total = jobs.count({
		state: {$in : ['finished', 'cancelled', 'failed']}
	}, function(err, total) {
		if(err) { return callback(err); }
		jobs.find({
			state: {$in : ['finished', 'cancelled', 'failed']}
		}).skip(options.start || 0).limit(options.count || 0).sort({'created_at' : -1 }).toArray(function(err, data) {
			if(err) {
				callback(err);
			}
			callback(null, {
				'total_count' : total,
				'data' : data
			});
		});
	});

};

Job.getAll = function(callback) {
	jobs.find().toArray(function(array) {
		callback(array);
	});
};

Job.getFileForJobId = function(id, callback) {
	Job.getById(id, function(err, document) {
		if(err) {
			callback(err);
		} else {
			if(document && document.file_id) {
				File.getByID(document.file_id, function(err, file) {
					if(err) {
						callback(err);
					} else {
						if(file) {
							callback(null, file);
						} else {
							callback(new Error("Could not find file in database."));
						}
					}
				});
			} else {
				callback(new Error("Could not find job in database."))
			}
		}
	});
}
// Return a file object for the provided id
Job.getById = function(id,callback)
{
	jobs.findOne({_id: id},function(err,document){
		if (!document){
			callback("No such job ID: " + id, undefined);
			return;
		}
		var job = document;
		job.__proto__ = Job.prototype;
		callback(null, job);
	});
};

Job.getNext = function(callback) {
	jobs.find({state:'pending'}).toArray(function(err, result) {
		if(err) {
			callback(err, null);
		} else {
			if(result.length === 0) {
				return callback(Error('No jobs in queue.'));
			}
			var job = result[0];
			job.__proto__ = Job.prototype;
			callback(null, job);
		}
	});
};

Job.dequeue = function(callback) {
	Job.getNext(function(err, job) {
		if(err) {
			callback(err);
		} else {
			job.start(callback);
		}
	});
};

Job.deletePending = function(callback) {
	jobs.remove({state:'pending'},callback);
};

// The File class represents a fabrication file on disk
// In addition to the filename and path, file statistics such as 
// The run count, last time run, etc. are stored in the database.
function File(filename,path, callback){
	var that=this;
	this.filename = filename;
	this.path = path;
	this.created = Date.now();
	this.last_run = null;
	this.run_count = 0;
	this.hash = null;
	fs.stat(path, function(err, stat) {
		if(err) {
			throw err;
		}
		that.size = stat.size;
	});
}

File.hash = function(path, callback) {
	var fd = fs.createReadStream(path);
	var hash = crypto.createHash('md5');
	hash.setEncoding('hex');
	fd.on('end', function() {
	    hash.end();
	    callback(null, hash.read())
	});
	fd.pipe(hash);
}

// Save information about this file to back to the database
File.prototype.save = function(callback) {
	var that = this;
	files.findOne({path: that.path},function(err,document){
	if (err){
		callback(err);
	}
	else if(document){
		// update the current entry in the database instead of creating a new one.
		log.info('Updating document id ' + document._id);
		files.update({_id : document._id},that,function(){
			callback(that);
		});
	}
	else{
		log.info('Creating a new document.');
		files.insert(that, function(err,records){
			if(!err) {
				callback(null, records[0]);
			}
			else {
				callback(err);
			}
		});
	}
	});
};

// Delete this file from the database
File.prototype.delete = function(callback){
	files.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
};

// Update the "last run" time (use the current time)
File.prototype.saverun = function(){
	files.update({_id : this._id}, {$set : {last_run : Date.now()}, $inc : {run_count:1}});
};

File.add = function(friendly_filename, pathname, callback) {
	// Create a unique name for actual storage
	var filename = util.createUniqueFilename(friendly_filename);
	var full_path = path.join(config.getDataDir('files'), filename);

	// Compute the hash for the file to be added
	File.hash(pathname, function(err, hash) {
		// Check to see if the hash is already found in the database
		files.findOne({hash:hash},function(err,document) {
			if(document) {
				log.info("Using file with hash of " + hash + " which already exists in the database.");
				var file = document;
				file.__proto__ = File.prototype;
				callback(null, file);
			} else {
				log.info("Saving a new file with a hash of " + hash + ".");
				// Move the file
				util.move(pathname, full_path, function(err) {
					if(err) {
						return callback(err);
					}
					// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
					fs.unlink(pathname, function(err) {
						if (err) {
							// Failure to delete the temporary file is bad, but non-fatal
							log.warn("failed to remove the job from temporary folder: " + err);
						}

						var file = new File(friendly_filename, full_path);
						file.hash = hash;
						file.save(function(err, file){
							if(err) {
								return callback(err);
							}
							log.info('Saved a file: ' + file.filename + ' (' + file.path + ')');
							callback(null, file)
						}.bind(this)); // save
					}.bind(this)); // unlink
				}); // move
			}
		});		
	})


} // add

// Return a list of all the files in the database
File.list_all = function(callback){
	files.find().toArray(function(err,result){
		if (err){
			throw err;
		}
		callback(result);
	});
};

// Return a file object for the provided id
File.getByID = function(id,callback)
{
	files.findOne({_id: id},function(err,document){
		if (!document) {
			callback(true, undefined);
			return;
		}
		var file = document;
		file.__proto__ = File.prototype;
		callback(null, file);
	});
};

// Given a file and metadata, create a new file and job in the database
// callback with the job object if success.
var createJob = function(file, options, callback) {
	File.add(options.filename || file.name, file.path, function(err, dbfile) {

	    if (err) { return callback(err); }

        try {
            var job = new Job({
                file_id : dbfile._id,
                name : options.name || file.name,
                description : options.description
            });
        } catch(e) {
        	log.error(e);
            return callback(e);
        }
        job.save(function(err, job) {
        	if(err) { return callback(err); }
        	callback(null, job);
        });
    });
}

checkCollection = function(collection, callback) {
	collection.find().toArray(function(err, data) {
		if(err) {
			log.error("Error reading " + collection.collectionName + " from the database: " + err);
			callback(err);
		} else {
			callback(null);
		}
	});
}

backupDB = function(callback) {
	src = config.getDataDir('db');
	dest = config.getDataDir('backup') + '/db'
	ncp(src, dest, function(err) {
		log.info('Backed up database to '+dest)
		callback(err);
	});
}

exports.configureDB = function(callback) {
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");

	async.parallel([
			function(cb) {
				checkCollection(files, cb);
			},
			function(cb) {
				checkCollection(jobs, cb);
			}
		], 
		function(err, results) {
			if(err) {
				log.error('There was a database corruption issue!')
				var src = config.getDataDir('db')
				var dest = config.getDataDir('debug') + '/bad-db-' + (new Date().getTime())
				ncp(src, dest, function (err) {
					if(err) {
						log.error('The database could not be successfully backed up: ' + err);
						callback(null);
					} else {
						log.debug('The database has been successfully copied to the debug directory for inspection.');
						fs.remove(src, function (err) {
							if(err) {
								log.error('Could not delete the corrupted database:' + err);
								callback(null);
							} else {
								log.debug('The corrupted database has been deleted.  Shutting down the engine...');
								process.exit(1);
							}
						});
					}
				});
			} else {
				log.info("Databases are clean.");
				callback(null);
			}
		});
};

exports.cleanup = function(callback) {
	jobs.update({state: 'running'}, {$set : {state:'failed', finished_at : Date.now()}}, {multi:true}, function(err, result) {
		if(err) {
			log.error('There was a problem cleaning the db: ' + err)
		} else {
			if(result > 1) {
				log.warn("Found more than one (" + result + ") running job in the db.  This is a database inconsistency!");
			} else if(result == 1) {
				log.info("Cleaned up a single failed job.");
			}
		}
	});
	setImmediate(callback, null);
};

exports.File = File;
exports.Job = Job;
exports.createJob = createJob;