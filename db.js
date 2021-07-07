/*
 * db.js
 * 
 * Manages the Engine's internal database.  The database is implemented with tingodb
 * which is sort of a lightweight mongodb clone.  The database stores the following things:
 *   - file metadata (actual files contents are stored on disk)
 *   - job data
 *   - file thumbnails (currently unused)
 */
var assert = require('assert');
var async = require('async');
var fs = require('fs-extra');
var crypto = require('crypto');
var log = require('./log').logger('db');
var config = require('./config');
var util = require('./util');
var ncp = require('ncp').ncp;
var process = require('process');
var cnctosvg = require("cnctosvg");


// Connect to TingoDB database that stores the files
// Confusingly called "Engine" but not to be confused with the FabMo engine
var Engine = require('tingodb')();

/*
 * Collections (each of these is like a table in the database)
 *      files: Files refer to individual files on disk, which are created when Jobs are submitted.
 *       jobs: A job represents a single "run" - many jobs can refer to the same file (repeat runs or submittals of the same actual file data)
 * thumbnails: Preview thumbnails are generated when files are uploaded and can be previewed in the frontend.  This feature needs work, and is not currently exposed.
 */
var files;
var jobs;
var thumbnails;

// maxStorage defines how much space all of the files can take up on disk before we start to prune the oldest ones.
var maxStorage = 500000000;
var totalSize = 0;

// This function sends an event over the websocket to inform the dashboard that something in the job queue or history has changed.
function notifyChange() {
	var machine = require('./machine').machine;
	if(machine) {
		machine.emit('change', 'jobs');
	}
}

/* Job object has all of the features described.
 *   file_id refers to objects in the File collection.  Each job has a file, which is the CNC data that is run for that job.
 *   states for jobs:
 *     'pending' - Job is in the queue
 *     'running' - Job is currently active (There are only one of these at a time)
 *     'finished' - Job completed with no errors
 *     'cancelled' - Job was cancelled by user intervention
 *     'failed' - Job failed due to error
 *     'trash' - Job is marked for deletion from the history
 */
Job = function(options) {
    this.file_id = options.file_id || null;
    this.name = options.name || "Untitled Job";
    this.description = options.description || "";
    this.created_at = Date.now();
    this.started_at = null;
    this.finished_at = null;
    this.state = "pending";
    this.order = options.order || null;
};

// Clone a job.  Used for re-running files, usually.
Job.prototype.clone = function(callback) {
	var job = new Job({
		file_id : this.file_id,
		name : this.name,
		description : this.description 
	});
	job.save(callback);
};

// TODO @brendan
Job.prototype.update_order = function (order, callback){
    log.info("Upating " + this._id ? this._id : '<volatile job>');
    this.order = order;
    this.save(callback);
};

// The functions below update the state of the job object in the database.
// Note that they don't *do* anything other than manage state.

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
	if(this.state === 'running') {
		log.debug("Cancelling running job id " + this._id);
		this.state = 'cancelled';
		this.finished_at = Date.now();
		this.save(callback);
	} else {
		setImmediate(callback, new Error('Cannot cancel a job that is ' + this.state));
	}
};

Job.prototype.trash = function(callback) {
	if(this.state !== 'running') {
		log.debug("Trashing job id " + this._id);
		this.state = 'trash';
		this.finished_at = Date.now();
		this.save(callback);
	} else {
		setImmediate(callback, new Error('Cannot trash a job that is ' + this.state));
	}
};

Job.prototype.cancelOrTrash = function(callback) {
	if(this.state === 'running') {
		this.cancel(callback);
	} else {
		this.trash(callback);
	}
}

// Write this job to the database
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
		notifyChange();
		callback(null, this);
	}.bind(this));
};

// Remove this job from the database entirely (careful!)
Job.prototype.delete = function(callback){
	jobs.remove({_id : this._id},function(err){
		if(err) {
			callback(err)
		} else {
			callback();
			notifyChange();
		}
	});
};

// The functions below are for retrieving jobs from the database.
// They do not modify any information in the database

Job.getPending = function(callback) {
	jobs.find({state:'pending'}).toArray(callback);
};

Job.getRunning = function(callback) {
	jobs.find({state:'running'}).toArray(callback);
};

/*
 * Retrieve the "history" which includes jobs that are in one of the completed states; finished, cancelled, or failed
 * options:
 *   - start : The starting index for retrieval.
 *   - count : The number of files to retrieve from the history (sorted by creation date)
 * 
 * example: 
 *    getHistory({count : 10})  will retrieve the 10 most recent jobs in the history. (Ordered by creation date)
 *    getHistory({start : 10, count : 5}) will retrieve 5 jobs from the history, starting with the tenth one. 
 */
Job.getHistory = function(options, callback) {
	var total = jobs.count({
		state: {$in : ['finished', 'cancelled', 'failed']}
	}, function(err, total) {
		if(err) { return callback(err); }
		jobs.find({
			state: {$in : ['finished', 'cancelled', 'failed']}
		}).skip(parseInt(options.start) || 0).limit(parseInt(options.count) || 0).sort({'created_at' : -1 }).toArray(function(err, data) {
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

/*
 * Get every single job regardless of state, etc.
 * (careful, this might be a big list)
 */
Job.getAll = function(callback) {
	jobs.find().toArray(function(err, array) {
		if(err){
			throw err
		} else {
			callback(array);
		}

	});
};

/*
 * Given a job ID, retrieve the file object.
 * This returns file metadata only.  It is does not return the actual file on disk
 */
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

Job.getById = function(id,callback) {
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

// Return the next job in the queue (the one that will run next if a start job command is recieved)
Job.getNext = function(callback) {
	jobs.find({state:'pending'}).toArray(function(err, result) {
        result.sort(function(a, b){
            return a.order - b.order;
        });
        log.info('printing' + result[0]);
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

// Dequeue the next job to run it (mark it as started, taking it out of the queue)
Job.dequeue = function(callback) {
	Job.getNext(function(err, job) {
		if(err) {
			callback(err);
		} else {
			job.start(callback);
		}
	});
};

// Remove all jobs in the queue
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
		util.getSize(that.path, function(err, size){
			if(err){
				log.warn('file has no size');
			} else {
				that.size = size;

				files.insert(that, function(err,records){
					if(!err) {
						callback(null, records[0]);
						backupDB(callback);
						totalSize += records[0].size;
					}
					else {
						callback(err);
					}
				});
			}

		});

	}
	});
};

// Delete this file (and associated thumbnail) from the database
File.prototype.delete = function(callback){
	files.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
	thumbnails.remove({file_id : this._id},function(err){if(!err)callback();else callback(err);});
};

// Delete this file, and every job in the history that refers to it.
File.obliterate = function(file, callback){
	var id = file._id
	fs.remove(file.path, function(err){
		if (err){
			callback(err);
		} else {
			files.remove({_id : id},function(err){
				if(err) {
					callback(err);
				} else {
					jobs.remove({file_id : id},function(err) {
						if(err){
							callback(err);
						} else {
							callback(null, 'Obliterated' + file.filename);
						}
					});
				}
			});
		}
	});
	
	// TODO: figure out why this is commented out - if we obliterate a file, we should probably trash its thumbnail, yeah?
	//thumbnails.remove({file_id : id},function(err){if(!err)callback();else callback(err);});

}

// TODO Update docs 
File.clearTrash = function(callback){
	var toTrash = [];
	files.find().toArray(function(err, files){
		Job.getAll (function(jobs){
			for (var j = 0; j < files.length -1; j++) {
				var keepFile = false;
				for(var i = 0; i < jobs.length -1; i++) {
					if(jobs[i].state !== 'trash' && parseInt(files[j]._id) === parseInt(jobs[i].file_id))  {
						keepFile = true;
						break
					}
				}
				if (!keepFile){
					toTrash.push(files[j]);
				}
			}
			async.each(toTrash, function(_file, callback){
				File.obliterate(_file, function(err, msg){
					if(err){
						throw err;
					} else {
						totalSize -= _file.size;
						callback();
					}
				})
			

			});

			});
	
		
	});
	callback(null);
}

// Retrieve the total size of all files on disk (used to determine how much to prune if we hit max file size)
File.getTotalFileSize = function(callback){
	files.find().toArray(function(err,result){
		if(err) {
			log.warn(err);
		} else {
			result.forEach(function(file){
				if(file.size === undefined){
					var size2b =  new Promise( function(resolve, reject) {
						util.getSize(file.path, function(err, fileSize){
							resolve(fileSize);
						});
					});
					size2b.then(function(val){
						files.update({_id : file._id}, {$set : {size : val}});	
						totalSize += val;
					});
				} else {
					totalSize += file.size;
				}

			});
		}
	});

};

// Update the "last run" time (use the current time)
File.prototype.saverun = function(){
	files.update({_id : this._id}, {$set : {last_run : Date.now()}, $inc : {run_count:1}});
};


File.writeToDisk = function(pathname, full_path, friendly_filename, hash, callback){
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
			//set off async file size update
		}.bind(this)); // unlink
	}); // move
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
				util.getSize(pathname, function(err, size){
					if(err){
						log.error(err)
					} else {
						if(size + totalSize > maxStorage ) {
							File.clearTrash(function(err){
								if(err){
									throw err
								} else {
									log.info('done with trash');
									File.writeToDisk(pathname, full_path, friendly_filename, hash, function(err, file){

										if(err){
											throw err;
										} else {
											callback(null, file);
										}
									})
								}
							})
						} else {
							File.writeToDisk(pathname, full_path, friendly_filename, hash, function(err, file){
								if(err){
									throw err;
								} else {
									callback(null, file);
								}
							})
						}
					}
				}.bind(this));//check size 
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
		Job.getPending(function(err, data){
			if(err){
				log.info(err);
			} else {
				var order = (data.length + options.index);
				try {
					var job = new Job({
						file_id : dbfile._id,
						name : options.name || file.name,
						description : options.description,
						order : order
					});
				} catch(e) {
					log.error(e);
					return callback(e);
				}
				job.save(function(err, job) {
					if(err) { return callback(err); }
					callback(null, job);
				});
			}
		})
    });
}

// Creates a new Thumbnail which represents the thumbnails stored in the
// database. Thumbnails are 2D representation of the path a file is describing
// (in G-Code or OpenSBP).
//
// @param {Document} [thumbnailDocument] - The thumbnail stored in the database.
Thumbnail = function(thumbnailDocument) {
    if(thumbnailDocument) {
        this.file_id = thumbnailDocument.file_id;
        this.version = thumbnailDocument.version;
        this.image = thumbnailDocument.image;
    } else {
        this.file_id = "";
        this.version = 0;
        this.image = "";
    }
}

// Checks if needs update.
// @return {boolean} If needs update.
Thumbnail.prototype.needUpdate = function() {
    return this.version < cnctosvg.VERSION;
};

// Updates the thumbnail in the database.
// @param {function} callback({Error} err, {Thumbnail} thumbnail): if err is
//   not null, thumbnail is old one else new one
Thumbnail.prototype.update = function(callback) {
    var that = this;

    File.getByID(that.file_id, function(err, file) {
        if(err) {
            callback(new Error("Cannot find file with id = " + that.file_id), that);
            return;
        }
        var machine = require('./machine').machine;
        machine.getGCodeForFile(file.path, function(err, gcode) {
            if(err) {
                callback(new Error("Cannot find G-Code for file with id = " + fileId), that);
                return;
            }
            var gcodeString = gcode.toString("utf8");
            var modifications = {
                "image" : Thumbnail.createImage(gcodeString, file.filename),
                "version" : cnctosvg.VERSION
            };
            var query = { "file_id" : that.file_id };
            thumbnails.update(query, modifications, function(err, thumbnail) {
                if(err) {
                    callback(new Error("Cannot update thumbnail with file_id = " + that.file_id), that);
                    return;
                }
                that.image = modifications.image;
                that.version = modifications.version;
                callback(null, that);
            });
        });
    });
};

// Checks if needs update and returns himself to callback (the new or old
// version)
// @param {function} callback({boolean} err, {Thumbnail} thumbnail): err is
//   always false, thumbnail is old one or news one
Thumbnail.prototype.checkUpdateAndReturn = function(callback) {
    var that = this;
    if(that.needUpdate()) {
        that.update(function(err, thumbnail) {
            callback(false, thumbnail);
        });
    } else {
        callback(false, that);
    }
};

// Creates image but does not add a thumbnail into the database
// @param {string} gcode
// @param {string} title
// @return {string} the image
Thumbnail.createImage = function(gcode, title) {
    var colors = { G1 : "#000000", G2G3 : "#000000" };
    var width = 100;
    var height = 100;
    var lineThickness = 2;
    return cnctosvg.createSVG(gcode, colors, title, width, height, lineThickness, true);
};

// Generates the thumbnail and insert it in the database
// @param {function} callback({Error} err, {Thumbnail} thumbnail): if err is
//   not null, thumbnail is undefined else new one
Thumbnail.generate = function(fileId, callback) {
    thumbnails.findOne({ "file_id" : fileId }, function(err, thumbnail) {
        if(!err && thumbnail) {
            new Thumbnail(thumbnail).checkUpdateAndReturn(callback);
            return;
        }
        File.getByID(fileId, function(err, file) {
            if(err) {
                callback(new Error("Cannot find file with id = " + fileId));
                return;
            }
            var machine = require('./machine').machine;
            machine.getGCodeForFile(file.path, function(err, gcode) {
                if(err) {
                    callback(new Error("Cannot find G-Code for file with id = " + fileId));
                    return;
                }
                var gcodeString = gcode.toString("utf8");
                var newThumbnail = new Thumbnail();
                newThumbnail.file_id = fileId;
                newThumbnail.version = cnctosvg.VERSION;
                newThumbnail.image = Thumbnail.createImage(gcodeString, file.filename);
                thumbnails.insert(newThumbnail, function(err, records) {
                    if(err) {
                        callback(new Error("Cannot insert thumbnail in database"));
                    } else {
                        callback(null, newThumbnail);
                    }
                });
            });
        });
    });
};

// Get the thumbnail, if no thumbnail in database: try to make one and return it
// @param {function} callback({Error} err, {Thumbnail} thumbnail): if err is
//   not null, thumbnail is undefined else the found one
Thumbnail.getFromFileId = function(fileId, callback) {
    thumbnails.findOne({ "file_id" : fileId }, function(err, thumbnail) {
        if(err) {
            callback(new Error("Cannot find thumbnail with file_id = " + fileId));
            return;
        }
        if(!thumbnail) {
            Thumbnail.generate(fileId, callback);
        } else {
            new Thumbnail(thumbnail).checkUpdateAndReturn(callback);
        }
    });
};

// Get the thumbnail, if no thumbnail in database: try to make one and return it
// @param {function} callback({Error} err, {Thumbnail} thumbnail): if err is
//   not null, thumbnail is undefined else the found one
Thumbnail.getFromJobId = function(jobId, callback) {
    Job.getById(jobId, function(err, job) {
        if(err || !job) {
            callback(new Error("Cannot find job with id = " + jobId));
        } else {
            Thumbnail.getFromFileId(job.file_id, callback);
        }
    });
}

function isDirectory(path, callback){
	fs.stat(path,function(err,stats){
		if(err) callback(undefined);
		else callback(stats.isDirectory());
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
	dest = config.getDataDir('backup') + '/db/'
	isDirectory(dest, function(isdir) {
			if(!isdir) {
				//Replace with new copy of DB
				log.info('No existing backup. Making one now');
				ncp(src, dest, function(err) {
					if (err){
						log.error('Could not remove backup because '+err);
					} else {
						log.info('Backed up to '+dest);
					}
				});
			} else {
				// Remove old copy of the backup if it exists
				fs.remove(dest, function (err) {
					if(err) {
						log.error('Could not remove backup because '+err);
					} else {
						log.info('Removed old copy of backup');
						//Replace with new copy of DB
						ncp(src, dest, function(err) {
							if (err){
								log.error('Could not remove backup because '+err);
							} else {
								log.info('Backed up to '+dest);
							}
						});
					}
				});
			}
	});
	
	
}

reConfig = function(callback){
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");
	thumbnails = db.collection("thumbnails");

	async.parallel([
			function(cb) {
				checkCollection(users, cb);
			},
			function(cb) {
				checkCollection(files, cb);
			},
			function(cb) {
				checkCollection(jobs, cb);
			},
			function(cb) {
				checkCollection(thumbnails, cb);
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
								// TODO: More helpful logging
								log.debug('Everythign is terrible shutting down');
								process.exit(1);

							}
						});
					}
				});
			} else {
				log.info("Databases are clean. Reconfig Success");
				callback(null);
				
			}
			
	});

}

exports.configureDB = function(callback) {
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");
	thumbnails = db.collection("thumbnails");

	

	async.parallel([
			function(cb) {
				checkCollection(files, cb);
			},
			function(cb) {
				checkCollection(jobs, cb);
			},
			function(cb) {
				checkCollection(thumbnails, cb);
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
								log.debug('The corrupted database has been deleted.  Inserting Backup and re-config');
								//process.exit(1);
								src = config.getDataDir('backup/db');
								dest = config.getDataDir('db');
								
								ncp(src, dest, function (err) {
									if(err) {
										log.error('The backup could not be copied engine shutting down because ' + err);
										process.exit(1);
									} else {
										log.debug('Backup copied over re-trying config');
										reConfig(callback);
									}		
								})

							}
						});
					}
				});
			} else {
				log.info("Databases are clean.");
				callback(null);
				backupDB(callback);
				
			}
		});
		File.getTotalFileSize();
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
exports.Thumbnail = Thumbnail;
exports.createJob = createJob;
