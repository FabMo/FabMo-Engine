var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log').logger('routes');
var engine = require('../engine');
var profiles = require('../profiles')

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
  var answer = {
      status : "success",
      data : {'status':machine.status}
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
  retval.machine = config.machine.getData();
  retval.profiles = config.profiles.getData();
  var answer =
  {
    status : "success",
    data : {'config':retval}
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
 * @apiParam {Object} machine Key-value map of updates to Machine settings
 */
var post_config = function(req, res, next) {
  var new_config = {};
  var answer;
  var final_result={};

  setMany_remaining = 0;
  ['engine', 'driver', 'opensbp', 'machine'].forEach(function(each) {
    if(each in req.params) {
      setMany_remaining += 1;
    }
  });

  if('engine' in req.params) {
    config.engine.setMany(util.fixJSON(req.params.engine), function(err, result) {
      if(!setMany_remaining)return;
      config.engine.apply(function(err, result) {
        if(!setMany_remaining)return;
        if(err) {
          answer = {
            status : "fail",
            data : {'body':"the configuration data you submitted is not valid"}
          };
          res.json(answer);
          setMany_remaining=0;
          return;
        }
        else{
            final_result.engine = result;
            setMany_remaining--;
            if(!setMany_remaining){
                answer={
                    status:"success",
                    data:final_result
                };
                res.json(answer);
            }
        }
      });
    });
  }

  if('driver' in req.params) {
    config.driver.setMany(util.fixJSON(req.params.driver), function(err, result) {
      if(!setMany_remaining)return;
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration data you submitted is not valid"}
        };
        res.json(answer);
        setMany_remaining=0;
        return;
      } else {
        final_result.driver = result;
        setMany_remaining--;
        if(!setMany_remaining){
            answer={
                status:"success",
                data:final_result
            };
            res.json(answer);
        }
      }
    });
  }

  if('opensbp' in req.params) {
    config.opensbp.setMany(util.fixJSON(req.params.opensbp), function(err, result) {
      if(!setMany_remaining)return;
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration data you submitted is not valid"}
        };
        res.json(answer);
        setMany_remaining=0;
        return;
      } else {
        final_result.opensbp = result;
        setMany_remaining--;
        if(!setMany_remaining){
            answer={
                status:"success",
                data:final_result
            };
            res.json(answer);
        }
      }
    }, true);
  }

  if('machine' in req.params) {
    if(!setMany_remaining)return;
    config.machine.setMany(util.fixJSON(req.params.machine), function(err, result) {
      if(!setMany_remaining)return;
      config.machine.apply(function(err, result) {
        if(err) {
          answer = {
            status : "fail",
            data : {'body':"the configuration data you submitted is not valid"}
          };
          res.json(answer);
          setMany_remaining=0;
          return;
        } else {
          final_result.machine = result;
          setMany_remaining--;
          if(!setMany_remaining){
            answer={
                status:"success",
                data:final_result
            };
            res.json(answer);
          }
        }
      });
    });
  }
};

var get_version = function(req, res, next) {
  var retval = {};
  var answer =
  {
    status : "success",
    data : {'version':engine.version}
  };
  res.json(answer);
};

var get_info = function(req, res, next) {
  engine.getInfo(function(err, info) {
    res.json(  {
      status : "success",
      data : {"info":info}
    });
  });
};


var profile = function(req, res, next) {
  profiles.apply('ShopBot Desktop', function(err, data) {
    res.json({
      status : "success",
      data : {}
    })
  })
};

var getProfiles = function(req, res, next) {
    res.json(  {
      status : "success",
      data : {"profiles":profiles.getProfiles()}
    });
}

module.exports = function(server) {
  server.get('/status', get_status);
  server.get('/config',get_config);
  server.post('/config', post_config);
  server.get('/version', get_version);
  server.get('/info', get_info);
  server.get('/profile', profile);
  server.get('/profiles', getProfiles);

};
