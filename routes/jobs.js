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
 * @apiDescription Add a job to the job queue.
 * @apiParam {String} name Job name
 * @apiParam {String} description Job description
 * @apiParam {Object} file G-Code or OpenSBP file submission
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var submitJob = function(req, res, next) {

    // Get the one and only one file you're currently allowed to upload at a time
    var file = req.files.file;
    var answer;

    // Only write "allowed files"
    if(file && util.allowed_file(file.name))
    {
        db.File.add(file.name, file.path, function(err, dbfile) {
            if (err) {
                answer = {
                    status:"error",
                    message:err
                };
                return res.json(answer);
            }
            var job;
            try {
                job = new db.Job({
                    file_id : dbfile._id,
                    name : req.body.name || file.name,
                    description : req.body.description
                });
            } catch(e) {
                log.error(e);
            }

            log.info('Created a job.');
            job.save(function(err, job) {
                if(err) {
                    log.error(err);
                answer = {
                        status:"error",
                        message:err
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
        });
    } // if file and allowed
    else if (file){
        answer = {
            status:"fail",
            data : {"job" : "Wrong file format"}
        };
        res.json(answer);
    }
    else{
        answer = {
            status:"fail",
            data : {"job" : "Problem receiving the job : bad request"}
        };
        res.json(answer);
    }
}; // submitJob

/**
 * @api {delete} /jobs/queue Clear job queue
 * @apiGroup Jobs
 * @apiDescription Empty the job queue of all pending jobs.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var clearQueue = function(req, res, next) {
    var answer;
    db.Job.deletePending(function(err) {
        if(err) {
            answer = {
                status:"error",
                message:err
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
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
runNextJob = function(req, res, next) {
    var answer;
    log.info('Running the next job in the queue');
    machine.runNextJob(function(err, job) {
        if(err) {
            log.error(err);
            answer = {
                status:"failed",
                data:{job:err}
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
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
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
                    data:{job:err}
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
 * @apiDescription Get a list of all the pending jobs currently in the queue.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.jobs List of all jobs
 * @apiSuccess {Number} data.jobs._id Unique job ID
 * @apiSuccess {String} data.jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.jobs.name Human readable job name
 * @apiSuccess {String} data.jobs.description Job description
 * @apiSuccess {Number} data.jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
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
};

/**
 * @apiGroup Jobs
 * @api {get} /jobs List all jobs
 * @apiDescription Get a list of all jobs, including those that are pending, currently running, and finished.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object[]} data.jobs List of all jobs
 * @apiSuccess {Number} data.jobs._id Unique job ID
 * @apiSuccess {String} data.jobs.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.jobs.name Human readable job name
 * @apiSuccess {String} data.jobs.description Job description
 * @apiSuccess {Number} data.jobs.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.jobs.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
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
 * @apiDescription Get detailed information about a specific job.
 * @apiParam {String} id ID of requested job
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.job Requested job 
 * @apiSuccess {Number} data.job._id Unique job ID
 * @apiSuccess {String} data.job.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.job.name Human readable job name
 * @apiSuccess {String} data.job.description Job description
 * @apiSuccess {Number} data.job.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.job.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.job.finished_at Time job was finished (UNIX timestamp)
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var getJobById = function(req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                    status:"fail",
                    data:{job:err}
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


var deleteJobById = function(req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                    status:"fail",
                    data:{job:err}
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
 * @apiDescription Cancel a pending job.
 * @apiParam {String} id ID of job to cancel
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data null
 * @apiError {String} status `error`
 * @apiError {Object} message Error message
 */
var cancelJob = function(req, res, next) {
    var answer;
    db.Job.getById(req.params.id, function(err, result) {
        if(err) {
            log.error(err);
            answer = {
                    status:"fail",
                    data:{job:err}
            };
            res.json(answer);
        } else {
            result.cancel(function(err, result) {
                if(err) {
                    log.error(err);
                    answer = {
                            status:"fail",
                            data:{job:err}
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

var getJobFile = function(req, res, next) {
    db.Job.getFileForJobId(req.params.id, function(err, file) {
        if(err) {
            log.error(err);
            var answer = {
                    status:"fail",
                    data:{file:err}
            };
            res.json(answer);                        
        } else {
            res.setHeader('content-type', 'applications/octet-stream');
            res.setHeader('content-disposition', 'filename="' + file.filename + '"');
            var readStream = fs.createReadStream(file.path);
            readStream.pipe(res);
        }
    });
};

module.exports = function(server) {
    server.post('/job', submitJob);
    server.get('/jobs', getAllJobs);
    server.get('/job/:id', getJobById);
    server.del('/job/:id', cancelJob);
    server.post('/job/:id', resubmitJob);
    server.get('/job/:id/file', getJobFile);
    server.get('/jobs/queue', getQueue);
    server.del('/jobs/queue', clearQueue);
    server.post('/jobs/queue/run', runNextJob);
    server.get('/jobs/history', getJobHistory);

};
