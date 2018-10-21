/*
 * updater.js
 *
 * Handle functions of the updater that need to be called from the engine.
 *
 * Currently, this is just the AP collapse.  All other functions are handled through the router.
 */

var request = require('request');
var config = require('./config');
var log = require('./log').logger('updater');

function postJSON(url, obj) {
    request({
            url: url,
            method: "POST",
            json: true,
            body: obj
        }, 
        function(err, response, body) {
            if(err) {
                log.error(err);
            }
        }
    );
}

exports.APModeCollapse = function() {
	var port = config.engine.get('server_port')+1;
	var url = 'http://localhost:' + port + '/network/hotspot/state';
	postJSON(url, {enabled : true});
}