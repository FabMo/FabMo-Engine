var path = require('path');
var fs = require('fs');
var machine = require('../machine').machine;
var config = require('../config');
var db = require('../db');
var File=db.File;
var util = require('../util');
var allowed_file = util.allowed_file;

/**
 * @apiGroup Files
 * @api {get} /file/ Get the list of files on the machine
 * @apiSuccess {Object[]} files the list of files
 * @apiSuccess {Integer} files.id id of a file
 * @apiSuccess {String} files.name name of a file
 */
get_files = function(req, res, next) {
	File.list_all(function(result){
		var answer = {
			status:"success",
			data : {files:result}
		};
		res.json(answer);
	});
};

upload_file = function(req, res, next) {
	// Get the one and only one file you're currently allowed to upload at a time
	var file = req.files.file;
	var answer;
	// Only write "allowed files"
	if(file && allowed_file(file.name))
	{
		// Keep the name of the file uploaded (but put it in the parts directory)
		var filename=file.name;
		var full_path = path.join(config.getDataDir('files'), filename);
		
		// Uploaded files are stored in a temporary directory (per restify)
		// Move the file from that path to the parts directory
		
		util.move(file.path, full_path, function(err) {
			if (err) {
				answer = {
					status:"error",
					message:"failed to move the file from temporary folder to files folder"
				}; 
				throw err; 
			}
			// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
			fs.unlink(file.path, function() {
				if (err) {
					answer = {
						status:"error",
						message:"failed to remove the file from temporary folder"
					}; 
					throw err; 
				}
				new File(filename, full_path).save(function(file){
				answer = {
					status:"success",
					data : {file:file}
				};
				res.json(answer);
			}); //save in db
				
			});
		});
	}
	else if (file){
		answer = {
			status:"fail",
			data : {file:"wrong format"}
		};
		res.json(answer);
	}
	else{
		answer = {
			status:"fail",
			data : {file:"problem receiving the file : bad request"}
		};
		res.json(answer);
	}
};

delete_file = function(req, res, next) {
	console.log('Deleting file');
	var answer;
	File.get_by_id(req.params.id,function(file){
		if(file)
		{
			fs.unlink(file.path, function(){ //delete file on hdd
				file.delete(function(){ // delete file in db
					answer = {
						status:"success",
						data : null
					};
					res.json(answer);
				}); 
				
			});
		}
		else
		{
			answer = {
				status:"fail",
				data : {file:"file not found ! cannot delete"}
			};
			res.json(answer);
		}
	});
	
};


download_file = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){
			answer = {
				status:"fail",
				data : {file:"file not found ! cannot delete"}
			};
			res.json(answer);
			return;
		}
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
			res.header('Location', req.headers.referer);	
			res.send(data.toString());
		});
	});
	
};


view_file = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){
			answer = {
				status:"fail",
				data : {file:"file not found ! cannot delete"}
			};
			res.json(answer);
			return;
		}
		console.log('Downloading file');
		fs.readFile((file.path),function (err, data){
			if (err){
				answer = {
					status:"fail",
					data : {file:"error while reading the file"}
				};
				res.json(answer);
				throw err;
			}
			res.header('Content-Type','text/plain');
			res.header('Content-Length', file.size);
			res.header('Location', req.headers.referer);	
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
};
