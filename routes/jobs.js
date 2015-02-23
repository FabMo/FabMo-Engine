var db = require('../db');
var path = require('path');
var config = require('../config');
var util = require('../util');
var log = require('../log').logger('routes');
var machine = require('../machine').machine;
var fs = require('fs');
var uuid = require('node-uuid');

/**
 * @apiGroup Jobs
 * @api {post} /job Submit a job
 * @apiDescription Add a job to the queue
 */
var submitJob = function(req, res, next) {

    // Get the one and only one file you're currently allowed to upload at a time
    var file = req.files.file;
    var answer;

    // Only write "allowed files"
    if(file && util.allowed_file(file.name))
    {
        // Keep the name of the file uploaded for a "friendly name"
        var friendly_filename = file.name;

        // But create a unique name for actual storage
        var filename = util.createUniqueFilename(friendly_filename);
        var full_path = path.join(config.getDataDir('files'), filename);

        // Move the file
        util.move(file.path, full_path, function(err) {
            if (err) {
                answer = {
                    status:"error",
                    message:"failed to move the job from temporary folder to files folder"
                }; 
                return res.json(answer);
                //throw err; 
            }
            // delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
            fs.unlink(file.path, function(err) {
                
                if (err) {
                    log.warn("failed to remove the job from temporary folder: " + err)
                }

                var file = new db.File(friendly_filename, full_path)
                file.save(function(file){
                    
                    log.info('Saved a file: ' + file.filename + ' (' + file.full_path + ')');
                    var job;
                    try {
                        job = new db.Job({
                            file_id : file._id,
                            name : req.body.name || friendly_filename,
                            description : req.body.description
                        });
                    } catch(e) {
                        console.log(e);
                    }
                    log.info('Created a job.');
                    job.save(function(err, job) {
                        if(err) {
                            log.error(err);
                        answer = {
                                status:"error",
                                message:"failed to save the job in DB"
                            };
                            res.json(answer);
                        } else {
                        answer = {
                                status:"success",
                                data : {job:job}
                            };
                            res.json(answer);
                        }
                    }); // job.save
                }); // file.save
            }); // unlink
        }); // move
    } // if file and allowed
    else if (file){
        answer = {
            status:"fail",
            data : {"job" : "wrong format"}
        };
        res.json(answer);
    }
    else{
        answer = {
            status:"fail",
            data : {"job" : "problem receiving the job : bad request"}
        };
        res.json(answer);
    }
}; // submitJob

/**
 * @api {delete} /jobs/queue Clear job queue
 * @apiGroup Jobs
 */
var clearQueue = function(req, res, next) {
    var answer;
    db.Job.deletePending(function(err) {
        if(err) {
            answer = {
                status:"error",
                message:"failed to remove the job in DB"
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : null
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/queue/run Run next job in queue
 * @apiDescription Runs the next job in the queue if able.
 */
runNextJob = function(req, res, next) {
    var answer;
    log.info('Running the next job in the queue');
    machine.runNextJob(function(err, job) {
        if(err) {
            log.error(err);
            answer = {
                status:"failed",
                data:{job:"failed to run next job"}
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : {job:job}
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {post} /jobs/:id Resubmit job
 * @apiDescription Submit a new job identical to the one specified.  Used to re-run completed jobs without modification.
 * @apiParam {String} id ID of job to resubmit
 */
var resubmitJob = function(req, res, next) {
    var answer;
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
                answer = {
                    status:"failed",
                    data:{job:"job id not correct"}
                };
                res.json(answer);
            } else {
                answer = {
                    status:"success",
                    data : {job:result}
                };
                res.json(answer);
            }
        });
    });
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs/queue Job queue
 * @apiDescription Get all the pending jobs currently in the queue
 */
var getQueue = function(req, res, next) {
    var answer;
    db.Job.getPending(function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                status:"error",
                message:"failed to get jobs from DB"
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : {jobs:result}
            };
            res.json(answer);
        }
    });
}

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
var getAllJobs = function(req, res, next) {
    var answer;
    db.Job.getAll(function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                status:"error",
                message:"failed to get jobs from DB"
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : {jobs:result}
            };
            res.json(answer);
        }
    });
};

var getJobHistory = function(req, res, next) {
    var answer;
    db.Job.getHistory(function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                status:"error",
                message:"failed to get jobs from DB"
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : {jobs:result}
            };
            res.json(answer);
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
var getJobById = function(req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                    status:"failed",
                    data:{job:"job id not correct"}
            };
            res.json(answer);
        } else {
            answer = {
                status:"success",
                data : {job:result}
            };
            res.json(answer);
        }
    });
};

/**
 * @apiGroup Jobs
 * @api {delete} /jobs/:id Cancel job
 * @apiDescription Cancel a pending job
 * @apiParam {String} id ID of job to cancel
 */
var cancelJob = function(req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                    status:"failed",
                    data:{job:"job id not correct"}
            };
            res.json(answer);
        } else {
            result.cancel(function(err, result) {
                if(err) {
                    log.error(err);
                    answer = {
                            status:"failed",
                            data:{job:"failed to cancel the job"}
                    };
                    res.json(answer);
                } else {
                    answer = {
                        status:"success",
                        data : {job:result}
                    };
                    res.json(answer);
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
