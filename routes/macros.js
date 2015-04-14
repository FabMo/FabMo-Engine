var ncp = require('ncp').ncp
var macros = require('../macros');
/**
 * @apiGroup Macros
 * @api {post} /macro Submit a macro
 * @apiDescription Add a macro
 */
var createMacro = function(req, res, next) {
    // Get the one and only one file you're currently allowed to upload at a time
    var file = req.files.file;

    options = {}
    options.name = req.body.name;
    options.description = req.body.description;
    options.index = req.body.index;

    macros.create(file.file, options, function(err, result) {
        if(err) {
            response = {'status' : 'error', 'message':err};
        } else {
            response = {'status' : 'success'};
        }
        res.json(response);
    })
}; // submitJob

var getMacros = function(req, res, next) {
    response = {'status' : 'success',
                'data' : macros.list()}
    res.json(response);
}

module.exports = function(server) {
    server.get('/macros', getMacros);
};