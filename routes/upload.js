var log = require('../log').logger('routes');
var fs = require('fs');
var uuid = require('node-uuid');

UPLOAD_INDEX = {};
UPLOAD_TIMEOUT = 5000;

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

module.exports.upload = upload;