/**
 * @author jimmy
 */
var restify = require('restify');

// Load the route handlers
var files_module = require('./files_module_handlers');
var status_module = require('./status_module_handlers');
var file_commands_module = require('./file_commands_module_handlers');
var direct_commands_module = require('./direct_commands_module_handlers');

module.exports = function(server) {

	/************** Status & config module **************/

	/* get the status of the tool */
	server.get('/status', status_module.get_status); //OK

	/* get the config of the tool */
	server.get('/config',status_module.get_config); //TODO 

	/****************************************************/



	/******************* File module ********************/

	/* get the list of files on the upload directory */	
	server.get('/file', files_module.get_files); //OK

	/* upload a file */
	server.post('/file',files_module.upload_file); //OK

	/****************************************************/



	/************** file commands module ****************/

	/* run a file by id */
	server.get('/run/:id', file_commands_module.run); //OK

	/* abort the execution of the current running file */
	server.get('/quit',file_commands_module.quit); //TODO

	/* pause the execution of the current running file */
	server.get('/pause',file_commands_module.pause); //TODO 
	
	/* resume the execution of the current running file */
	server.get('/resume',file_commands_module.resume); //TODO 

	/****************************************************/



	/************* Direct commands module ***************/
	
	/* send a gcode command to the tool */
	server.post('/direct/gcode',direct_commands_module.send_gcode); //TODO 

	/* move the tool in the given direction */
	server.post('/direct/move',direct_commands_module.move); //TODO 

	/* jog the tool in the given direction */
	server.post('/direct/jog',direct_commands_module.jog); //TODO

	/* move the tool to a given position */
	server.post('/direct/goto',direct_commands_module.goto); //OK

	/****************************************************/


	
};
