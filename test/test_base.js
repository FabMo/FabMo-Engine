// This is the test bootstrap module
// This code runs once to set up the system before all tests

var Engine = require('../engine').Engine

before(function(done) {
	
	// Suppress logging so we get to see Mocha's pretty output
	require('../log').suppress();

	// Create engine object
	engine = new Engine();
	
	// Start the engine
	engine.start(function(err, engine) {
		exports.engine = engine;
		// Ready to run tests
		done();
	}); 
});
