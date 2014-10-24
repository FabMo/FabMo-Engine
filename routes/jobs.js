var db = require('../db');
var path = require('path');
var config = require('../config');
var allowed_file = require('../util').allowed_file;
var log = require('../log').logger('routes');
var machine = require('../machine').machine

submitJob = function(req, res, next) {

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
			if (err) {
				throw err;
			}
			// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
			fs.unlink(file.path, function() {
				if (err) {throw err;}
				var file = new db.File(filename, full_path)

				// save the file, and if successful, create a job to go with it
				file.save(function(file){
					var job = new db.Job({file_id : file._id});
					job.save(function(err, job) {
						if(err) {
							res.send(500, err);
						} else {
							res.send(200, job);
						}
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

clearQueue = function(req, res, next) {
	log.info("Clearing the job queue");
	db.Job.deletePending(function(err) {
		if(err) {
			res.send(500, err);
		} else {
			res.send(200, {});
		}
	});
}

runNextJob = function(req, res, next) {
	log.info("runNextJob")
	machine.runNextJob(function(err, job) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, job);
		}
	});
}

getQueue = function(req, res, next) {
	db.Job.getPending(function(err, result) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, result);
		}
	})
}

getAllJobs = function(req, res, next) {
	db.Job.getAll(function(err, result) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, result);
		}
	})
}

getJobById = function(req, res, next) {
	db.Job.getById(req.params.id, function(err, result) {
		if(err) {
			log.error(err);
			res.send(404, err);
		} else {
			res.send(200, result);
		}
	})
}


module.exports = function(server) {
	server.post('/job', submitJob);
	server.get('/jobs', getAllJobs);
	server.get('/job/:id', getJobById);
	server.get('/jobs/queue', getQueue);
	server.del('/jobs/queue', clearQueue);
	server.post('/jobs/queue/run', runNextJob);

}