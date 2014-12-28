/********** Custom Developper Functions **********/

var machine, ui;
// Debug for now lets us know that we have a viable dashboard object
fabmoDashboard.getMachine(function(err, machine) {
	machine = new FabMo(machine.ip, machine.port);
	//ui = new FabMoUI(machine);
});

setGCode = function(s,tasks) {
	var code = new gcode();

	//Do each line in more than 1 pass
	$.each(Tasks, function(index,t){
		t.gCode(code);
	});
	
	return code.getGc();
};

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

//Not use in this app
/*
$(".invert-pos").click(function(){
	invertForm();
});
*/

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
	
//Run all the tasks
$("#run").click(function(){
	var c = setGCode(s,Tasks);

	console.log(c);
	
	//dashboard.addJob(c,s);
	fabmoDashboard.submitJob(c, {
			'name' : 'Holes Cutter',
			'description' : 'Cut ' + Tasks.length.toString() + ' circle(s)',
            'filename' : 'holes_cutter.nc'
    })
});

//OnLoad Init
$(document).ready(function(){
	//Foundation Init
	$(document).foundation();
	c.resize();
	c.setRatio();
	//Get Tasks from storage (if stored)
	//L = dashboard.getAppSetting("holes_cutter","Tasks") ? dashboard.getAppSetting("holes_cutter","Tasks") : [];
	//console.log(Tasks);
});

invertForm = function(){
	var x0 = $("#line_x0").val();
	var y0 = $("#line_y0").val();
	$("#line_x0").val($("#line_x1").val());
	$("#line_y0").val($("#line_y1").val());
	$("#line_x1").val(x0);
	$("#line_y1").val(y0);
};