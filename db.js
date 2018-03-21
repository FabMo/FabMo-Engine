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
var Engine = require('tingodb')();

job_queue = new util.Queue();

var db;
var files;
var jobs;
var users;
var thumbnails;

var maxStorage = 500000000;
var totalSize = 0;

function notifyChange() {
	var machine = require('./machine').machine;
	if(machine) {
		machine.emit('change', 'jobs');
	}
}

Job = function(options) {
    this.file_id = options.file_id || null;
    this.name = options.name || "Untitled Job";
    this.description = options.description || "";
    this.created_at = Date.now();
    this.started_at = null;
    this.finished_at = null;
    this.state = "pending";
    this.order = null;
};

Job.prototype.clone = function(callback) {
	var job = new Job({
		file_id : this.file_id,
		name : this.name,
		description : this.description 
	});
	job.save(callback);
};

Job.prototype.update_order = function (order, callback){
    log.info("Upating " + this._id ? this._id : '<volatile job>');
    this.order = order;
    this.save(callback);
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

Job.prototype.cancelOrTrash = function(callback) {
		if(this.state === 'running') {
			this.cancel(callback);
		} else {
			this.trash(callback);
		}
}

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

Job.getPending = function(callback) {
	jobs.find({state:'pending'}).toArray(callback);
};

Job.getRunning = function(callback) {
	jobs.find({state:'running'}).toArray(callback);
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
	jobs.find().toArray(function(err, array) {
		if(err){
			throw err
		} else {
			callback(array);
		}

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
	
	//thumbnails.remove({file_id : id},function(err){if(!err)callback();else callback(err);});

}

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

User = function(username,password,isAdmin,created_at,_id) {
	this._id = _id;
    this.username = username;
    this.password = password;
	this.isAdmin = isAdmin || false;
    this.created_at = created_at || Date.now();
};

User.prototype.validPassword= function(password){
	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex');

	if(pass_shasum === this.password){
		return true;
	}else if(password === this.password){
		return true;
	}else{
		return false;
	}
};

// Delete this user from the database
User.prototype.delete = function(callback){
	users.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
};

// verify user password and encrypt it.
User.verifyAndEncryptPassword = function(password,callback){
	if(!/^([a-zA-Z0-9@*#]{5,15})$/.test(password) ){ //validatepassword
		if(callback) callback('Password not valid, it should contain between 5 and 15 characters. The only special characters authorized are "@ * #".',null);
		return undefined;
	}
	var pass_shasum = crypto.createHash('sha256').update(password).digest('hex'); // save encrypted password
	if(callback)callback(null,pass_shasum);
	return pass_shasum;
};

// Grant user admin status
User.prototype.grantAdmin = function(callback){
	this.isAdmin = true;
	this.save(callback);
};

// Revoke user admin status
User.prototype.revokeAdmin = function(callback){
	this.isAdmin = false;
	this.save(callback);
};

User.prototype.save = function(callback){
	var user = this;
	users.save(user, function(err, record) {
		if(err){
			log.err(err);
			if(callback)callback(err,null);
			return;
		}
		if(!record) {
			if(callback)callback(err,null);
			return;
		}
		if(callback){
			backupDB(callback);
			callback(null, this);
		}
	}.bind(this));
};

User.add = function(username,password,callback){
	if(!/^([a-zA-Z0-9]{3,20})$/.test(username) ){ //validate username
		callback('Username not valid, it should contain between 3 and 20 characters. Special characters are not authorized.',null);
		return ;
	}
	User.verifyAndEncryptPassword(password,function(err,pass_shasum){
		if (err){callback(err,password);return ;}
		users.findOne({username:username},function(err,document) {
			if(document){
				callback('Username already taken !',null);
				return ;
			}else{
				user = new User(username,pass_shasum);
				user.save(callback);
				//callback(null,user);
				return ;
			}
		});
	})
}

User.findOne = function(username,callback){
	users.findOne({username:username},function(err,doc){
		if(err){console.log(err);callback(err,null);}
		if(doc){
			user = new User(doc.username,doc.password,doc.isAdmin,doc.created_at,doc._id);
			callback(err,user);
		}else{
			callback(err);
		}
	});
}

User.getAll = function(callback){
	users.find({},{password:0},function(err,cursor){ // do not returns passwords.
		if(err){console.log(err);callback(err,null);}
		if(cursor){
			var user_array = [];
			cursor.toArray(function(err,users){
				for(user in users){
						user_array.push(new User(users[user].username,users[user].password,users[user].isAdmin,users[user].created_at,users[user]._id));
				}
				callback(null,user_array);
			});
		}else{
			callback(err);
		}
	});
}

User.findById = function(id,callback){
	users.findOne({_id:id},function(err,doc){
		if(err){console.log(err);callback(err,null);return;}
		if(doc){
			user = new User(doc.username,doc.password,doc.isAdmin,doc.created_at,doc._id);
			callback(err,user);
			return;
		}else{
			callback("user doesn't exist!");
			return;
		}
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

checkUsers = function(users){
	users.find({}).toArray(function(err,result){ //init the user database with an admin account if it's empty
		if (err){
			throw err;
		}
		if(result.length === 0 ){
			var pass_shasum = crypto.createHash('sha256').update("go2fabmo").digest('hex');
			user = new User("admin",pass_shasum,true);
			user.save();
		}
	});
}

reConfig = function(callback){
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");
	users = db.collection("users");
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
								log.debug('Everythign is terrible shutting down');
								process.exit(1);

							}
						});
					}
				});
			} else {
				checkUsers(users);
				log.info("Databases are clean. Reconfig Success");
				callback(null);
				
			}
			
	});

}

exports.configureDB = function(callback) {
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");
	users = db.collection("users");
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
				checkUsers(users);
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
exports.User = User;
exports.Thumbnail = Thumbnail;
exports.createJob = createJob;
