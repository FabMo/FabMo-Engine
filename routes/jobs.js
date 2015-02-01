var db = require('../db');
var path = require('path');
var config = require('../config');
var util = require('../util');
var log = require('../log').logger('routes');
var machine = require('../machine').machine;
var fs = require('fs');

submitJob = function(req, res, next) {

	// Get the one and only one file you're currently allowed to upload at a time
	var file = req.files.file;

	// Only write "allowed files"
	if(file && util.allowed_file(file.name))
	{
		// Keep the name of the file uploaded (but put it in the parts directory)
		var filename=file.name;
		var full_path = path.join(config.getDataDir('files'), filename);
		
		util.move(file.path, full_path, function(err) {
			if (err) { throw err; }
			// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
			fs.unlink(file.path, function(err) {
				//if (err) {throw err;}
				var file = new db.File(filename, full_path);
				file.save(function(file){
					
					log.info('Saved a file');
					try {
						var job = new db.Job({
							file_id : file._id,
							name : req.body.name || filename,
							description : req.body.description
						});
					} catch(e) {
						console.log(e);
					}
					log.info('Created a job');
					job.save(function(err, job) {
						if(err) {
							log.error(err);
							res.send(500, err);
						} else {
							res.send(200, job);
						}
					}); // job.save

				//res.send(302,file); // file saved
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

/**
 * @api {delete} /jobs/queue Clear job queue
 * @apiGroup Jobs
 */
clearQueue = function(req, res, next) {
	db.Job.deletePending(function(err) {
		if(err) {
			res.send(500, err);
		} else {
			res.send(200, {});
		}
	});
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/queue/run Run next job in queue
 * @apiDescription Runs the next job in the queue if able.
 */
runNextJob = function(req, res, next) {
	machine.runNextJob(function(err, job) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, job);
		}
	});
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/:id Resubmit job
 * @apiDescription Submit a new job identical to the one specified.  Used to re-run completed jobs without modification.
 * @apiParam {String} id ID of job to resubmit
 */
resubmitJob = function(req, res, next) {
	log.debug("Resubmitting job " + req.params.id);
	db.Job.getById(req.params.id, function(err, result) {
		log.debug(result);
		if(err) {
			log.error(JSON.stringify(err));
		}
		result.clone(function(err, result) {
			log.debug("Cloned!");
			if(err) {
				log.error(err);
				res.send(404, err);
			} else {
				res.send(200, result);
			}
		});
	});
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/queue Job queue
 * @apiDescription Get all the pending jobs currently in the queue
 */
getQueue = function(req, res, next) {
	db.Job.getPending(function(err, result) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, result);
		}
	});
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs List all jobs
 * @apiDescription Get a list of all jobs, including those that are pending, currently running, and finished.
 * @apiSuccess {Object[]} jobs List of all jobs
 * @apiSuccess {Number} jobs._id Unique job ID
 * @apiSuccess {String} jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} jobs.name Human readable job name
 * @apiSuccess {String} jobs.description Job description
 * @apiSuccess {Number} jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} jobs.finished_at Time job was finished (UNIX timestamp)
 */
getAllJobs = function(req, res, next) {
	db.Job.getAll(function(err, result) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, result);
		}
	});
};

getJobHistory = function(req, res, next) {
	db.Job.getHistory(function(err, result) {
		if(err) {
			log.error(err);
			res.send(500, err);
		} else {
			res.send(200, result);
		}
	});
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/:id Job info
 * @apiDescription Get information about a specific job
 * @apiParam {String} id ID of requested job
 * @apiSuccess {Number} _id Unique job ID
 * @apiSuccess {String} state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} name Human readable job name
 * @apiSuccess {String} description Job description
 * @apiSuccess {Number} created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} finished_at Time job was finished (UNIX timestamp)
 */
getJobById = function(req, res, next) {
	db.Job.getById(req.params.id, function(err, result) {
		if(err) {
			log.error(err);
			res.send(404, err);
		} else {
			res.send(200, result);
		}
	});
};

/**
 * @apiGroup Jobs
 * @api {delete} /jobs/:id Cancel job
 * @apiDescription Cancel a pending job
 * @apiParam {String} id ID of job to cancel
 */
cancelJob = function(req, res, next) {
	db.Job.getById(req.params.id, function(err, result) {
		if(err) {
			log.error(err);
			res.send(404, err);
		} else {
			result.cancel(function(err, result) {
				if(err) {
					log.error(err);
					res.send(500, err);
				} else {
					res.send(200, result);
				}
			});
		}
	});
};


module.exports = function(server) {
	server.post('/job', submitJob);
	server.get('/jobs', getAllJobs);
	
	server.get('/job/:id', getJobById);
	server.post('/job/:id', resubmitJob);
	server.get('/jobs/queue', getQueue);
	server.del('/jobs/queue', clearQueue);
	server.post('/jobs/queue/run', runNextJob);
	server.get('/jobs/history', getJobHistory);

};
