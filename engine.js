var restify = require('restify');
var async = require('async');
var process = require('process');
var machine = require('./machine');
var detection_daemon = require('./detection_daemon');
var config = require('./config');
var PLATFORM = process.platform;
var log = require('./log').logger('engine');
var db = require('./db');

var Engine = function() {
}

Engine.prototype.stop = function(callback) {
    this.machine.disconnect();
}

Engine.prototype.start = function(callback) {

    async.series([

        // Load the engine configuration from disk
        function load_engine_config(callback) {
            log.info("Loading engine configuration...")
            config.configure_engine(callback);
        },

        // "Apply" the engine configuration, that is, take the configuration values loaded and actually
        // set up the application based on them.
        function apply_engine_config(callback) {
            log.info("Applying engine configuration...")
            config.engine.apply(callback);
        },

        // Configure the DB
        function setup_database(callback) {
            db.configureDB(callback);
        },

        // Connect to G2 and initialize machine runtimes
        function connect(callback) {
            log.info("Connecting to G2...")
            machine.connect(callback);
        }.bind(this),

        // Configure G2 by loading all its json settings and static configuration parameters
        function load_driver_config(callback) {
            this.machine = machine.machine
            log.info("Configuring G2...")
            config.configure_driver(machine.machine.driver, callback);
        }.bind(this),

	function get_g2_version(callback) {
	    this.machine.driver.get('fb', function(err, value) {
                log.info('G2 Firmware Build: ' + value);
                callback(null);
            });
	}.bind(this),

        function load_opensbp_commands(callback) {
            log.info("Loading OpenSBP Commands...");
            this.machine.sbp_runtime.loadCommands(callback);
        }.bind(this),

        function load_opensbp_config(callback) {
            log.info("Configuring OpenSBP runtime...");
            config.configure_opensbp(callback);
        },

        // Kick off the server if all of the above went OK.
        function start_server(callback) {
            log.info("Setting up the webserver...")
            var server = restify.createServer({name:"FabMo Engine"});
            this.server = server;

            // Allow JSON over Cross-origin resource sharing 
            log.info("Configuring cross-origin requests...")
            server.use(
                function crossOrigin(req,res,next){
                    res.header("Access-Control-Allow-Origin", "*");
                    res.header("Access-Control-Allow-Headers", "X-Requested-With");
                    return next();
                }
            );

            // Configure local directory for uploading files
            log.info("Cofiguring upload directory...")
            server.use(restify.bodyParser({'uploadDir':config.engine.get('upload_dir')}));
            server.pre(restify.pre.sanitizePath());

            // Import the routes module and apply the routes to the server
            log.info("Loading routes...")
            var routes = require('./routes')(server);
	    
            // Kick off the server listening for connections
            server.listen(config.engine.get('server_port'), function() {
                log.info(server.name+ ' listening at '+ server.url);
                callback(null, server);

            });
        }.bind(this),
        
        // Initialize a detection daemon.
        // This is a beacon server that allows the tool to be auto-discovered on the network.
        function start_detection_server(callback) {
            log.info("Starting detection daemon...");
            try {
                var daemon = new detection_daemon(24862);
                this.detection_daemon = daemon;
                callback(null, daemon);
            } catch (e) {
                callback(e);
            }
        }.bind(this)
        ],

        function(err, results) {
            if(err) {
                log.error(err);
                typeof callback === 'function' && callback(err);
            } else {
                typeof callback === 'function' && callback(null, this);
            }
        }.bind(this)        
    );
}

exports.Engine = Engine;
