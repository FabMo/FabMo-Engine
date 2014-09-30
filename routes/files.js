var path = require('path');
var fs = require('fs');
var machine = require('../machine').machine;
var config = require('../config');
var db = require('../db');
var File=db.File;

// *TODO:* This is defined in two places, we should fix that.
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];

function allowed_file(filename){
	if (ALLOWED_EXTENSIONS.indexOf(path.extname(filename).toLowerCase()) !== -1)
	{
		return true;
	}
	else {
		return false;
	}
};

get_files = function(req, res, next) {
	File.list_all(function(result){
		res.json({'files':result});
	});
};

upload_file = function(req, res, next) {
	var file = req.files.file;
	if(file && allowed_file(file.name))
	{
		var filename=file.name;
		var full_path = path.join(config.engine.getPartsDir(), filename);
		fs.rename(file.path, full_path, function(err) {
			if (err){
				throw err;
			}
			// delete the temporary file, so that the explicitly set temporary upload dir does not get filled with unwanted files
			fs.unlink(file.path, function() {
				if (err) {throw err;}
				new File(filename, full_path).save(function(file){
				res.send(302,file); // file saved
			}); //save in db
				
			});
		});
	}
	else if (file){
	res.send(415); // wrong format
	}
	else{
	res.send(400);// problem reciving the file (bad request)	
	}
};

delete_file = function(req, res, next) {
	console.log('Deleting file');
	File.get_by_id(req.params.id,function(file){
		if(file)
		{
			fs.unlink(file.path, function(){ //delete file on hdd
				file.delete(function(){res.send(204);}); // delete file in db
				
			});
		}
		else
		{
			console.log("file not found ! cannot delete");
			res.send(404);
		}
	});
	
};


download_file = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){res.send(404);return;}
		console.log('Downloading file');
		fs.readFile((file.path),function (err, data){
			if (err) throw err;
			res.header('Content-Description','File Transfer');
			res.header('Content-Type','application/octet-stream');
			res.header('Content-Disposition','attachment; filename='+file.filename);
			res.header('Content-Transfer-Encoding','binary');
			res.header('Expires', 0);
			res.header('Cache-Control','must-revalidate, post-check=0, pre-check=0');
			res.header('Pragma','public');
			res.header('Content-Length', file.size);
			res.header('Location', req.headers['referer']);	
			res.send(data.toString());
		});
	});
	
};


view_file = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){res.send(404);return;}
		console.log('Downloading file');
		fs.readFile((file.path),function (err, data){
			if (err) throw err;
			res.header('Content-Type','text/plain');
			res.header('Content-Length', file.size);
			res.header('Location', req.headers['referer']);	
			res.send(data.toString());
		});
	});
	
};


module.exports = function(server) {
	server.get('/file', get_files); //OK
	server.post('/file',upload_file); //OK
	server.del('/file/:id',delete_file); //OK
	server.get('/file/:id',download_file); //OK
	server.get('/file/:id/view',view_file); //OK
}
