var log = require('../log').logger('routes');
var fs = require('fs');
var uuid = require('node-uuid');

UPLOAD_INDEX = {};
UPLOAD_TIMEOUT = 5000;

function createUpload(metadata) {
    var key = uuid.v1();
    log.debug("Creating upload " + key);
    UPLOAD_INDEX[key] = {
        file_count : metadata.length,
        meta : metadata,
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
        return upload.meta;    
    }
}

function updateUpload(key, index, file) {
    if(key in UPLOAD_INDEX) {
        setUploadTimeout(key, UPLOAD_TIMEOUT);
        var upload = UPLOAD_INDEX[key];
        var meta = upload.meta[index];
        if(!meta) { throw new Error('No upload metadata for file ' + index + ' of ' + key); }
        meta.file = file;
        upload.file_count--;
        log.debug('Recieved file #' + index + ' (' + file.name + ') for upload ' + key);
        if(upload.file_count === 0) {
            log.debug('Upload of ' + key + ' complete.')
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

        var status = upload_data ? 'complete' : 'pending';

        return res.json({
            'status' : 'success',
            'data' : {
                'status' : status
            }
        });

    } else { /* Metadata type POST */

        try {
            var key = createUpload(req.body);
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
                'key' : key
            }
        });

    };
}

module.exports.upload = upload;