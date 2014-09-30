var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto'); // for the checksum
var log = require('./log').logger('files');
var config = require('./config');

// Connect to TingoDB database that stores the files
var Engine = require('tingodb')()
var db = new Engine.Db(config.engine.getDBDir(), {}); // be sure that the directory exist !
var files = db.collection("files");

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
	    that.checksum =  crypto.createHash('md5').update(data, 'utf8').digest('hex');	
	});
}

// Save information about this file to back to the database
File.prototype.save = function(callback){
	var that = this;
	files.findOne({path: that.path},function(err,document){
	if (err){
       		throw err;
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
		callback(result);});
}

// Return a file object for the provided id
File.get_by_id = function(id,callback)
{
	files.findOne({_id: id},function(err,document){
		if (!document){
       			callback(undefined);
			return;
       		}
		var file = document;
		file.__proto__ = File.prototype;
    		callback(file);
	});
}

exports.File = File;
/*****************************************/

