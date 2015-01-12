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
};

invertForm = function(){
	var x0 = $("#line_x0").val();
	var y0 = $("#line_y0").val();
	$("#line_x0").val($("#line_x1").val());
	$("#line_y0").val($("#line_y1").val());
	$("#line_x1").val(x0);
	$("#line_y1").val(y0);
};

function toogleDimPosRetangle() {
	if(  $('input[name=dimensions_method]').is(':checked') ){
		$(".rectangle_dimensions_container").show();
		$(".rectangle_end_container").hide();
		$(".rectangle_dimensions_container input").addClass("active");
		$(".rectangle_end_container input").removeClass("active");
	}
	else {
		$(".rectangle_dimensions_container").hide();
		$(".rectangle_end_container").show();
		$(".rectangle_dimensions_container input").removeClass("active");
		$(".rectangle_end_container input").addClass("active");
	}
};

function toogleDimPosCircle() {
	if(  $('input[name=radius_method]').is(':checked') ){
		$(".circle_radius_container").show();
		$(".circle_diameter_container").hide();
		$(".circle_radius_container input").addClass("active");
		$(".circle_diameter_container input").removeClass("active");
	}
	else {
		$(".circle_radius_container").hide();
		$(".circle_diameter_container").show();
		$(".circle_radius_container input").removeClass("active");
		$(".circle_diameter_container input").addClass("active");
	}
};

function hideTab(group){
	$(".tabs." + group + " dd").removeClass("active");
	$(".tabs-content ." + group + ".content").removeClass("active");
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

	//Save or restaur settings
	$("#save-settings, #default-settings").click(function(){
		hideTab("settings");
	});

	//Add a Line
	$("#add-line").click(function(){
		if($("#line_name").data("cid")) { Tasks.save($("#line_name").data("cid")); }
		else { Tasks.addLine(); }
		hideTab("shapes");
	});

	//Add a rectangle
	$("#add-rectangle").click(function(){
		if($("#rectangle_name").data("cid")) { Tasks.save($("#rectangle_name").data("cid")); }
		else { Tasks.addRectangle(); }
		hideTab("shapes");
	});

	//Add a circle
	$("#add-circle").click(function(){
		if($("#circle_name").data("cid")) { Tasks.save($("#circle_name").data("cid")); }
		else { Tasks.addCircle(); }
		hideTab("shapes");
	});

	//Add an arc
	$("#add-arc").click(function(){
		if($("#arc_name").data("cid")) { Tasks.save($("#arc_name").data("cid")); }
		else { Tasks.addArc(); }
		hideTab("shapes");
	});

	//Delete all the tasks
	$("#reset").click(function() {
		Tasks.reset();
	});

	//Translate selected shape(s)
	$("#translate-submit").click(function(){
		Tasks.translate( null , $("#translate-x").val() , $("#translate-y").val() );
	});

	//Rotate selected shape(s)
	$("#rotate-submit").click(function(){
		Tasks.rotate( null , $("#rotate-angle").val() , $("input:radio[name='rotate_base']:checked").val() );
	});

	//Mirror selected shape(s)
	$("#mirror-submit").click(function(){
		Tasks.mirror( null , $("input:radio[name='rotate_base']:checked").val(),$("#rotate-angle").val());
	});

	//Run all the tasks
	$("#run").click(function(){
		var c = setGCode();
		
		//dashboard.addJob(c,s);
		fabmoDashboard.submitJob(c, {
				'name' : 'Rectangles',
				'description' : 'Cut ' + Tasks.length.toString() + ' rectangle(s)',
	            'filename' : 'rectangles.nc'
	    })
	});


	//Line Form : Coordinates invert
	$(".invert-pos").click(function(){
		invertForm();
	});

	//Change radius input to diameter input
	$(".radius_diameter").click(function(){ //For
		toogleDimPosCircle();
	});


});