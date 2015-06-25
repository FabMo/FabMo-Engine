Engine = require('./engine').Engine;

var engine = new Engine();
engine.start(function(err, data) {
	require('./debug').start();
});
