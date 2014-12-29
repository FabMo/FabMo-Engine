/*
***
*** Library that should be shared between apps
***
*** Have the following functionalities :
***	- Store, Retrieve, Delete custom DATAS (settings, project, configuration...)
*** - Have access to a generic "Project Settings model", to facilite project settings (size, bit) & GCODE generation
*** - Function to generate simple GCODE commands (Line, circle, ellipse)
*** - Function to parse simple gcode to create a toolpath (add general offset, bit offset to cut outside / inside a line)
*/

/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|***************************** USER CONFIG SECTION ****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/

var allow_canvas = true;
var ratio = 900; //Max Width of the canvas


//Global var
var pi = 3.14159265358979323846264338327950288419716939937510582;
var s = null;
var Tasks = [] ;
var toolPath = null;
var backPath = null;
var gridPath = [];
var c = null;

//On Load Init
$(document).ready(function(){
	//Get settings or set default settings
	s = new settings();
	s.synchForm(); //Also synch view

	//Create Canvas
	if (allow_canvas) { c = new Canvas(); }
});





/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|**************************** localStorage Section ****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/


/* App Settings */
setAppSetting = function(app,setting,val) {
	//Save the parameter "val" under the variable "setting" in LocalStorage
	//App Should be the name of the current app
	if (localStorage.getItem('app-' + app)) {
		var s = JSON.parse(localStorage.getItem('app-' + app));
	}
	else {
		var s= {};
	}
	s[setting] = val;
	localStorage.setItem('app-' + app,JSON.stringify(s));
};

getAppSetting = function(app,setting) {
	//Get the parameter "setting" from the LocalStorage and return its value
	//App Should be the name of the current app
	if(localStorage.getItem('app-' + app)) {
		if(JSON.parse(localStorage.getItem('app-' + app))[setting])
			return JSON.parse(localStorage.getItem('app-' + app))[setting];
		else return false;
	}
	else {
		return false;
	}
};

delAppSetting = function(app,setting) {
	//Dell the parameter "setting" from the LocalStorage
	//App Should be the name of the current app
	if (localStorage.getItem('app-' + app)) {
		var s = JSON.parse(localStorage.getItem('app-' + app));
		delete s[setting];
		localStorage.setItem('app-' + app,JSON.stringify(s));
	}
};





/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|************************** Project Settings Section **************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/


/********** Model and function related to tool & project settings **********/

//The global object "s" is loaded by default, and contains the saved settings (localStorage) or the default ones.
settings = function(){
	var dashSettings = getAppSetting("straight-lines","s") ? getAppSetting("straight-lines","s") : false;

	this.x= dashSettings ? dashSettings.x : 6; //x Size of project
	this.y= dashSettings ? dashSettings.y : 8; //y Size of project
	this.z= dashSettings ? dashSettings.z : 0.3; //Max thickness of project
	this.dz= dashSettings ? dashSettings.dz : 0.1; //Depth of each z pass
	this.x0= dashSettings ? dashSettings.x0 : 0; //x Translation from X0
	this.y0= dashSettings ? dashSettings.y0 :0; //t Translation from Y0
	this.z0= dashSettings ? dashSettings.z0 : 0.5; //Delta z for air movements
	this.cut_speed= dashSettings ? dashSettings.cut_speed : 20; //1 to 600
	this.air_speed= dashSettings ? dashSettings.air_speed : 600; //1 to 600
	this.bit_d= dashSettings ? dashSettings.bit_d : 0.125; //Bit Diameter
};

//Update each setting by the content of the corresponding input (by id)
//If developpers want to change a setting from the app, it is possible to do :
settings.prototype.update = function(){
	//Input should have the following ID attribute : s_propertie
	for(var setting in this){
		if ($("#s_" + setting).length){
			this[setting]=parseFloat($("#s_" + setting).val());
		}
    }
};

//Fill each setting input, if existing in the app
settings.prototype.synchForm = function(){
	for(var setting in this){
		if ($("#s_" + setting).length){
			$("#s_" + setting).val(this[setting].toString());
		}
    }
};

//Set a specific setting attribute, can be called by the app
//Only works with existing settings.
settings.prototype.set = function(setting,value){
	if(this[setting]){
		this[setting]=value;
		return true;
	}
	else {
		return false;
	}
};

//Get a specific project attribute, can be called by the app
settings.prototype.get = function(setting){
	if(this[setting]){
		return this[setting]
	}
	else {
		return null;
	}
};


/********** User Interface Actions **********/

//Changes tool & project settings
$("#save-settings").click(function(){
	s.update(); //Update s object
	setAppSetting("straight-lines","s",s); //Save s object in localStorage

	//Reload Canvas Settings
	if(c) { c.loadSettings(); }

	//Re-calcul ToolPath
	if (Tasks) { Tasks.toolpath()} ;

	//Re-calcul GCode
	if (Tasks) { Tasks.gCode()} ;
});

//Changes tool & project settings
$("#default-settings").click(function(){
	delAppSetting("straight-lines","s");
	
	//Reinit s object
	s = new settings();
	s.synchForm();

	//Re-calcul ToolPath
	if (Tasks) { Tasks.toolpath()} ;

	//Re-calcul GCode
	if (Tasks) { Tasks.gCode()} ;
});






/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|*************************** Canvas Object Section ****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/


/********** Function for "Canvas" object = all the "Grid" section **********/
Canvas = function(){
	this.grid = [];
	//this.tasks = [];

	//Assignation of paper to the window, size of the project
	this.init();

	//Load Settings of project into paper
	this.loadSettings();
};

Canvas.prototype.init = function(){
	//Init Canvas
	$("#project_content").addClass("active"); 	//Resolve screen dimensions problem by displaying temporary the section
	paper.install(window); 						//Assign paper functions to window object
	paper.setup('myCanvas');					//Setup the #myCanvas element (html/css/js)
	this.resize();								//Call Resize canvas function
	$("#project_content").removeClass("active");//Resolve screen dimensions problem
};


//Similar to resize, but does less, seems important for initialisation of the app, to see...
Canvas.prototype.setRatio = function(){
	$(window).resize( function() {
		$("#canvas-container canvas").width($("#canvas-container").width());
		$("#canvas-container canvas").height(($("#canvas-container").width()/s.x)*s.y);
		$("#canvas-container").height(($("#canvas-container").width()/s.x)*s.y);
	});
};

Canvas.prototype.resize = function(){
	$("#project_content").addClass("active"); //Resolve screen dimensions problem

	//Set the size of the paper object proportionnaly to the size of the project (from setting object)
	paper.view.viewSize = new Size(ratio,(ratio/s.x)*s.y);

	//Same thing with the canvas element and the canvas container (important for smartphone / tablet view)
	$("#canvas-container canvas").width($("#canvas-container").width());
	$("#canvas-container canvas").height(($("#canvas-container").width()/s.x)*s.y);
	$("#canvas-container").height(($("#canvas-container").width()/s.x)*s.y);


	$("#project_content").removeClass("active"); //Resolve screen dimensions problem
};

//Load Settings from the settings element "s" (size of the project) and synch it to the canvas
//Draws the canvas grid (variable graduations)
Canvas.prototype.loadSettings = function(){
	if (!s){
		//In this case, there is not s object
		console.log("No Settings object, Canvas use may cause App bugs")
	}
	else {
		//Resolve screen dimensions problem by displaying temporary the section
		$("#project_content").addClass("active");
		this.resize();

		//Clear
		paper.project.clear(); //Not effective ?

		//Choose X & Y graduation depending to project size
		var sStep = 1;	var mStep = 5;	var lStep = 10;
		var stepx = s.x < 100 ? (s.x < 10 ? sStep : mStep) : lStep;
		var stepy = s.y < 100 ? (s.y < 10 ? sStep : mStep) : lStep;

		//Enter Dimensions to grid container
		$("#xScale").html('X : ' + s.x + '" ' + '(' + stepx + '"/grad)');
		$("#yScale").html('y : ' + s.y + '" ' + '(' + stepy + '"/grad)');

	    //X graduation from left
	    for (var i = stepx ; i < s.x ; i+=stepx) {
	        var topPoint = new paper.Point( this.xPos(i) , this.yPos(s.y) );
	        var bottomPoint = new paper.Point(this.xPos(i), this.yPos(0));
	        var aLine = new paper.Path.Line(topPoint, bottomPoint);
	        aLine.strokeColor = '#ddd';
	        aLine.strokeWidth = 3; //((i%10)==0) ? 6 : (((i%10)==0) ? 4 : 2);
	    	this.grid.push(aLine);
	    }

	    //Y graduation from bottom
	    for (var i = stepy ; i < s.y ; i+=stepy) {
	        var leftPoint = new paper.Point( this.xPos(0) , this.yPos(i) );
	        var rightPoint = new paper.Point( this.xPos(s.x) , this.yPos(i) );
	        var aLine = new paper.Path.Line(leftPoint, rightPoint);
	        aLine.strokeColor = '#ddd';
	        aLine.strokeWidth = 3; //((i%10)==0) ? 5 : (((i%10)==0) ? 4 : 3);
	        this.grid.push(aLine);
	    }

	    paper.view.draw(); //Setup //Activate

	    //Resolve screen dimensions problem
	    $("#project_content").removeClass("active");
	}
};

//Return xPos converted to to canvas size 	-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.xPos = function(x){
	return ( paper.view.bounds.left + x * (paper.view.bounds.width / s.x) );
};

//Return yPos converted to to canvas size 	-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.yPos = function(y){
	return ( paper.view.bounds.bottom - y * (paper.view.bounds.height / s.y) );
};

//Retur, thickness (strokeWidth) 			-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.w = function(w){
	return ( w * (paper.view.bounds.height / s.y) );
}




// --- Line : Add / Edit / Remove --- //
Canvas.prototype.addLine = function(l){
	//Add line view
	l.canvas = new paper.Path.Line(
		new paper.Point( this.xPos(l.x0) , this.yPos(l.y0) ),
		new paper.Point( this.xPos(l.x1) , this.yPos(l.y1) )
	);
    l.canvas.strokeColor = 'rgba(77, 135, 29, 0.8)';
    l.canvas.strokeWidth = 3;

    //Add toolPath View
    l.tCanvas = new paper.Path.Line(
		new paper.Point( this.xPos(l.t_x0) , this.yPos(l.t_y0) ),
		new paper.Point( this.xPos(l.t_x1) , this.yPos(l.t_y1) )
	);
    l.tCanvas.strokeColor = 'rgba(156, 33, 12, 0.25)'//'rgba(215, 44, 44, 0.6)';
    l.tCanvas.strokeWidth = this.w(s.bit_d);
    l.tCanvas.strokeCap = 'round';
	l.tCanvas.dashArray = [l.tCanvas.strokeWidth*2, l.tCanvas.strokeWidth*3];

	paper.view.draw(); //Setup //Activate
};

Canvas.prototype.removeLine = function(l){
	l.canvas.remove();
	l.tCanvas.remove();
	paper.view.draw(); //Setup //Activate
};


// --- Point : Add / Edit / Remove --- //
Canvas.prototype.addPoint = function(x,y,size){
	return true;
};


// --- Circle : Add / Edit / Remove --- //
Canvas.prototype.addCircle = function(c){ //Totaly change that, and adapt to circle
	//Add line view
	c.canvas = [];
	console.log(this.xPos(c.x));
    console.log(this.yPos(c.y));
    console.log(this.yPos(c.y - c.y0));

	var p = new paper.Path.Circle(
		new paper.Point( this.xPos(c.x) , this.yPos(c.y) ),
		( this.yPos(c.y - c.y0) - paper.view.bounds.height )
	);
    p.strokeColor = 'rgba(77, 135, 29, 0.8)';
    p.strokeWidth = 3;

    c.canvas.push(p);

    //Add toolPath View
    c.tCanvas = [];
    
    var i = 0;
    console.log("lenght");
    console.log(c.t.length);

    for(i=0 ; i< c.t.length ; i++){
    	var p2 = new paper.Path.Circle( new paper.Point( this.xPos(c.t[i].x) , this.yPos(c.t[i].y) ) ,
    		( this.yPos(c.t[i].y - c.t[i].y0) - paper.view.bounds.height ) );
    	/*
	    p2.strokeColor = 'rgba(156, 33, 12, 0.25)'//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d);
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*3];
		*/
		//Test the circle object, and the c.t[i] object before.

		c.tCanvas.push(p2);
    }

	paper.view.draw(); //Setup //Activate
};

Canvas.prototype.removeCircle = function(c){ //Make it generic with line removeFromCanvas / removeView
	$.each( c.canvas , function(i,shape){
		shape.remove();
	});
	$.each( c.tCanvas , function(i,shape){
		shape.remove();
	});

	paper.view.draw(); //Setup //Activate
};





/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|**************************** GCode Object Section ****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/

gcode = function(){
	this.body="";
	this.init();
};

/********** Initial functions **********/
gcode.prototype.init = function(){
	//Header : initial commands
	this.header = "";

	//Go to Z security position
	this.header += 'G1Z' + s.z0.toString() + 'F' + s.air_speed + '\n';

	//Go to X0 Y0, compensated with offset
	this.header += 'G1X' + s.x0.toString() + 'Y' + s.y0.toString() + 'F' + s.air_speed + '\n';


	//Footer : end of job cillabd
	this.footer = "";

	//Go to Z security position
	this.footer += 'G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	//Go to end position
	this.footer += 'G1X6Y8F' + s.air_speed + '\n';
};

gcode.prototype.securZ = function(){
	//Go to z over the project
	this.body +='G1Z' + s.z0 + 'F' + s.air_speed + '\n';
};

gcode.prototype.getGc = function(){
	return ("" + this.header + this.body + this.footer);
};

gcode.prototype.G1 = function(x,y,z,s){
	//Not working yet
	console.log('G1' + (x ? 'X' + (x + s.x0).toString() : '') + (y ? 'Y' + (y + s.y0).toString() : '') + (z ? 'Z' + z.toString() : '') + 'F' + s + '\n');
	return ('G1' + (x ? 'X' + (x + s.x0) : '') + (y ? 'Y' + (y + s.y0) : '') + (z ? 'Z' + z : '') + 'F' + s + '\n');
};

/********** GCode Shapes **********/
gcode.prototype.line = function(x0,y0,z0,x1,y1,z1){
	//x0 & y0 : start point
	//x1 & y1 : end point
	//z0 : start depth
	//z1 : end depth

	this.body += ""

	var curHeight = 0;
	while(curHeight > z1) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < z1) {curHeight = z1;} //Set -z limit

		//Go to beginning of the line
		this.body +='G1X' + (x0 + s.x0) + 'Y' + (y0 + s.y0) + 'F' + s.air_speed + '\n';

		//Go to the new depth
		this.body +='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

		//Go to the end of the line
		this.body +='G1X' + (x1 + s.x0) + 'Y' + (y1 + s.y0) + 'F' + s.cut_speed + '\n';

		//Go to z over the project
		this.body +='G1Z' + s.z0 + 'F' + s.air_speed + '\n'; //Maybe will be removed (see when security is needed)
	}
};

gcode.prototype.circle = function(x , y , x0 , y0 , z0 , x1 , y1 , z1){
	//x0 & y0 : start point
	//x1 & y1 : end point
	//z0 : start depth
	//z1 : end depth

	this.body += ""

	var curHeight = 0;
	while(curHeight > z1) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < z1) {curHeight = z1;} //Set -z limit

		//Go to beginning of the circle
		this.body +='G1X' + (x0 + s.x0) + 'Y' + (y0 + s.y0) + 'F' + s.air_speed + '\n';

		//Go to the new depth
		this.body +='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

		//Go to the end of the circle (or part of the circle)
		this.body +='G2X' + (x1 + s.x0) + 'Y' + (y1 + s.y0) + 'I' + (x1 - x + s.x0) + 'J' + (y1 - y + s.y0) + 'F' + s.cut_speed + '\n';

		//Go to z over the project
		this.body +='G1Z' + s.z0 + 'F' + s.air_speed + '\n';
	}
};





/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|**************************** Tasks Object Section ****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/


/********** Function for "Tasks" object = all the tasks **********/
Tasks.reset = function(){
	$.each(this, function(index,t){
		t.removeCanvas();
	});

	//Set the number of Tasks to 0
	this.length = 0;

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addLine = function(){
	//Create a new line (task)
	var t = new line(this.length.toString()); //Assume that it's a line

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();

	//Synch View

};

Tasks.addCircle = function(){
	//Create a new line (task)
	var t = new circle(this.length.toString()); //Assume that it's a line

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.remove = function(id){
	//remove the task from Canvas (if canvas)
	Tasks[Tasks.pos(id)].removeCanvas();

	//Search the position of the line to remove. Then remove
	this.splice(Tasks.pos(id), 1);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.edit = function(id){
	//Search the position of the line to edit & get this line
	var t = this[this.pos(id)];

	//Update it status to current
	t.setCurrent();

	//Load Form with properties
	t.setForm();

	//View Tasks
	this.view();
};

Tasks.save = function(id){
	//Search for the line and add it
	if(this.pos(id)){
		var t = this[this.pos(id)];
		t.getForm();

		//Remove current
		t.resetCurrent();

		//Save Tasks Model
		setAppSetting("straight-lines","Tasks",this);

		//View Tasks
		this.view();
	}

	//If line not founded, create a new one
	else {
		this.addCircle();
	}
};

Tasks.view = function(){
	var str=""; //Str will be the HTML content
	$.each(this, function(index,t){
		str += t.addTaskList(); //For each Line, we add the HTML content
	});
	$(".list-tasks-container").html(str); //Set this into the HTML table

	//Synch the click listener on this view
	listenClickTasks();
};

Tasks.toolpath = function(){
	$.each(this, function(i,t){
		t.toolpath();
	});
};

Tasks.gCode = function(){
	$.each(this, function(i,t){
		t.gCode();
	});
}

Tasks.pos = function(id) {
	var pos = null;
	$.each(this, function(i,t) {
		if(t.id == id) {
			pos = i;
		}
	});
	return pos;
};

//Sort Line by position : not used yet
Tasks.sort = function(){
	this.sort(function(a,b) {return (a.id > b.id) ? 1 : ((b.id > a.id) ? -1 : 0);} );
};










/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|************************* FORM OBJECTS AND functions *************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/

/*
*** Shared Functions ***
*/

calculAlpha = function(x,y,x0,y0){
	var alpha = 0;

	if ( (y0!=y) && (x0!=x) ) {
		alpha = Math.atan((y0-y)/(x0-x));
	}
	else {
		if(y0 == y) {
			if((x0-x)>0) 	{ alpha=0; }
			else 			{ alpha=pi; }
		}
		else if(x0 == x) {
			if((y0-y)>0) 	{ alpha=pi/2; }
			else 			{ alpha=3*pi/2; }
		}
	}

	return alpha;
};



/*
*** Model and function of a single Line ***
*/

line = function(l,x0,y0,x1,y1,name,side) {
	this.id="line-" + l;
	this.pos = l;
	this.canvas = null;
	this.tCanvas = null;
	name ? this.name = name : (this.name = $("#line_name").val() 	? 	$("#line_name").val() : this.id);
	this.current=0;
	this.x0 = x0 ? x0 : ($("#line_x0").length 	? 	parseFloat($("#line_x0").val())	: 0); //X start position of a line
	this.y0 = y0 ? y0 : ($("#line_y0").length 	?	parseFloat($("#line_y0").val()) : 0); //Y start position of a line
	this.x1 = x1 ? x1 : ($("#line_x1").length	?	parseFloat($("#line_x1").val()) : 0); //X end position of a line
	this.y1 = y1 ? y1 : ($("#line_y1").length	?	parseFloat($("#line_y1").val()) : 0); //Y end position of a line
	this.side = side ? side : ($("input:radio[name='line_side']:checked").length	?	parseInt($("input:radio[name='line_side']:checked").val()) : 1); //3 = center, 1 = Left, 2 = Right

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#line_name").val("");
	$("#line_name").data("cid","");
};

line.prototype.update = function(x0,y0,x1,y1,name,side) {
	//First delete view
	this.removeCanvas();

	this.x0=x0; //X start position of a line
	this.y0=y0; //Y start position of a line
	this.x1=x1; //X end position of a line
	this.y1=y1; //Y end position of a line
	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "Line" + pos;

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};

//Should move to Tasks (set a task as current, and not a form)
line.prototype.setCurrent = function() { this.current=1 };
line.prototype.resetCurrent = function() { this.current=0 };

line.prototype.getForm = function(){
	//Add attributes
	this.update(
		$("#line_x0").length 	? 	parseFloat($("#line_x0").val())	: null,
		$("#line_y0").length 	?	parseFloat($("#line_y0").val()) : null,
		$("#line_x1").length	?	parseFloat($("#line_x1").val()) : null,
		$("#line_y1").length	?	parseFloat($("#line_y1").val()) : null,
		this.name = $("#line_name").val() 	? 	$("#line_name").val() : this.id,
		$("input:radio[name='line_side']:checked").length	?	parseInt($("input:radio[name='line_side']:checked").val()) : null
	);

	//Reset the value of "name" input & unique id "cid"
	$("#line_name").val("");
	$("#line_name").data("cid","");
};

line.prototype.setForm = function(){
	if ($("#line_name").length)	{ $("#line_name").val(this.name); }
	if ($("#line_name").length)	{ $("#line_name").data("cid",this.id); }
	if ($("#line_x0").length) 	{ $("#line_x0").val(this.x0.toString()); }
	if ($("#line_y0").length) 	{ $("#line_y0").val(this.y0.toString()); }
	if ($("#line_x1").length) 	{ $("#line_x1").val(this.x1.toString()); }
	if ($("#line_y1").length) 	{ $("#line_y1").val(this.y1.toString()); }
	if ($("input:radio[name='line_side']:checked").length)	{ $("input:radio[name='line_side'][value='"+ this.side +"']").attr("checked",true); }
};

line.prototype.toolpath = function() {
	var alpha=0;

	var x0 = this.x0; 		var x1 = this.x1; 		var y0 = this.y0; 		var y1 = this.y1;
	this.t_x0 = this.x0;	this.t_x1 = this.x1;	this.t_y0 = this.y0;	this.t_y1 = this.y1;

	if(this.side != 3) {
		alpha = calculAlpha(x0,y0,x1,y1);

		if(this.side == 1) { alpha = pi/2 + alpha; } //Left
		else { alpha = 3*pi/2 + alpha; } //Right

		this.t_x0 += (s.bit_d/2) * Math.cos(alpha);
		this.t_x1 += (s.bit_d/2) * Math.cos(alpha);
		this.t_y0 += (s.bit_d/2) * Math.sin(alpha);
		this.t_y1 += (s.bit_d/2) * Math.sin(alpha);
	}
};

line.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.x0.toString() + "," + this.y0.toString() + ") - (" + this.x1.toString() + "," + this.y1.toString() + ")</td>";
	str += "<td class='edit'><span>E</span></td>";
	str += "<td class='delete'><span>D</span></td>";
	str += "</tr>";
	return str;
};

//No use of this function ???
line.prototype.viewToolPath = function() {
	//Read the x0... y1 of the line and trace a red / Blue line
	//Read the toolPath of the line and trace a grey shadow
	return true;
};

line.prototype.removeCanvas = function(){
	if(c && this.canvas){
		c.removeLine(this);
	}
};

line.prototype.addCanvas = function(){
	if(c){
		c.addLine(this);
	}
};

line.prototype.gCode = function(c){
	//c.line( this.t_x0 , this.t_y0 , s.z0 , this.t_x1 , this.t_y1 , -s.z);
	this.gCode = "";

	var curHeight = 0;
	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit

		//Go to beginning of the line
		this.gCode +='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.air_speed + '\n';

		//Go to the new depth
		this.gCode +='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

		//Go to the end of the line
		this.gCode +='G1X' + (this.x1 + s.x0) + 'Y' + (this.y1 + s.y0) + 'F' + s.cut_speed + '\n';

		//Go to z over the project
		this.gCode +='G1Z' + s.z0 + 'F' + s.air_speed + '\n'; //Maybe will be removed (see when security is needed)
	}

	return this.gCode;
}




/*
*** Model and function of a single circle ***
*/


//Can also do a part of a circle (if x0,y0 != of x1,y1)
circle = function(l,x,y,x0,y0,x1,y1,name,side,diam) {
	this.id="circle-" + l;
	this.pos = l;
	this.canvas = []; //Become an array, even if there is just 1 shape for the canvas, can be more than one for other objects...
	this.tCanvas = [];
	name ? this.name = name : (this.name = $("#circle_name").val() 	? 	$("#circle_name").val() : this.id);
	this.current=0;
	this.x = x ? x : ($("#circle_x").length 	? 	parseFloat($("#circle_x").val())	: 0); //X center of the circle
	this.y = y ? y : ($("#circle_y").length 	?	parseFloat($("#circle_y").val()) : 0); //Y center of the circle
	this.x0 = x0 ? x0 : ($("#circle_x0").length 	? 	parseFloat($("#circle_x0").val())	: 0); //X start position of a circle
	this.y0 = y0 ? y0 : ($("#circle_y0").length 	?	parseFloat($("#circle_y0").val()) : 0); //Y start position of a circle
	this.x1 = x1 ? x1 : ($("#circle_x1").length	?	parseFloat($("#circle_x1").val()) : 0); //X end position of a circle
	this.y1 = y1 ? y1 : ($("#circle_y1").length	?	parseFloat($("#circle_y1").val()) : 0); //Y end position of a circle
	this.side = side ? side : ($("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : 1); //3 = center, 1 = Left, 2 = Right

	if ( ($("#circle_diam").length) || diam ||  ($("#circle_radius").length) || radius ) { this.circleByDiameter(); } //If Programmer Use a form with a circle diameter instead of x0,y0,x1,y1 (more used for a circle arc)

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#circle_name").val("");
	$("#circle_name").data("cid","");
};

circle.prototype.circleByDiameter = function(){
	var d = null; var r = null;
	if ( $("#circle_diam").length ) { d = parseFloat($("#circle_diam").val()); }
	else if ( $("#circle_radius").length ) { r = parseFloat($("#circle_radius").val()); }

	if (d) { r=d/2};

	this.x0 = this.x;
	this.x1 = this.x;
	this.y0 = this.y + r;
	this.y1 = this.y + r;

	console.log(this);
};

circle.prototype.update = function(x,y,x0,y0,x1,y1,name,side) {
	//First delete view
	this.removeCanvas();
	this.x=x; //X center of the circle
	this.y=y; //Y center of the circle
	this.x0=x0; //X start position of a circle
	this.y0=y0; //Y start position of a circle
	this.x1=x1; //X end position of a circle
	this.y1=y1; //Y end position of a circle
	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if ( ($("#circle_diam").length) || diam ||  ($("#circle_radius").length) || radius ) { this.circleByDiameter(); } //If Programmer Use a form with a circle diameter instead of x0,y0,x1,y1 (more used for a circle arc)

	if(name) this.name=name;
	//else name = "circle" + pos;

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};

//Should move to Tasks (set a task as current, and not a form)
circle.prototype.setCurrent = function() { this.current=1 };
circle.prototype.resetCurrent = function() { this.current=0 };

circle.prototype.getForm = function(){
	//Add attributes
	this.update(
		$("#circle_x").length 	? 	parseFloat($("#circle_x").val())	: null,
		$("#circle_y").length 	?	parseFloat($("#circle_y").val()) : null,
		$("#circle_x0").length 	? 	parseFloat($("#circle_x0").val())	: null,
		$("#circle_y0").length 	?	parseFloat($("#circle_y0").val()) : null,
		$("#circle_x1").length	?	parseFloat($("#circle_x1").val()) : null,
		$("#circle_y1").length	?	parseFloat($("#circle_y1").val()) : null,
		this.name = $("#circle_name").val() 	? 	$("#circle_name").val() : this.id,
		$("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : null
	);

	//Reset the value of "name" input & unique id "cid"
	$("#circle_name").val("");
	$("#circle_name").data("cid","");
};

circle.prototype.setForm = function(){
	if ($("#circle_name").length)	{ $("#circle_name").val(this.name); }
	if ($("#circle_name").length)	{ $("#circle_name").data("cid",this.id); }
	if ($("#circle_x").length) 		{ $("#circle_x").val(this.x0.toString()); }
	if ($("#circle_y").length) 		{ $("#circle_y").val(this.y0.toString()); }
	if ($("#circle_x0").length) 	{ $("#circle_x0").val(this.x0.toString()); }
	if ($("#circle_y0").length) 	{ $("#circle_y0").val(this.y0.toString()); }
	if ($("#circle_x1").length) 	{ $("#circle_x1").val(this.x1.toString()); }
	if ($("#circle_y1").length) 	{ $("#circle_y1").val(this.y1.toString()); }
	if ($("input:radio[name='circle_side']:checked").length)	{ $("input:radio[name='circle_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
circle.prototype.toolpath = function() {
	this.t=[];

	if (this.side == 3){ //Case toolpath on the circle
		var e={};
		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0;	//Start Point X
		e.x1=this.x1;	//End Point X
		e.y0=this.y0;	//Start Point Y
		e.y1=this.y1;	//End Point Y

		this.t.push(e);	//Add circle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the circle
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var alpha1 = calculAlpha(this.x,this.y,this.x1,this.y1);
		var e={};

		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0 + (s.bit_d/2) * Math.cos(alpha0);
		e.x1=this.x1 + (s.bit_d/2) * Math.cos(alpha1);
		e.y0=this.y0 + (s.bit_d/2) * Math.sin(alpha0);
		e.y1=this.y1 + (s.bit_d/2) * Math.sin(alpha1);

		this.t.push(e);	//Add circle to thel ist of toolpaths
	}
	else if (this.side == 2){ //Case toolpath inside the circle : do all the inside
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var alpha1 = calculAlpha(this.x,this.y,this.x1,this.y1);
		var oldX0 = this.x;
		var oldY0 = this.y;
		var oldX1 = this.x;
		var oldY1 = this.y;

		while( (oldY0 < this.y0)
			){ //ABS value
			var e={};
			e.x=this.x; //Center X : never changes
			e.y=this.y; //Center Y : never changes

			//Check if current circle is not too big
			if ( oldX0 > (this.x0 - (s.bit_d/2) * Math.cos(alpha0)) )  { oldX0 = (this.x0 - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( oldY0 > (this.y0 - (s.bit_d/2) * Math.cos(alpha0)) )  { oldY0 = (this.y0 - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( oldX1 > (this.x1 - (s.bit_d/2) * Math.cos(alpha1)) )  { oldX1 = (this.x1 - (s.bit_d/2) * Math.cos(alpha1)); end=1;}
			if ( oldY1 > (this.y1 - (s.bit_d/2) * Math.cos(alpha1)) )  { oldY1 = (this.y1 - (s.bit_d/2) * Math.cos(alpha1)); end=1;}

			//Put the value of the new Circle
			e.x0 = oldX0;
			e.x1 = oldX1;
			e.y0 = oldY0;
			e.y1 = oldY1;

			//Increment position for next circle
			oldX0 += (s.bit_d) * Math.cos(alpha0);
			oldY0 += (s.bit_d) * Math.sin(alpha0);
			oldX1 += (s.bit_d) * Math.cos(alpha1);
			oldY1 += (s.bit_d) * Math.sin(alpha1);

			this.t.push(e);	//Add circle to the list of toolpaths
		}
	}
	

	console.log(this);
};

circle.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.x.toString() + "," + this.y.toString() + ") R=" + (this.y0 - this.y).toString() + "</td>";
	str += "<td class='edit'><span>E</span></td>";
	str += "<td class='delete'><span>D</span></td>";
	str += "</tr>";
	return str;
};


//No use of this function ???
circle.prototype.viewToolPath = function() {
	//Read the x0... y1 of the circle and trace a red / Blue circle
	//Read the toolPath of the circle and trace a grey shadow
	return true;
};

circle.prototype.removeCanvas = function(){
	if(c && this.canvas){
		c.removeCircle(this);
	}
};

circle.prototype.addCanvas = function(){
	if(c){
		c.addCircle(this);
	}
};

circle.prototype.gCode = function(c){
	this.gCode="";
	$.each(this.t , function(i, t){
		//c.circle( t.x , t.y , t.x0 , t.y0 , s.z0 , t.x1 , t.y1 , -s.z );

		var curHeight = 0;
		while(curHeight > z1) {
			curHeight -= s.dz; //Lower the new z
			if (curHeight < z1) {curHeight = z1;} //Set -z limit

			//Go to beginning of the circle
			this.gCode +='G1X' + (x0 + s.x0) + 'Y' + (y0 + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			this.gCode +='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the end of the circle (or part of the circle)
			this.gCode +='G2X' + (x1 + s.x0) + 'Y' + (y1 + s.y0) + 'I' + (x1 - x + s.x0) + 'J' + (y1 - y + s.y0) + 'F' + s.cut_speed + '\n';

			//Go to z over the project
			this.gCode +='G1Z' + s.z0 + 'F' + s.air_speed + '\n';
		}
	});

	return this.gCode;
}