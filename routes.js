/**
 * @author jimmy
 */
var restify = require('restify');

// Load the route handlers
var files_module = require('./files_module_handlers');
var config_module = require('./config_module_handlers');
var file_commands_module = require('./file_commands_module_handlers');
var direct_commands_module = require('./direct_commands_module_handlers');
var wifi_manager_module = require('./wifi_manager_handlers');

module.exports = function(server) {

	/************** Status & config module **************/

	/* get the status of the tool */
	server.get('/status', config_module.get_status); //OK

	/* get the config of the tool */
	server.get('/config',config_module.get_config); //TODO 

	/* get the informations of the tool */
	server.get('/info',config_module.get_info); //TODO 

	/****************************************************/



	/******************* File module ********************/

	/* get the list of files on the upload directory */	
	server.get('/file', files_module.get_files); //OK

	/* upload a file */
	server.post('/file',files_module.upload_file); //OK

	server.del('/file/:id',files_module.delete_file); //OK

	server.get('/file/:id',files_module.download_file); //OK

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
	server.post('/direct/gcode',direct_commands_module.send_gcode); //OK

	/* move the tool in the given direction */
	server.post('/direct/move',direct_commands_module.move); //TODO :improve it

	/* jog the tool in the given direction */
	server.post('/direct/jog',direct_commands_module.jog); //TODO  :improve it

	/* move the tool to a given position */
	server.post('/direct/goto',direct_commands_module.goto); //OK

	/****************************************************/


	/************** Wifi manager module *****************/


	/* get the list of detectable wifi networks */	
	server.get('/wifi_manager/detection',wifi_manager_module.detection); //TODO

	/* get the list of existing profiles */
	server.get('/wifi_manager/profiles',wifi_manager_module.list_profiles); //TODO

	/* create a new profile */
	server.post('/wifi_manager/profile',wifi_manager_module.add_profile); //TODO

	/* delete an existing profile */
	server.del('/wifi_manager/profile/:id',wifi_manager_module.delete_profile); //TODO
	/****************************************************/


	server.get(/.*/, restify.serveStatic({
   		directory: './static',
   		default: 'index.html'
	}));

	
};
