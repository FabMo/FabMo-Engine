var engine = require('./engine');
var argv = require('minimist')(process.argv);

engine.start(function(err, data) {
	// Start the debug monitor if requested, but only after the engine is fully started
	if('debug' in argv) {
		require('./debug').start();
	}
});

exports.engine = engine;