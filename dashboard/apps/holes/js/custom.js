/********** Custom Developper Functions **********/

var machine, ui;
// Debug for now lets us know that we have a viable dashboard object
fabmoDashboard.getMachine(function(err, machine) {
	machine = new FabMo(machine.ip, machine.port);
	//ui = new FabMoUI(machine);
});

function setGCode(s) {
	var code = new gcode();
	//Do each line in more than 1 pass
	Tasks.gCode(code);
	console.log("Final Setup");
	console.log(code.getGc());
	return code.getGc();
};

//Listen for a click on Tasks List, should be called after each task modification
function listenClickTasks(){
	//Remove a task
	$(".list-tasks-container .delete").click(function() {
		Tasks.remove($(this).parent().attr("id"));
	});

	//Edit a task
	$(".list-tasks-container .edit").click(function(){
		Tasks.edit($(this).parent().attr("id"));
	});
}

//OnLoad Init
$(document).ready(function(){
	//Foundation Init
	$(document).foundation();
	c.resize();
	c.setRatio();
	//Get Tasks from storage (if stored)
	//L = dashboard.getAppSetting("holes_cutter","Tasks") ? dashboard.getAppSetting("holes_cutter","Tasks") : [];
	//console.log(Tasks);


	/********** User Interface Actions **********/

	//Add a task
	$("#add-circle").click(function(){
		if($("#circle_name").data("cid")) {
			Tasks.save($("#circle_name").data("cid"));
		}
		else {
			Tasks.addCircle();
		}
	});

	//Delete all the tasks
	$("#reset").click(function() {
		Tasks.reset();
	});

	//Run all the tasks
	$("#run").click(function(){
		var c = setGCode();
		
		//dashboard.addJob(c,s);
		fabmoDashboard.submitJob(c, {
				'name' : 'Holes Cutter',
				'description' : 'Cut ' + Tasks.length.toString() + ' circle(s)',
	            'filename' : 'holes_cutter.nc'
	    })
	});
});