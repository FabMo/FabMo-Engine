var ncp = require('ncp').ncp
var macros = require('../macros');

var updateMacro = function(req, res, next) {
    var id = req.params.id;
    macro = macros.get(id);
    var updated_macro = {};
    if(macro) {
        updated_macro.name = req.params.name || macro.name
        updated_macro.description = req.params.description || macro.description
        updated_macro.content = req.params.content || macro.content
        updated_macro.index = req.params.index || macro.index
    }
    macros.update(id, updated_macro, function(err, macro) {
        if(err) {
            response = {'status' : 'error', 'message' : err }       
        } else {
            response = {'status' : 'success', 'data' : macro}
        }
        res.json(response);
    });
}

/**
 * @apiGroup Macros
 * @api {get} /macros Get list of installed macros
 * @apiDescription Returns a listing with information about all macros
 */
var getMacros = function(req, res, next) {
    response = {'status' : 'success',
                'data' : {'macros' : macros.list()}}
    res.json(response);
}

var getMacro = function(req, res, next) {
    id = req.params.id;
    macro = macros.get(id);
    if(macro) {
        res.json({
            'status' : 'success',
            'data' : {'macro' : macro }
        });       
    } else {
        res.json({
            'status' : 'error',
            'message' : 'No such macro: ' + id
        });
    }
}

var getMacroInfo = function(req, res, next) {
    id = req.params.id;
    info = macros.getInfo(id);
    if(info) {
        res.json({
            'status' : 'success',
            'data' : info
        });
    } else {
        res.json({
            'status' : 'error',
            'message' : 'No such macro: ' + id
        });
    }
}

var runMacro = function(req, res, next) {
    var id = req.params.id;
    macro = macros.get(id);
    if(macro) {
        macros.run(id);
        res.json({
            'status' : 'success',
            'data' : macros.list()
        });
    } else {
        res.json({
            'status' : 'error',
            'message' : 'No such macro: ' + id
        });
    }
}

var deleteMacro = function(req, res, next) {
    var id = req.params.id;
    macros.del(id, function(err) {
        if(err) {
            res.json({
                'status' : 'error',
                'message' : 'No such macro: ' + id
            });
        } else {
            res.json({
                'status' : 'success',
                'data' : macros.list()
            });

        }
    });
}

module.exports = function(server) {
    server.get('/macros', getMacros);
    server.get('/macros/:id', getMacro);
    server.del('/macros/:id', deleteMacro);
    server.get('/macros/:id/info', getMacroInfo);     
    server.post('/macros/:id/run', runMacro);
    server.post('/macros/:id', updateMacro);
};

