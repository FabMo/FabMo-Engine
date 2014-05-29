/**
 * @author jimmy
 */

// Load the route handlers
var files_module = require('./files_module_handlers');
var status_module = require('./status_module_handlers');
var commands_module = require('./commands_module_handlers');

module.exports = function(server) {

  // Define the routes
	
	/************** file module ****************/
	server.get('/files', files_module.get_files); //tested
	server.get('/run_file/:id', files_module.run_file); //tested
	server.post('/upload',files_module.upload_file); //tested

	/************** status module ****************/
	server.get('/status', status_module.get_status); //tested

	/************** commands module ****************/
	server.get('/stop',commands_module.stop);


	
};