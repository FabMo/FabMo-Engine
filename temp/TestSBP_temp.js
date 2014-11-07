Engine = require('../engine').Engine;

var engine = new Engine();

engine.start(function(error, result){ 
	engine.machine.sbp("JS,30,30,6,8,1");
	setTimeout(process.exit,1000);
});
