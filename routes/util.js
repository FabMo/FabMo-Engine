var log = require('../log').logger('routes');
var fs = require('fs');
var uuid = require('node-uuid');
var pako = require('pako');

UPLOAD_INDEX = {};
UPLOAD_TIMEOUT = 3600000;

/*
 * Incoming metadata looks like this:
 * {
    meta : {metadata}
    files : [
        {metadata for file 1},
        {metadata for file 2},
        {etc...}
    ]
 * }
 */
function createUpload(metadata, callback) {
    var key = uuid.v1();
    log.info('Creating upload ' + key);
    UPLOAD_INDEX[key] = {
        file_count : metadata.files.length,
        meta : metadata.meta || {},
        files : metadata.files,
        callback : callback
    }
    setUploadTimeout(key, UPLOAD_TIMEOUT);
    return key;
}

function setUploadTimeout(key, timeout) {
    if(UPLOAD_INDEX[key].timeout) {
        clearTimeout(UPLOAD_INDEX[key].timeout);
    }
    UPLOAD_INDEX[key].timeout = setTimeout(function() {
        log.warn('Deleting expired upload: ' + key);
        expireUpload(key);
    }, timeout);
}

function expireUpload(key) {
    var upload = UPLOAD_INDEX[key];
    if(upload && upload.timeout) {
        clearTimeout(upload.timeout);
        delete UPLOAD_INDEX[key];
        return upload;
    } else {
        log.warn("Tried to expire upload " + key + " that doesn't exist.");
    }
}

function updateUpload(key, index, file) {
    if(key in UPLOAD_INDEX) {
        setUploadTimeout(key, UPLOAD_TIMEOUT);
        var upload = UPLOAD_INDEX[key];
        var meta = upload.files[index];
        if(!meta) { throw new Error('No upload metadata for file ' + index + ' of ' + key); }
        meta.file = file;
        if(!file) { throw new Error('No file supplied in request.')}

        upload.file_count--;
        log.info('Recieved file #' + index + ' (' + file.name + ') for upload ' + key);
        if(upload.file_count === 0) {
            log.info('Upload of ' + key + ' complete.')
            return expireUpload(key);
        }
        return undefined;
    }

    throw new Error('Invalid upload key: ' + key);
}

function upload(req, res, next, callback) {
    if(req.files) { // File upload type post
        var file = req.files.file;
        if(req.body.compressed){
          //var start_decompress = Date.now();
          fs.readFile(file.path,function(err,data){
            if(err)log.err(err);
            fs.writeFile(file.path,pako.inflate(data,{to:"string"}),function(){
              //log.info("decompression time : "+(Date.now()-start_decompress)+"ms");
              var index = req.body.index;
              var key = req.body.key;
              var upload_data = null;

              try {
                  upload_data = updateUpload(key, index, file);
              } catch(e) {
                  log.error(e);
                  return res.json({
                      'status' : 'error',
                      'message' : e.message
                  });
              }

              if(upload_data) {
                  if(callback) {
                      //var cb = upload_data.callback;
                      delete upload_data.callback;
                      delete upload_data.file_count;
                      delete upload_data.timeout;
                      callback(null, upload_data);
                  }
              }else{
                return res.json({
                  'status' : 'success',
                  'data' : {
                    'status' : 'pending'
                  }
                });
              }
            });
          });
        }else{
          var index = req.body.index;
          var key = req.body.key;
          var upload_data = null;

          try {
              upload_data = updateUpload(key, index, file);
          } catch(e) {
              log.error(e);
              return res.json({
                'status' : 'error',
                'message' : e.message
              });
          }

          if(upload_data) {
              if(callback) {
                  //var cb = upload_data.callback;
                  delete upload_data.callback;
                  delete upload_data.file_count;
                  delete upload_data.timeout;
                  callback(null, upload_data);
              }
          } else {
              return res.json({
                  'status' : 'success',
                  'data' : {
                      'status' : 'pending'
                  }
              });
          }
        }

    } else { /* Metadata type POST */

        try {
            var key = createUpload(req.body, callback);
        } catch(e) {
            log.error(e);
            return res.json( {
                'status' : 'error',
                'message' : e.message
            });
        }

        // Respond with the key
        return res.json({
            'status' : 'success',
            'data' : {
                'status' : 'pending',
                'key' : key
            }
        });

    };
}

function updaterRedirect(req, res, next) {
    switch(req.method) {
        case 'GET':
			log.info("rmackie: 4000" + req.url);
            var host = req.headers.host.split(':')[0].trim('/');
            var path = req.params[0];
            var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path;
			log.info("rmackie: 4001" + url);
            res.redirect(302, url, next);
            break;

        case 'POST':
			log.info("rmackie: 4002" + req.url);
            var host = req.headers.host.split(':')[0].trim('/');
            var path = req.params[0];
            var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path;
			log.info("rmackie: 4003" + url);
            var response = {'url' : url};
            res.json(300, response);
            break;
    }
}

/// Parse the given cookie header string into an object
/// The object has the various cookies as keys(names) => values
/// @param {String} str
/// @return {Object}
var parseCookie = function(str, opt) {
    opt = opt || {};
    var obj = {}
    var pairs = str.split(/[;,] */);
    var dec = opt.decode || decodeURIComponent;

    pairs.forEach(function(pair) {
        var eq_idx = pair.indexOf('=')

        // skip things that don't look like key=value
        if (eq_idx < 0) {
            return;
        }

        var key = pair.substr(0, eq_idx).trim()
        var val = pair.substr(++eq_idx, pair.length).trim();

        // quoted values
        if ('"' == val[0]) {
            val = val.slice(1, -1);
        }

        // only assign once
        if (undefined == obj[key]) {
            try {
                obj[key] = dec(val);
            } catch (e) {
                obj[key] = val;
            }
        }
    });

    return obj;
};

module.exports.upload = upload;
module.exports.updaterRedirect = updaterRedirect;
module.exports.parseCookie = parseCookie;
