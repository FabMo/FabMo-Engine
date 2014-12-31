/*
***
*** Library that should be shared between apps
***
*** Have the following functionalities :
***	- Store, Retrieve, Delete custom DATAS (settings, project, configuration...)
*** - Have access to a generic "Project Settings model", to facilite project settings (size, bit) & GCODE generation
*** - Function to generate simple GCODE commands (Line, rectangle, circle, arc, ellipse)
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
	if (Tasks) { Tasks.refreshGCode()} ;

	//Re-calcul Canvas
	if (Tasks) { Tasks.refreshCanvas()} 

	/*
	*** Nota ***
	*/
	//There is no synch between toolPatch and Gcode / Canvas
	//Create / Refresh GCode can be called from Each Shape's Toolpath function
	//Create / Refresh Canvas can be called from Each Shape's GCode function
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
	if (Tasks) { Tasks.refreshGCode()} ;

	//Re-calcul Canvas
	if (Tasks) { Tasks.refreshCanvas()} ;

	/*
	*** Nota ***
	*/
	//There is no synch between toolPatch and Gcode / Canvas
	//Create / Refresh GCode can be called from Each Shape's Toolpath function
	//Create / Refresh Canvas can be called from Each Shape's GCode function
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


// --- Rectangle : Add / Edit / Remove --- //
Canvas.prototype.addRectangle = function(r){
	//Add line view
	r.canvas = [];

	var p = new paper.Path.Rectangle(
		new paper.Point( this.xPos(r.x0) , this.yPos(r.y0) ),
		new paper.Point( this.xPos(r.x1) , this.yPos(r.y1) )
	);
    p.strokeColor = 'rgba(77, 135, 29, 0.8)';
    p.strokeWidth = 3;

    r.canvas.push(p);

    //Add toolPath View
    r.tCanvas = [];
    
    var i = 0;

    for(i=0 ; i < r.t.length ; i++){
    	var p2 = new paper.Path.Rectangle( 
    		new paper.Point( this.xPos(r.t[i].x0) , this.yPos(r.t[i].y0) ) ,
    		new paper.Point( this.xPos(r.t[i].x1) , this.yPos(r.t[i].y1) )
    	);
	    p2.strokeColor = 'rgba(156, 33, 12, 0.25)'//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

		r.tCanvas.push(p2);
    }

	paper.view.draw(); //Setup //Activate
};

Canvas.prototype.removeRectangle = function(r){ //Make it generic with line removeFromCanvas / removeView
	$.each( r.canvas , function(i,shape){
		shape.remove();
	});
	$.each( r.tCanvas , function(i,shape){
		shape.remove();
	});

	paper.view.draw(); //Setup //Activate
};


// --- Circle : Add / Edit / Remove --- //
Canvas.prototype.addCircle = function(c){
	//Add line view
	c.canvas = [];

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

    for(i=0 ; i < c.t.length ; i++){
    	var p2 = new paper.Path.Circle( 
    		new paper.Point( this.xPos(c.t[i].x) , this.yPos(c.t[i].y) ) ,
    		( this.yPos(c.t[i].y - c.t[i].y0) - paper.view.bounds.height ) 
    	);
	    p2.strokeColor = 'rgba(156, 33, 12, 0.25)'//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

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


// --- Arc : Add / Edit / Remove --- //
Canvas.prototype.addArc = function(a){
	//Add line view
	a.canvas = [];

	var p = new paper.Path.Arc(
		new paper.Point( this.xPos(a.x) , this.yPos(a.y) ),
		( this.yPos(a.y - a.y0) - paper.view.bounds.height )
	);
    p.strokeColor = 'rgba(77, 135, 29, 0.8)';
    p.strokeWidth = 3;

    a.canvas.push(p);

    //Add toolPath View
    a.tCanvas = [];
    
    var i = 0;

    for(i=0 ; i< a.t.length ; i++){
    	var p2 = new paper.Path.Arc( new paper.Point( this.xPos(a.t[i].x) , this.yPos(a.t[i].y) ) ,
    		( this.yPos(a.t[i].y - a.t[i].y0) - paper.view.bounds.height ) );
    	p2.strokeColor = 'rgba(156, 33, 12, 0.25)'//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

		c.tCanvas.push(p2);
    }

	paper.view.draw(); //Setup //Activate
};

Canvas.prototype.removeArc = function(a){ //Make it generic with line removeFromCanvas / removeView
	$.each( a.canvas , function(i,shape){
		shape.remove();
	});
	$.each( a.tCanvas , function(i,shape){
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
	//Header : Presentation
	this.header = ";Hi,I am a gCode object created with FabMo Shapes Library \n";

	//Header : initial commands
	this.header += ";Absolutes Positions \n";
	this.header += "G90 \n";

	//Go to Z security position
	this.header += ";Z Security Position \n";
	this.header += 'G1Z' + s.z0.toString() + 'F' + s.air_speed + '\n';

	//Go to X0 Y0, compensated with offset
	this.header += ";Go To X0/Y0 compensated with offset (if any) \n";
	this.header += 'G1X' + s.x0.toString() + 'Y' + s.y0.toString() + 'F' + s.air_speed + '\n';


	//Footer : end of job
	this.footer += ";Arriving to the Footer of GCode File \n";

	//Go to Z security position
	this.footer += ";Z Security Position \n";
	this.footer += 'G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	//Go to end position
	this.footer += ";Go to the end position of a Handibot \n";
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
	var t = new line(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();

	//Synch View

};

Tasks.addRectangle = function(){
	//Create a new line (task)
	var t = new rectangle(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addCircle = function(){
	//Create a new line (task)
	var t = new circle(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addEllipse = function(){
	//Create a new line (task)
	var t = new ellipse(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addRectangle = function(){
	//Create a new line (task)
	var t = new rectangle(this.length.toString());

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
	if(this.pos(id) != null){
		console.log("Founded");

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
		this.addCircle(); //Nota : should be replaced by a callback passed in parameter, or a generic call
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

Tasks.refreshGCode = function(){
	$.each(this, function(i,t){
		t.gCode();
	});
}

Tasks.refreshCanvas = function(){
	$.each(this, function(i,t){
		t.removeCanvas();
		t.addCanvas();
	});
};

Tasks.gCode = function(code){
	var i = 0;
	for(i=0;i<Tasks.length;i++){
		code.body = code.body + Tasks[i].c;
		console.log(code.body);
	}
};

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
	this.c = "";
	code= "";
	var curHeight = 0;
	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit

		//Go to beginning of the line
		code += ";***** STARTING A NEW LINE *****\n";
		code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.air_speed + '\n';

		//Go to the new depth
		code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

		//Go to the end of the line
		code+='G1X' + (this.x1 + s.x0) + 'Y' + (this.y1 + s.y0) + 'F' + s.cut_speed + '\n';

		//Go to z over the project
		code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n'; //Maybe will be removed (see when security is needed)
	}
	this.c = code;
	return this.c;
}





/*
*** Model and function of a single rectangle ***
*/


//Can also do a part of a rectangle (if x0,y0 != of x1,y1)
rectangle = function(l,x0,y0,x1,y1,side,name) {
	//These variables will be checked later
	var x0 = x0;
	var x1 = x1;
	var y0 = y0;
	var y1 = y1;

	if (l) {
		this.pos = l;
		this.id="rectangle-" + l;
	}

	//Arrays for canvas view, and Toolpath view
	this.canvas = []; //Become an array, even if there is just 1 shape for the canvas, can be more than one for other objects...
	this.tCanvas = [];

	this.current=0;

	//If a name is applicable, we set the custom name
	name ? this.name = name : (this.name = ($("#rectangle_name").val() 	? 	$("#rectangle_name").val() : this.id));

	//Set the start point
	this.x0 = x0 ? x0 : ($("#rectangle_x0").length 	? 	parseFloat($("#rectangle_x0").val())	: 0); //X start of the rectangle
	this.y0 = y0 ? y0 : ($("#rectangle_y0").length 	?	parseFloat($("#rectangle_y0").val()) : 0); //Y start of the rectangle

	//Set the end point
	if(!x1){
		if( ($("#rectangle_x1").length) && $("#rectangle_x1").hasClass("active") ){
			x1 = parseFloat($("#rectangle_x1").val());
		}
		else if( ($("#rectangle_w").length) && $("#rectangle_w").hasClass("active") ){
			x1 = this.x0 + parseFloat($("#rectangle_w").val());
		}
	}
	if(!y1){
		if( ($("#rectangle_y1").length) && $("#rectangle_y1").hasClass("active") ){
			y1 = parseFloat($("#rectangle_y1").val());
		}
		else if( ($("#rectangle_h").length) && $("#rectangle_h").hasClass("active") ){
			y1 = this.y0 + parseFloat($("#rectangle_h").val());
		}
	}
	this.x1 = x1; //X end of the rectangle
	this.y1 = y1; //Y end of the rectangle

	//Check for the toolpath side or assign the default one
	this.side = side ? side : ($("input:radio[name='rectangle_side']:checked").length	?	parseInt($("input:radio[name='rectangle_side']:checked").val()) : 1); //3 = on rectangle, 1 = exterior, 2 = Hole inside

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#rectangle_name").val("");
	$("#rectangle_name").data("cid","");
};

rectangle.prototype.update = function(x0,y0,x1,y1,side,name) {
	//First delete view
	this.removeCanvas();

	//Set the center
	this.x0 = x0 ;
	this.y0 = y0 ;
	this.x1 = x1 ;
	this.y1 = y1 ;

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "rectangle" + pos;

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};

//Should move to Tasks (set a task as current, and not a form)
rectangle.prototype.setCurrent = function() { this.current=1 };
rectangle.prototype.resetCurrent = function() { this.current=0 };

rectangle.prototype.getForm = function(){
	//Add attributes
	this.update(
		$("#rectangle_x0").length 	? 	parseFloat($("#rectangle_x0").val())	: null,
		$("#rectangle_y0").length 	?	parseFloat($("#rectangle_y0").val()) : null,
		$("#rectangle_x1").length 	? 	parseFloat($("#rectangle_x1").val())	: ($("#rectangle_w").length ? parseFloat($("#rectangle_x0").val() + $("#rectangle_w").val()) : null),
		$("#rectangle_y1").length 	? 	parseFloat($("#rectangle_y1").val())	: ($("#rectangle_h").length ? parseFloat($("#rectangle_y0").val() + $("#rectangle_h").val()) : null),
		$("input:radio[name='rectangle_side']:checked").length	?	parseInt($("input:radio[name='rectangle_side']:checked").val()) : null,
		this.name = $("#rectangle_name").val() 	? 	$("#rectangle_name").val() : this.id
	);

	//Reset the value of "name" input & unique id "cid"
	$("#rectangle_name").val("");
	$("#rectangle_name").data("cid","");
};

rectangle.prototype.setForm = function(){
	if ($("#rectangle_name").length)	{
		$("#rectangle_name").val(this.name);
		$("#rectangle_name").data("cid",this.id);
	}
	if ($("#rectangle_x0").length) 		{ $("#rectangle_x0").val(this.x0.toString()); }
	if ($("#rectangle_y0").length) 		{ $("#rectangle_y0").val(this.y0.toString()); }
	if ($("#rectangle_x1").length) 		{ $("#rectangle_x1").val(this.x1.toString()); }
	if ($("#rectangle_y1").length) 		{ $("#rectangle_y1").val(this.y1.toString()); }
	if ($("#rectangle_w").length) 		{ $("#rectangle_w").val((this.x1-this.x0).toString()); }
	if ($("#rectangle_h").length) 		{ $("#rectangle_h").val((this.y1-this.y0).toString()); }

	if ($("input:radio[name='rectangle_side']:checked").length)	{ $("input:radio[name='rectangle_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
rectangle.prototype.toolpath = function() {
	//Rotate method to point rotated from a point (use trigo and external general functions) ??????

	this.t=[];

	if (this.side == 3){ //Case toolpath on the rectangle
		var e={};
		e.x0=this.x0; //Center X : never changes
		e.y0=this.y0; //Center Y : never changes
		e.x1=this.x1;	//Start Point X
		e.y1=this.y1;	//Start Point Y

		this.t.push(e);	//Add rectangle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the rectangle
		var e={};

		e.x0=this.x0 - (s.bit_d/2); //Center X : never changes
		e.y0=this.y0 - (s.bit_d/2); //Center Y : never changes
		e.x1=this.x1 + (s.bit_d/2);
		e.y1=this.y1 + (s.bit_d/2);

		this.t.push(e);	//Add rectangle to thel ist of toolpaths
	}
	else if (this.side == 2){ //Case toolpath inside the rectangle : do all the inside

		/*** Init ***/

		//1st : calcul nb bit in height & in width
		//Take the smallest one and do rectangles with the same ratio
		//Start Point : Center -1/2bit, only for the smallest dimension (or randomly)
		//End point : Center +1/2bit, only for smallest dimension (or randomly)
		//Other dimension : Center +/- 1/2 bit * 1/2(ratio) (if randomly)

		var W = this.x1 - this.x0;
		var H = this.y1 - this.y0;
		var cX = (this.x0 + this.x1) / 2;
		var cY = (this.y0 + this.y1) / 2;
		var R = W/H;
		var oldX0 = null;
		var oldX1 = null;
		var oldY0 = null;
		var oldY1 = null;
		
		if (W>H){
			oldY0 = cY - (s.bit_d / 2);
			oldY1 = cY + (s.bit_d / 2);
			oldX0 = cX - ((s.bit_d / 2) * (R > 0 ? R : (1/R) ));
			oldX1 = cX + ((s.bit_d / 2) * (R > 0 ? R : (1/R) ));
		}
		else {
			oldX0 = cX - (s.bit_d / 2);
			oldX1 = cX + (s.bit_d / 2);
			oldY0 = cX - ((s.bit_d / 2) * (R > 0 ? R : (1/R) ));
			oldY1 = cX + ((s.bit_d / 2) * (R > 0 ? R : (1/R) ));
		}

		var end = 0;

		while( end==0 ){ //ABS value
			var e={};

			//Check if current arc is not too big
			if ( Math.abs(oldX0) < Math.abs(this.x0 + s.bit_d/2) )  { oldX0 = this.x0 + s.bit_d/2; end=1;}
			if ( Math.abs(oldY0) < Math.abs(this.y0 + s.bit_d/2) )  { oldY0 = this.y0 + s.bit_d/2; end=1;}
			if ( Math.abs(oldX1) > Math.abs(this.x1 - s.bit_d/2) )  { oldX1 = this.x1 - s.bit_d/2; end=1;}
			if ( Math.abs(oldY1) > Math.abs(this.y1 - s.bit_d/2) )  { oldY1 = this.y1 - s.bit_d/2; end=1;}

			if (	( Math.abs(oldX0) == Math.abs(this.x0 + s.bit_d/2) )
				&& ( Math.abs(oldY0) == Math.abs(this.y0 + s.bit_d/2) )
				&& ( Math.abs(oldX1) == Math.abs(this.x1 - s.bit_d/2) )
				&& ( Math.abs(oldY1) == Math.abs(this.y1 - s.bit_d/2) )
			)  { end=1; }

			//Put the value of the new arc
			e.x0 = oldX0;
			e.y0 = oldY0;
			e.x1 = oldX1;
			e.y1 = oldY1;

			//Increment position for next arc
			oldX0 -= (s.bit_d);
			oldY0 -= (s.bit_d);
			oldX1 += (s.bit_d);
			oldY1 += (s.bit_d);

			this.t.push(e);	//Add arc to the list of toolpaths
		}
	}
};

rectangle.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.x0 + "," + this.y0 + ") - (" + this.x1 + "," + this.y1 + ")</td>";
	str += "<td class='edit'><span>E</span></td>";
	str += "<td class='delete'><span>D</span></td>";
	str += "</tr>";
	return str;
};

rectangle.prototype.removeCanvas = function(){
	if(c && this.canvas){
		c.removeRectangle(this);
	}
};

rectangle.prototype.addCanvas = function(){
	if(c){
		c.addRectangle(this);
	}
};

rectangle.prototype.gCode = function(c){
	this.c= "";
	var code = "";

	var curHeight = 0;
	
	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit

		$.each(this.t , function(i, t){
		//c.rectangle( t.x , t.y , t.x0 , t.y0 , s.z0 , t.x1 , t.y1 , -s.z );

			//Go to beginning of the rectangle
			code += ";***** STARTING A NEW RECTANGLE *****\n";
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the 2nd corner
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y1 + s.y0) + 'F' + s.cut_speed + '\n';

			//Go to the 3rd corner
			code+='G1X' + (this.x1 + s.x0) + 'Y' + (this.y1 + s.y0) + 'F' + s.cut_speed + '\n';

			//Go to the 4th corner
			code+='G1X' + (this.x1 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.cut_speed + '\n';

			//Go back to the 1st corner
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.cut_speed + '\n';
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};





/*
*** Model and function of a single circle ***
*/


//Can also do a part of a circle (if x0,y0 != of x1,y1)
circle = function(l,x,y,diam,side,name) {
	//These variables will be checked later
	var d = null; var r = null;
	if (l) {
		this.pos = l;
		this.id="circle-" + l;
	}

	//Arrays for canvas view, and Toolpath view
	this.canvas = []; //Become an array, even if there is just 1 shape for the canvas, can be more than one for other objects...
	this.tCanvas = [];

	this.current=0;

	//If a name is applicable, we set the custom name
	name ? this.name = name : (this.name = ($("#circle_name").val() 	? 	$("#circle_name").val() : this.id));

	//Check if there is a diameter as parameter, if not, check forms
	if (diam) {d = diam;}
	else if ( $("#circle_diam").length ) { d = parseFloat($("#circle_diam").val()); }
	else if ( $("#circle_radius").length ) { r = parseFloat($("#circle_radius").val()); }

	//Change the diameter to radius if applicable
	if (d) { r=d/2};

	//Set the center
	this.x = x ? x : ($("#circle_x").length 	? 	parseFloat($("#circle_x").val())	: 0); //X center of the circle
	this.y = y ? y : ($("#circle_y").length 	?	parseFloat($("#circle_y").val()) : 0); //Y center of the circle

	//Change coordinates to paper.js / gcode compatible coordinates
	this.x0 = this.x;
	this.y0 = this.y + r;;

	//Check for the toolpath side or assign the default one
	this.side = side ? side : ($("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : 1); //3 = on circle, 1 = exterior, 2 = Hole inside

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

circle.prototype.update = function(x,y,diam,side,name) {
	//First delete view
	this.removeCanvas();
	
	//Check if there is a diameter as parameter, if not, check forms
	if (diam) {d = diam;}
	else if ( $("#circle_diam").length ) { d = parseFloat($("#circle_diam").val()); }
	else if ( $("#circle_radius").length ) { r = parseFloat($("#circle_radius").val()); }

	//Change the diamater to radius if applicable
	if (d) { r=d/2};

	//Set the center
	this.x = x ;
	this.y = y ;

	//Change coordinates to paper.js / gcode compatible coordinates
	this.x0 = this.x;
	this.y0 = this.y + r;

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
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
		$("#circle_radius").length 	? 	parseFloat($("#circle_radius").val()*2)	: ($("#circle_diam").length ? parseFloat($("#circle_radius").val()) : null),
		$("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : null,
		this.name = $("#circle_name").val() 	? 	$("#circle_name").val() : this.id
	);

	//Reset the value of "name" input & unique id "cid"
	$("#circle_name").val("");
	$("#circle_name").data("cid","");
};

circle.prototype.setForm = function(){
	console.log("Function SetForm");
	console.log("Id : " + this.id);

	if ($("#circle_name").length)	{
		$("#circle_name").val(this.name);
		$("#circle_name").data("cid",this.id);
	}
	if ($("#circle_x").length) 		{ $("#circle_x").val(this.x.toString()); }
	if ($("#circle_y").length) 		{ $("#circle_y").val(this.y.toString()); }
	if ($("#circle_radius").length) { $("#circle_radius").val( (this.y0-this.y).toString()); }
	if ($("#circle_diam").length) 	{ $("#circle_diam").val( ((this.y0-this.y)*2).toString()); }
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
		e.y0=this.y0;	//Start Point Y

		this.t.push(e);	//Add circle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the circle
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var e={};

		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0 + (s.bit_d/2) * Math.cos(alpha0);
		e.y0=this.y0 + (s.bit_d/2) * Math.sin(alpha0);

		this.t.push(e);	//Add circle to thel ist of toolpaths
	}
	else if (this.side == 2){ //Case toolpath inside the circle : do all the insidekkkk
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var oldX0 = this.x;
		var oldY0 = this.y;

		var end = 0;

		while( end==0 ){ //ABS value
			var e={};
			e.x=this.x; //Center X : never changes
			e.y=this.y; //Center Y : never changes

			//Check if current arc is not too big
			if ( Math.abs(oldX0) > Math.abs( (this.x0 - (s.bit_d/2) * Math.cos(alpha0)) ) )  { oldX0 = (this.x0 - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( Math.abs(oldY0) > Math.abs( (this.y0 - (s.bit_d/2) * Math.sin(alpha0)) ) )  { oldY0 = (this.y0 - (s.bit_d/2) * Math.sin(alpha0)); end=1;}

			if (	( Math.abs(oldX0) == Math.abs( (this.x0 - (s.bit_d/2) * Math.cos(alpha0)) ) )
				&& ( Math.abs(oldY0) == Math.abs( (this.y0 - (s.bit_d/2) * Math.sin(alpha0)) ) )
			)  { end=1; }

			//Put the value of the new arc
			e.x0 = oldX0;
			e.y0 = oldY0;

			//Increment position for next arc
			oldX0 += (s.bit_d) * Math.cos(alpha0);
			oldY0 += (s.bit_d) * Math.sin(alpha0);

			this.t.push(e);	//Add arc to the list of toolpaths

		}
	}
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
	this.c= "";
	var code = "";

	var curHeight = 0;
	
	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit

		$.each(this.t , function(i, t){
		//c.circle( t.x , t.y , t.x0 , t.y0 , s.z0 , t.x1 , t.y1 , -s.z );

			//Go to beginning of the circle
			code += ";***** STARTING A NEW CIRCLE *****\n";
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the end of the circle (or part of the circle)
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'I' + (this.x0 - this.x + s.x0) + 'J' + (this.y0 - this.y + s.y0) + 'F' + s.cut_speed + '\n';
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};





/*
*** Model and function of a single arc ***
*/


//Can also do a part of a arc (if x0,y0 != of x1,y1)
arc = function(l,x,y,x0,y0,x1,y1,side,name) {

	//Give an id if possible
	if (l) {
		this.id="arc-" + l;
		this.pos = l;
	}
	
	//Initialisations
	this.canvas = []; //Become an array, even if there is just 1 shape for the canvas, can be more than one for other objects...
	this.tCanvas = [];
	this.current=0;

	//Give a name to the arc, if applicable
	name ? this.name = name : (this.name = $("#arc_name").val() 	? 	$("#arc_name").val() : this.id);
	
	this.x = x ? x : ($("#arc_x").length 	? 	parseFloat($("#arc_x").val())	: 0); //X center of the arc
	this.y = y ? y : ($("#arc_y").length 	?	parseFloat($("#arc_y").val()) : 0); //Y center of the arc
	this.x0 = x0 ? x0 : ($("#arc_x0").length 	? 	parseFloat($("#arc_x0").val())	: 0); //X start position of a arc
	this.y0 = y0 ? y0 : ($("#arc_y0").length 	?	parseFloat($("#arc_y0").val()) : 0); //Y start position of a arc
	this.x1 = x1 ? x1 : ($("#arc_x1").length	?	parseFloat($("#arc_x1").val()) : 0); //X end position of a arc
	this.y1 = y1 ? y1 : ($("#arc_y1").length	?	parseFloat($("#arc_y1").val()) : 0); //Y end position of a arc
	this.side = side ? side : ($("input:radio[name='arc_side']:checked").length	?	parseInt($("input:radio[name='arc_side']:checked").val()) : 1); //3 = On line, 1 = Exterior, 2 = Interior, 4 = inside (from center)

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#arc_name").val("");
	$("#arc_name").data("cid","");
};

arc.prototype.update = function(x,y,x0,y0,x1,y1,side,name) {
	//First delete view
	this.removeCanvas();
	this.x=x; //X center of the arc
	this.y=y; //Y center of the arc
	this.x0=x0; //X start position of a arc
	this.y0=y0; //Y start position of a arc
	this.x1=x1; //X end position of a arc
	this.y1=y1; //Y end position of a arc
	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	//Rename the shape if applicable
	if(name) this.name=name;
	//else name = "arc" + pos;

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};

//Should move to Tasks (set a task as current, and not a form)
arc.prototype.setCurrent = function() { this.current=1 };
arc.prototype.resetCurrent = function() { this.current=0 };

arc.prototype.getForm = function(){
	//Add attributes
	this.update(
		$("#arc_x").length 	? 	parseFloat($("#arc_x").val())	: null,
		$("#arc_y").length 	?	parseFloat($("#arc_y").val()) : null,
		$("#arc_x0").length 	? 	parseFloat($("#arc_x0").val())	: null,
		$("#arc_y0").length 	?	parseFloat($("#arc_y0").val()) : null,
		$("#arc_x1").length	?	parseFloat($("#arc_x1").val()) : null,
		$("#arc_y1").length	?	parseFloat($("#arc_y1").val()) : null,
		$("input:radio[name='arc_side']:checked").length	?	parseInt($("input:radio[name='arc_side']:checked").val()) : null,
		this.name = $("#arc_name").val() 	? 	$("#arc_name").val() : this.id
	);

	//Reset the value of "name" input & unique id "cid"
	$("#arc_name").val("");
	$("#arc_name").data("cid","");
};

arc.prototype.setForm = function(){
	if ($("#arc_name").length)	{ $("#arc_name").val(this.name); 		}
	if ($("#arc_name").length)	{ $("#arc_name").data("cid",this.id); 	}
	if ($("#arc_x").length) 	{ $("#arc_x").val(this.x0.toString()); 	}
	if ($("#arc_y").length) 	{ $("#arc_y").val(this.y0.toString()); 	}
	if ($("#arc_x0").length) 	{ $("#arc_x0").val(this.x0.toString()); }
	if ($("#arc_y0").length) 	{ $("#arc_y0").val(this.y0.toString()); }
	if ($("#arc_x1").length) 	{ $("#arc_x1").val(this.x1.toString()); }
	if ($("#arc_y1").length) 	{ $("#arc_y1").val(this.y1.toString()); }
	if ($("input:radio[name='arc_side']:checked").length)	{ $("input:radio[name='arc_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
arc.prototype.toolpath = function() {
	this.t=[];

	if (this.side == 3){ //Case toolpath on the arc
		var e={};
		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0;	//Start Point X
		e.x1=this.x1;	//End Point X
		e.y0=this.y0;	//Start Point Y
		e.y1=this.y1;	//End Point Y

		this.t.push(e);	//Add arc to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the arc
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var alpha1 = calculAlpha(this.x,this.y,this.x1,this.y1);
		var e={};

		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0 + (s.bit_d/2) * Math.cos(alpha0);
		e.x1=this.x1 + (s.bit_d/2) * Math.cos(alpha1);
		e.y0=this.y0 + (s.bit_d/2) * Math.sin(alpha0);
		e.y1=this.y1 + (s.bit_d/2) * Math.sin(alpha1);

		this.t.push(e);	//Add arc to thel ist of toolpaths
	}
	else if (this.side == 1){ //Case toolpath inside the arc, but we not fill the form
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var alpha1 = calculAlpha(this.x,this.y,this.x1,this.y1);
		var e={};

		e.x=this.x; //Center X : never changes
		e.y=this.y; //Center Y : never changes
		e.x0=this.x0 - (s.bit_d/2) * Math.cos(alpha0);
		e.x1=this.x1 - (s.bit_d/2) * Math.cos(alpha1);
		e.y0=this.y0 - (s.bit_d/2) * Math.sin(alpha0);
		e.y1=this.y1 - (s.bit_d/2) * Math.sin(alpha1);

		this.t.push(e);	//Add arc to thel ist of toolpaths
	}
	else if (this.side == 4){ //Case toolpath inside the arc, & we fill the form from the center
		var alpha0 = calculAlpha(this.x,this.y,this.x0,this.y0);
		var alpha1 = calculAlpha(this.x,this.y,this.x1,this.y1);
		var oldX0 = this.x;
		var oldY0 = this.y;
		var oldX1 = this.x;
		var oldY1 = this.y;

		var end = 0;

		while( end==0 ){ //ABS value
			var e={};
			e.x=this.x; //Center X : never changes
			e.y=this.y; //Center Y : never changes

			//Check if current arc is not too big
			if ( Math.abs(oldX0) > Math.abs( (this.x0 - (s.bit_d/2) * Math.cos(alpha0)) ) )  { oldX0 = (this.x0 - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( Math.abs(oldY0) > Math.abs( (this.y0 - (s.bit_d/2) * Math.sin(alpha0)) ) )  { oldY0 = (this.y0 - (s.bit_d/2) * Math.sin(alpha0)); end=1;}
			if ( Math.abs(oldX1) > Math.abs( (this.x1 - (s.bit_d/2) * Math.cos(alpha1)) ) )  { oldX1 = (this.x1 - (s.bit_d/2) * Math.cos(alpha1)); end=1;}
			if ( Math.abs(oldY1) > Math.abs( (this.y1 - (s.bit_d/2) * Math.sin(alpha1)) ) )  { oldY1 = (this.y1 - (s.bit_d/2) * Math.sin(alpha1)); end=1;}
			if ( Math.abs(oldX0) == Math.abs( (this.x0 - (s.bit_d/2) * Math.cos(alpha0)) ) )  { end=1; 
}			if ( Math.abs(oldY0) == Math.abs( (this.y0 - (s.bit_d/2) * Math.sin(alpha0)) ) )  { end=1; }
			if ( Math.abs(oldX1) == Math.abs( (this.x1 - (s.bit_d/2) * Math.cos(alpha1)) ) )  { end=1; }
			if ( Math.abs(oldY1) == Math.abs( (this.y1 - (s.bit_d/2) * Math.sin(alpha1)) ) )  { end=1; }

			//Put the value of the new arc
			e.x0 = oldX0;
			e.x1 = oldX1;
			e.y0 = oldY0;
			e.y1 = oldY1;

			//Increment position for next arc
			oldX0 += (s.bit_d) * Math.cos(alpha0);
			oldY0 += (s.bit_d) * Math.sin(alpha0);
			oldX1 += (s.bit_d) * Math.cos(alpha1);
			oldY1 += (s.bit_d) * Math.sin(alpha1);

			this.t.push(e);	//Add arc to the list of toolpaths
		}
	}
};

arc.prototype.addTaskList = function() {
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
arc.prototype.viewToolPath = function() {
	//Read the x0... y1 of the arc and trace a red / Blue arc
	//Read the toolPath of the arc and trace a grey shadow
	return true;
};

arc.prototype.removeCanvas = function(){
	if(c && this.canvas){
		c.removearc(this);
	}
};

arc.prototype.addCanvas = function(){
	if(c){
		c.addarc(this);
	}
};

arc.prototype.gCode = function(c){
	this.c="";
	code = "";
	var curHeight = 0;
	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit
		
		$.each(this.t , function(i, t){
		//c.arc( t.x , t.y , t.x0 , t.y0 , s.z0 , t.x1 , t.y1 , -s.z );
			//Go to beginning of the arc
			code += ";***** STARTING A NEW ARC *****\n";
			code+='G1X' + (this.x0 + s.x0) + 'Y' + (this.y0 + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the end of the arc (or part of the arc)
			code+='G2X' + (this.x1 + s.x0) + 'Y' + (this.y1 + s.y0) + 'I' + (this.x1 - this.x + s.x0) + 'J' + (this.y1 - this.y + s.y0) + 'F' + s.cut_speed + '\n';
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};