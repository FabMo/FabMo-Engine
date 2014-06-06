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

File.prototype.save = function(){
	files.insert(this);
}

File.prototype.delete = function(){
	files.remove({_id : this._id});
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
		if (err){
       			throw err;
       		}
		var file = document;
		file.__proto__ = File.prototype;
    		callback(file);
	});
}

exports.File = File;
/*****************************************/

