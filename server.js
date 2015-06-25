var Engine = require('./engine').Engine;
var argv = require('minimist')(process.argv);

var engine = new Engine();
engine.start(function(err, data) {
	if('debug' in argv) {
		require('./debug').start();
	}
});
