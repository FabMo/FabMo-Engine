var restify = require('restify');
var socketio = require('socket.io');
var async = require('async');
var process = require('process');
var machine = require('./machine');
var detection_daemon = require('./detection_daemon')();
var config = require('./config');
var PLATFORM = process.platform;
var log = require('./log').logger('engine');
var db = require('./db');
var macros = require('./macros');
var dashboard = require('./dashboard');
var network = require('./network');
var updater = require('./updater');
var glob = require('glob');
var argv = require('minimist')(process.argv);

var Engine = function() {
    this.version = null;
    this.time_synced = false;
};

function EngineConfigFirstTime(callback) {
    switch(PLATFORM) {
        case 'darwin':
            glob.glob('/dev/cu.usbmodem*', function(err, files) {
                if(files.length >= 2) {
                    var ports = {
                        'control_port_osx' : files[0],
                        'data_port_osx' : files[1]
                    }
                    config.engine.update(ports, function() {
                        callback();
                    });
                }
            });
        break;

        default:
            callback();
        break;
    }
};

Engine.prototype.setTime = function(obj) {
    if(!this.time_synced) {
        this.time_synced = true;
        var d = new Date(obj.utc);
        log.debug("Setting the time to " + d.toUTCString());
        var t = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDay() + ' ' + d.getUTCHours() + ':' + d.getUTCMinutes() + ':' + d.getUTCSeconds()
	cmd = 'timedatectl set-time ' + t + '; timedatectl';
        util.doshell(cmd, function(stdout) {
            console.log(stdout);
        });
    }
}

Engine.prototype.stop = function(callback) {
    this.machine.disconnect();
    this.machine.setState(this.machine, 'stopped');

    //this.server.close();
    //this.server.io.server.close();
    callback(null);
};

Engine.prototype.start = function(callback) {

    async.series([

        // Configure the engine data directories
       function setup_application(callback) {
            log.info('Checking engine data directory tree...');
            config.createDataDirectories(callback);
        },

        // Load the engine configuration from disk
        function load_engine_config(callback) {
            log.info("Loading engine configuration...");
            config.configureEngine(callback);
        },

        function check_engine_config(callback) {
            if(!config.engine.userConfigLoaded) {
                EngineConfigFirstTime(callback);
            } else {
                callback();
            }
        },

        // Create the version string that will be used to identify the software version
        function get_fabmo_version(callback) {
            log.info("Getting engine version...");
            updater.getFabmoVersionString(function(err, string) {
                if(!err) {
                    log.info("Engine version: " + string);
                    this.version = string;
                } else {
                    log.error(err);
                }
                callback();
            }.bind(this));
        }.bind(this),

        function clear_approot(callback) {
            if('debug' in argv) {
                log.info("Running in debug mode - clearing the approot.");
                config.clearAppRoot(function(err, stdout) {
                    if(err) { log.error(err); }
                    else {
                        log.debug(stdout);
                    }
                    callback();
                });
            } else {
                var last_time_version = config.engine.get('version');
                var this_time_version = this.version;
                log.debug("Previous engine version: " + last_time_version);
                log.debug(" Current engine version: " + this_time_version);

                if(last_time_version != this_time_version) {
                    log.info("Engine version has changed - clearing the approot.");
                    config.clearAppRoot(function(err, stdout) {
                        if(err) { log.error(err); }
                        else {
                            log.debug(stdout);
                        }
                        callback();
                    });
                } else {
                    log.info("Engine version is unchanged since last run.");
                    callback();
                }
            }
            config.engine.set('version', this_time_version);
        }.bind(this),

        function create_data_directories(callback) {
            config.createDataDirectories(callback);
        }.bind(this),

        // "Apply" the engine configuration, that is, take the configuration values loaded and actually
        // set up the application based on them.
        function apply_engine_config(callback) {
            log.info("Applying engine configuration...");
            config.engine.apply(callback);
        },

	function setup_network(callback) {
		if(config.engine.get('wifi_manager')) {
			log.info("Setting up the network...");
            try {
                network.init();
            } catch(e) {
                log.error('Problem starting network manager:')
                log.error(e);
            }
			callback(null);
		} else {
			log.warn("Skipping network setup because wifi manager is disabled.");
			callback(null);
		}
	},

        // Configure the DB
        function setup_database(callback) {
            log.info("Configuring database...");
            db.configureDB(callback);
        },

        // Cleanup the DB
        function clean_database(callback) {
            log.info("Cleaning up database...");
            db.cleanup(callback);
        },

        // Connect to G2 and initialize machine runtimes
        function connect(callback) {
            log.info("Connecting to G2...");
            machine.connect(function(err, machine) {
                if(err) {
                    log.error("!!!!!!!!!!!!!!!!!!!!!!!!");
                    log.error("Could not connect to G2.");
                    log.error("(" + err + ")");
                    log.error("!!!!!!!!!!!!!!!!!!!!!!!!");
                }
                callback(null);
            });
        }.bind(this),

        function load_machine_config(callback) {
            this.machine = machine.machine;
            log.info('Loading the machine configuration...')
            config.configureMachine(this.machine.driver, function(err, result) {
                if(err) {
                    log.warn(err);
                }
                callback(null);
            });
        }.bind(this),
	
	function set_units(callback) {
		this.machine.driver.setUnits(config.machine.get('units'), callback);
	}.bind(this),

        // Configure G2 by loading all its json settings and static configuration parameters
        function load_driver_config(callback) {
            if(this.machine.isConnected()) {
                log.info("Configuring G2...");
                config.configureDriver(machine.machine.driver, function(err, data) {
                    if(err) {
                        log.error("There were problems loading the G2 configuration.");
                    }
                    callback(null);
                });
            } else {
                log.warn("Skipping G2 configuration due to no connection.");
                config.configureDriver(null, function(err, data) {
                    callback(null);
                })
                callback(null);
            }
        }.bind(this),

        function get_g2_version(callback) {
            if(this.machine.isConnected()) {
                log.info("Getting G2 firmware version...");
                this.machine.driver.get('fb', function(err, value) {
                    if(err) {
                        log.error('Could not get the G2 firmware build. (' + err + ')');
                    } else {
                        log.info('G2 Firmware Build: ' + value);
                    }
                    callback(null);
                });
            } else {
                log.warn("Skipping G2 firmware version check due to no connection.")
                callback(null);
            }
    	}.bind(this),

        function apply_machine_config(callback) {
            log.info("Applying machine configuration...");
            config.machine.apply(callback);
        }.bind(this),


        function load_opensbp_commands(callback) {
            log.info("Loading OpenSBP Commands...");
            this.machine.sbp_runtime.loadCommands(callback);
        }.bind(this),

        function load_opensbp_config(callback) {
            log.info("Configuring OpenSBP runtime...");
            config.configureOpenSBP(callback);
        },

        function configure_dashboard(callback) {
            log.info("Configuring dashboard...");
            dashboard.configure(callback);
        },

        function load_apps(callback) {
            log.info("Loading dashboard apps...");
            dashboard.loadApps(function(err, result) {
                callback(null, result);
            });
        },

        function load_macros(callback) {
            log.info("Loading macros...")
            macros.load(callback);
        },

        function load_instance_config(callback) {
            log.info("Loading instance info...");
            config.configureInstance(this.machine.driver, callback);
        }.bind(this),

        function apply_instance_config(callback) {
            log.info("Applying instance configuration...");
            config.instance.apply(callback);
        },

        // Kick off the server if all of the above went OK.
        function start_server(callback) {
            log.info("Setting up the webserver...");
            var server = restify.createServer({name:"FabMo Engine"});
            this.server = server;

            // Allow JSON over Cross-origin resource sharing 
            log.info("Configuring cross-origin requests...");
            server.use(
                function crossOrigin(req,res,next){
                    res.header("Access-Control-Allow-Origin", "*");
                    res.header("Access-Control-Allow-Headers", "X-Requested-With");
                    return next();
                }
            );

            if('debug' in argv && argv.debug === 'slow') {
                // Introduce deliberate latency for testing
                log.warn("Configuring deliberate latency for testing...")
                server.use(
                    function latency(req, res, next) {
                        setTimeout(next,500*Math.random());
                    }
                );
            }

            server.on('uncaughtException', function(req, res, route, err) {
                log.uncaught(err);
                answer = {
                    status:"error",
                    message:err
                };
                res.json(answer)
            });

            // Configure local directory for uploading files
            log.info("Cofiguring upload directory...");
            server.use(restify.bodyParser({'uploadDir':config.engine.get('upload_dir') || '/tmp'}));
            server.pre(restify.pre.sanitizePath());

            log.info("Enabling gzip for transport...");
            server.use(restify.gzipResponse());
            // Import the routes module and apply the routes to the server
            log.info("Loading routes...");
            server.io = socketio.listen(server.server);
            var routes = require('./routes')(server);

            // Kick off the server listening for connections
            server.listen(config.engine.get('server_port'), function() {
                log.info(server.name+ ' listening at '+ server.url);
                callback(null, server);
            });

        }.bind(this),
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
};

module.exports = new Engine();
