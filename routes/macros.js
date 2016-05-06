var ncp = require('ncp').ncp
var macros = require('../macros');

var updateMacro = function(req, res, next) {
    var id = req.params.id;
    macro = macros.get(id);
    var updated_macro = {};
    if(macro) {
        updated_macro.name = req.params.name || macro.name;
        updated_macro.description = req.params.description || macro.description;
        updated_macro.content = req.params.content || macro.content;
        if(req.params.index != req.params.id) {
            if(req.params.index < 0) {
                return res.json({'status' : 'error', 'message' : "Macro number cannot be negative." })
            }
            updated_macro.index = req.params.index;
        }
    }
    macros.update(id, updated_macro, function(err, macro) {
        if(err) {
            response = {'status' : 'error', 'message' : err.message }       
        } else {
            response = {'status' : 'success', 'data' : macro}
        }
        res.json(response);
    });
}

/**
 * @apiGroup Macros
 * @api {get} /macros List all macros
 * @apiDescription Returns a listing with information about all macros
 */
var getMacros = function(req, res, next) {
    response = {'status' : 'success',
                'data' : {'macros' : macros.list()}}
    res.json(response);
}

/**
 * @apiGroup Macros
 * @api {get} /macros/:id Get macro
 * @apiDescription Returns the specified macro
 * @apiSuccess {Object} macro The requested macro
 * @apiSuccess {String} macro.name Macro name
 * @apiSuccess {String} macro.description Macro description
 * @apiSuccess {String} macro.content Macro code
 * @apiSuccess {String} macro.type Runtime used by the macro
 * @apiSuccess {String} macro.filename Local filename where the macro is stored
 * @apiSuccess {Number} macro.index Macro numeric index
 */
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

/**
 * @apiGroup Macros
 * @api {get} /macros/:id/info Get macro summary
 * @apiDescription Returns the specified macro info (no macro content provided)
 * @apiSuccess {Object} macro The requested macro info
 * @apiSuccess {String} macro.name Macro name
 * @apiSuccess {String} macro.description Macro description
 * @apiSuccess {String} macro.type Runtime used by the macro
 * @apiSuccess {String} macro.filename Local filename where the macro is stored
 * @apiSuccess {Number} macro.index Macro numeric index
 */
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
                'message' : err.message
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

