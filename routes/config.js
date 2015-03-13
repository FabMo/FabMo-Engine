var machine = require('../machine').machine;
var config = require('../config');
var log = require('../log').logger('routes');

/**
 * @api {get} /status Engine status
 * @apiGroup Status
 * @apiSuccessExample {json} Success-Response: 
 *                    { "status":{"posx":0.0, "posy":0.0, "posz":0.0, "state":"idle"}}
 */
var get_status = function(req, res, next) {
  var s = machine.status;
  var answer = {
      status : "success",
      data : {'status':s}
    };
    res.json(answer);
};

var get_info = function(req, res, next) {
    var answer = {
      status : "success",
      data : {'information':information}
    };
    res.json(answer);
};

/**
 * @api {get} /config Get Engine configuration
 * @apiGroup Config
 * @apiSuccess {Object} engine Key-value map of all engine settings
 * @apiSuccess {Object} driver Key-value map of all G2 driver settings
 * @apiSuccess {Object} opensbp Key-value map of all OpenSBP runtime settings 
 */
var get_config = function(req, res, next) {
  var retval = {};
  retval.engine = config.engine.getData();
  retval.driver = config.driver.getData();
  retval.opensbp = config.driver.getData();

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
 */
var post_config = function(req, res, next) {
  var new_config = {};
  var answer;

  if('engine' in req.params) {
    config.engine.update(util.fixJSON(req.params.engine), function(err, result) {
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration file you submitted is not valid"}
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

  if('driver' in req.params) {
    config.driver.update(util.fixJSON(req.params.driver), function(err, result) {
      if(err) {
        answer = {
          status : "fail",
          data : {'body':"the configuration file you submitted is not valid"}
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
  server.get('/info',get_info);          //TODO 
};
