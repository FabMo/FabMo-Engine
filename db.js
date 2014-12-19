var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto'); // for the checksum
var log = require('./log').logger('files');
var config = require('./config');
var util = require('./util');

// Connect to TingoDB database that stores the files
var Engine = require('tingodb')()

job_queue = new util.Queue()

var db;
var files;
var jobs;

Job = function(options) {
    this.file_id = options.file_id;
    this.name = options.name || "Untitled Job"
    this.description = options.description || "No description"
    this.created_at = Date.now();
    this.started_at = null;
    this.finished_at = null;
    this.state = "pending"
}

Job.prototype.start = function(callback) {
	log.info("Starting job id " + this._id)
	this.state = 'running';
	this.started_at = Date.now();
	this.save(callback);
}

Job.prototype.finish = function(callback) {
	log.info("Finishing job id " + this._id)
	this.state = 'finished';
	this.finished_at = Date.now();
	this.save(callback);
}

Job.prototype.save = function(callback) {
	jobs.findOne({_id: this._id}, function(err,document){
		if(err) {
			callback(err);
		}
		else if(document){
			// update the current entry in the database instead of creating a new one.
			log.info('Updating job id ' + document._id);
			jobs.update({'_id' : document._id},this,function(err){
				if(err) {
					callback(err);
				} else {
					callback(null, this);
				}
			}.bind(this));
		}
		else{
			// Create a new entry in the database
			log.info('Creating a new job.');
			jobs.insert(this, function(err,records){
				if(err) {
					callback(err, null);
				}
				else {
					// Return the newly created job
					callback(null, this);
				}
			}.bind(this));
		}
	}.bind(this));
}

Job.prototype.delete = function(callback){
	jobs.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
}

Job.getPending = function(callback) {
	jobs.find({state:'pending'}).toArray(callback);
}

Job.getHistory = function(callback) {
	jobs.find({state: {$in : ['finished', 'cancelled']}}).toArray(callback);
}

Job.getAll = function(callback) {
	jobs.find().toArray(function(array) {
		callback(array);
	});
}

// Return a file object for the provided id
Job.getById = function(id,callback)
{
	jobs.findOne({_id: id},function(err,document){
		if (!document){
			callback(undefined);
			return;
		}
		var job = document;
		job.__proto__ = Job.prototype;
		callback(job);
	});
}

Job.getNext = function(callback) {
	jobs.find({state:'pending'}).toArray(function(err, result) {
		if(err) {
			callback(err, null);
		} else {
			if(result.length === 0) {
				return callback(Error('No jobs in queue.'))
			}
			var job = result[0];
			job.__proto__ = Job.prototype
			callback(null, job);
		}
	});
}

Job.dequeue = function(callback) {
	Job.getNext(function(err, job) {
		if(err) {
			callback(err);
		} else {
			job.start(callback);
		}
	});
}

Job.deletePending = function(callback) {
	jobs.remove({state:'pending'},callback);
}

// The File class represents a fabrication file on disk
// In addition to the filename and path, file statistics such as 
// The run count, last time run, etc. are stored in the database.
function File(filename,path){
	var that=this;
	this.filename = filename;
	this.path = path;
	this.created = Date.now();
	this.last_run = null;
	this.run_count = 0;
	fs.stat(path, function(err, stat) {
	  	if(err) {
			throw err;
		}
	  	that.size = stat.size;
	});
	fs.readFile(this.path, function (err, data) {
		this.checksum = File.checksum(data);
	}.bind(this));
}

File.checksum = function(data) {
	return crypto.createHash('md5').update(data, 'utf8').digest('hex');
}

// Save information about this file to back to the database
File.prototype.save = function(callback){
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
			if(!err)
				callback(records[0]);
			else
				throw err;
		});
	}
	});
}

// Delete this file from the database
File.prototype.delete = function(callback){
	files.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});
}

// Update the "last run" time (use the current time)
File.prototype.saverun = function(){
	files.update({_id : this._id}, {$set : {last_run : Date.now()}, $inc : {run_count:1}});
}

// Return a list of all the files in the database
File.list_all = function(callback){
	files.find().toArray(function(err,result){
		if (err){
			throw err;
		}
		callback(result);
	});
}

// Return a file object for the provided id
File.get_by_id = function(id,callback)
{
	files.findOne({_id: id},function(err,document){
		if (!document) {
			callback(undefined);
			return;
		}
		var file = document;
		file.__proto__ = File.prototype;
		callback(file);
	});
}

exports.configureDB = function(callback) {
	db = new Engine.Db(config.getDataDir('db'), {});
	files = db.collection("files");
	jobs = db.collection("jobs");
	setImmediate(callback, null);
}

exports.File = File;
exports.Job = Job;

/*****************************************/

