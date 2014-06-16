var Engine = require('tingodb')(),
    assert = require('assert');
var fs = require('fs');
var db = new Engine.Db('/opt/shopbot/db', {}); // be sure that the directory exist !
var crypto = require('crypto'); // for the checksum
var util = require('util');
var files = db.collection("files");


/************* FILE CLASS ****************/
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

File.prototype.save = function(callback){
	var that = this;
	files.findOne({path: that.path},function(err,document){
	if (err){
       		throw err;
       	}
	else if(document){
		// update the current entry in the database instead of creating a new one.
		files.update({_id : document._id},that,function(){
					callback(that);
		});

	}
	else{
		files.insert(that, function(err,records){
			if(!err)
				callback(records[0]);
			else
				throw err;	
		});

	}
	});
}

File.prototype.delete = function(callback){
	files.remove({_id : this._id},function(err){if(!err)callback();else callback(err);});

}

File.prototype.saverun = function(){
	files.update({_id : this._id}, {$set : {last_run : Date.now()}, $inc : {run_count:1}});
}

File.list_all = function(callback){
	files.find().toArray(function(err,result){
		if (err){
       			throw err;
       		}
		callback(result);});
}

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

