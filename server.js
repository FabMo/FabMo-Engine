var lockfile = require('lockfile');
var config = require('./config');
var log = require('./log').logger('server');

var lockfile_path = config.getLockFile();

lockfile.lock(lockfile_path,{},function(err){
    if(err) {
        log.error("You can't run a second instance of the Fabmo-Engine program");
		process.exit(13); // this is an arbitrary setted value; Node.js is using value 1 to 12 for its own error codes
    }

	var engine = require('./engine');
	var argv = require('minimist')(process.argv);

	engine.start(function(err, data) {
		// Start the debug monitor if requested, but only after the engine is fully started
		if('debug' in argv) {
			require('./debug').start();
		}
	});

	exports.engine = engine;
});

process.on('exit', function(code) {
	clearLock(code);
});

process.on('SIGINT',function(code){
	clearLock(code);
	process.exit(0);
});

function clearLock(code){
	if(code!==13)// process is not already running
        {
            lockfile.unlockSync(lockfile_path);
        }
}
