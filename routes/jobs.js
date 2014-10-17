var db = require('../db');
var path = require('path');
var allowed_file = require('../util').allowed_file;

submit_job = function(req, res, next) {

	// Get the one and only one file you're currently allowed to upload at a time
	var file = req.files.file;

	// Only write "allowed files"
	if(file && allowed_file(file.name))
	{
		// Keep the name of the file uploaded (but put it in the parts directory)
		var filename=file.name;
		var full_path = path.join(config.engine.getPartsDir(), filename);
		
		// Uploaded files are stored in a temporary directory (per restify)
		// Move the file from that path to the parts directory
		fs.rename(file.path, full_path, function(err) {
			if (err){
				throw err;
			}
			// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
			fs.unlink(file.path, function() {
				if (err) {throw err;}
				var file = new File(filename, full_path)
				
				file.save(function(file){
					var job = new db.Job({file_id : file._id});
					job.save(function(err, job) {
						res.send(302, file);
					}); // job.save
				}); // job.save
			}); // unlink 
		}); // rename
	}
	else if (file){
	res.send(415); // wrong format
	}
	else{
	res.send(400);// problem reciving the file (bad request)	
	}
};

module.exports = function(server) {
	server.post('/job', submit_job); //OK
}