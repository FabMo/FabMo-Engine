var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log').logger('routes');

/**
 * @api {get} /status Engine status
 * @apiGroup Status
 * @apiDescription Get a system status report, which includes tool position, IO states, current job, progress, etc.
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.status Status info
 * @apiSuccess {String} data.status.state `idle` | `running` | `paused` | `stopped`
 * @apiSuccess {Number} data.status.posx X Position
 * @apiSuccess {Number} data.status.posy Y Position
 * @apiSuccess {Number} data.status.posz Z Position
 * @apiSuccess {Number} data.status.posa A Position
 * @apiSuccess {Number} data.status.posb B Position
 * @apiSuccess {Number} data.status.posc C Position
 * @apiSuccess {Object} data.status.job Current Job | `null`
 * @apiSuccess {String} data.status.job.state `pending` | `running` | `finished` | `cancelled`
 * @apiSuccess {String} data.status.job.name Human readable job name
 * @apiSuccess {String} data.status.job.description Job description
 * @apiSuccess {Number} data.status.job.created_at Time job was added to the queue (UNIX timestamp)
 * @apiSuccess {Number} data.status.job.started_at Time job was started (UNIX timestamp)
 * @apiSuccess {Number} data.status.job.finished_at Time job was finished (UNIX timestamp)
 */
var get_status = function(req, res, next) {
  var s = machine.status;
  var answer = {
      status : "success",
      data : {'status':s}
    };
    res.json(answer);
};

/**
 * @api {get} /config Get Engine configuration
 * @apiGroup Config
 * @apiDescription Dictionary
 * @apiSuccess {String} status `success`
 * @apiSuccess {Object} data Response data
 * @apiSuccess {Object} data.engine Key-value map of all engine settings
 * @apiSuccess {Object} data.driver Key-value map of all G2 driver settings
 * @apiSuccess {Object} data.opensbp Key-value map of all OpenSBP runtime settings 
 */
var get_config = function(req, res, next) {
  var retval = {};
  retval.engine = config.engine.getData();
  retval.driver = config.driver.getData();
  retval.opensbp = config.opensbp.getData();

  var answer = 
  {
    status : "success",
    data : {'configuration':retval}
  };
  res.json(answer);
};

/**
 * @api {post} /config Update engine configuration
 * @apiGroup Config
 * @apiDescription Incorporate the POSTed object into the engine configuration.  Configuration updates take effect immediately.
 * @apiParam {Object} engine Key-value map of updates to engine settings
 * @apiParam {Object} driver Key-value map of updates to G2 driver settings
 * @apiParam {Object} opensbp Key-value map of updates to OpenSBP settings
 */
var post_config = function(req, res, next) {
  var new_config = {};
  var answer;

  if('engine' in req.params) {
    config.engine.update(util.fixJSON(req.params.engine), function(err, result) {
      config.engine.apply(function(err, result) {
        if(err) {
          answer = {
            status : "fail",
            data : {'body':"the configuration data you submitted is not valid"}
          };
          res.json(answer);
        } else {
          answer = {
              status : "success",
              data : result
           };
          res.json(answer);
        }
      });
    });
  }

  if('driver' in req.params) {
    config.driver.update(util.fixJSON(req.params.driver), function(err, result) {
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration data you submitted is not valid"}
        };
        res.json(answer);
      } else {
        answer = {
            status : "success",
            data : result
         };
        res.json(answer);
      }
    });
  }

  if('opensbp' in req.params) {
    config.opensbp.update(util.fixJSON(req.params.opensbp), function(err, result) {
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration data you submitted is not valid"}
        };
        res.json(answer);
      } else {
        answer = {
            status : "success",
            data : result
         };
        res.json(answer);
      }
    });
  }

  if('machine' in req.params) {
    config.machine.update(util.fixJSON(req.params.machine), function(err, result) {
      config.machine.apply(function(err, result) {
        if(err) {
          answer = {
            status : "fail",
            data : {'body':"the configuration data you submitted is not valid"}
          };
          res.json(answer);
        } else {
          answer = {
              status : "success",
              data : result
           };
          res.json(answer);
        }
      });
    });
  }
/*
  else{
    // TODO: Apply the driver/opensbp configurations here
    answer = {
          status : "error",
          message : "not yet implemented"
        };
        res.json(answer);
  }*/
};

module.exports = function(server) {
  server.get('/status', get_status);     //OK
  server.get('/config',get_config);      //OK
  server.post('/config', post_config);   //TODO
};
