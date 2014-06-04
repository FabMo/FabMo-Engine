var path = require('path');
var fs = require('fs');
var machine = require('./machine');

upload_folder = '/opt/shopbot/parts';
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];
var fileinfo;

function allowed_file(filename){
	if (ALLOWED_EXTENSIONS.indexOf(path.extname(filename)) !== -1)
	{
		return true;
	}
	else
	{
		return false;
	}
};

exports.get_files = function(req, res, next) {
	fs.readdir(upload_folder, function(err, files){
		if (err){ throw err;}
		var filearray = {};
		for(var file in files)
		{		
			filearray[files[file]]=file; // transmit an array of object {filename : index} 
		}
		res.json({'files':filearray});
});
};

exports.upload_file = function(req, res, next) {
	var file = req.files.file;
    if(file && allowed_file(file.name))
    {
    	var filename=file.name;
    	console.log("Saving: " + filename);
       	var full_path = path.join(upload_folder, filename);
       	fs.rename(file.path, full_path, function(err) {
       		if (err){
       			throw err;
       		}
        	// delete the temporary file, so that the explicitly set temporary upload dir does not get filled with unwanted files
        	fs.unlink(file.path, function() {
        		if (err) {throw err;}
        		fileinfo = {'name':filename, 'time':Date.now(), 'full_path':full_path};
        		console.log("referer : "+ req.headers['referer']);
			res.header('Location', req.headers['referer']);
        		res.send(302);
        	});
        });
    }
};
