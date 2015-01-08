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
var canvasColor = 'rgba(77, 135, 29, 0.8)';
var toolpathColor = 'rgba(156, 33, 12, 0.25)';
var appName = "Rectangles";

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
	var dashSettings = getAppSetting(appName,"s") ? getAppSetting(appName,"s") : false;

	this.x = dashSettings ? dashSettings.x : 6; //x Size of project
	this.y = dashSettings ? dashSettings.y : 8; //y Size of project
	this.z = dashSettings ? dashSettings.z : 0.3; //Max thickness of project
	this.dz = dashSettings ? dashSettings.dz : 0.1; //Depth of each z pass
	this.x0 = dashSettings ? dashSettings.x0 : 0; //x Translation from X0
	this.y0 = dashSettings ? dashSettings.y0 :0; //t Translation from Y0
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
	setAppSetting(appName,"s",s); //Save s object in localStorage

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
	delAppSetting(appName,"s");
	
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
	paper.setup('myCanvas');
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
	view.viewSize = new Size(ratio,(ratio/s.x)*s.y);

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
		project.clear(); //Not effective ?

		//Choose X & Y graduation depending to project size
		var sStep = 1;	var mStep = 5;	var lStep = 10;
		var stepx = s.x < 100 ? (s.x < 10 ? sStep : mStep) : lStep;
		var stepy = s.y < 100 ? (s.y < 10 ? sStep : mStep) : lStep;

		//Enter Dimensions to grid container
		$("#xScale").html('X : ' + s.x + '" ' + '(' + stepx + '"/grad)');
		$("#yScale").html('y : ' + s.y + '" ' + '(' + stepy + '"/grad)');

	    //X graduation from left
	    for (var i = stepx ; i < s.x ; i+=stepx) {
	        var topPoint = new Point( this.xPos(i) , this.yPos(s.y) );
	        var bottomPoint = new Point(this.xPos(i), this.yPos(0));
	        var aLine = new Path.Line(topPoint, bottomPoint);
	        aLine.strokeColor = '#ddd';
	        aLine.strokeWidth = 3; //((i%10)==0) ? 6 : (((i%10)==0) ? 4 : 2);
	    	this.grid.push(aLine);
	    }

	    //Y graduation from bottom
	    for (var i = stepy ; i < s.y ; i+=stepy) {
	        var leftPoint = new Point( this.xPos(0) , this.yPos(i) );
	        var rightPoint = new Point( this.xPos(s.x) , this.yPos(i) );
	        var aLine = new Path.Line(leftPoint, rightPoint);
	        aLine.strokeColor = '#ddd';
	        aLine.strokeWidth = 3; //((i%10)==0) ? 5 : (((i%10)==0) ? 4 : 3);
	        this.grid.push(aLine);
	    }

	    view.draw(); //Setup //Activate

	    //Resolve screen dimensions problem
	    $("#project_content").removeClass("active");
	}
};

//Return xPos converted to to canvas size 	-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.xPos = function(x){
	return ( view.bounds.left + x * (view.bounds.width / s.x) );
};

//Return yPos converted to to canvas size 	-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.yPos = function(y){
	return ( view.bounds.bottom - y * (view.bounds.height / s.y) );
};

//Retur, thickness (strokeWidth) 			-> Will work in responsive & fixed position if the canvas is resized
Canvas.prototype.w = function(w){
	return ( w * (view.bounds.height / s.y) );
}



// --- Canvas UI actions --- //
Canvas.prototype.selectAction = function(t,e){
	console.log("Nouvelle Selection de Ligne : " + t)
}


// --- Line : Add / Edit / Remove --- //
Canvas.prototype.addLine = function(l){
	//Add line view
	l.canvas = new Path.Line( this.addPoint(l.p0.x,l.p0.y) , this.addPoint(l.p1.x,l.p1.y) );
    l.canvas.strokeColor = canvasColor;
    l.canvas.strokeWidth = 3;
    l.canvas.taskId = l.id;

    //Add toolPath View
    l.tCanvas = new Path.Line(
		new Point( this.xPos(l.t0.x) , this.yPos(l.t0.y) ),
		new Point( this.xPos(l.t1.x) , this.yPos(l.t1.y) )
	);
    l.tCanvas.strokeColor = toolpathColor//'rgba(215, 44, 44, 0.6)';
    l.tCanvas.strokeWidth = this.w(s.bit_d);
    l.tCanvas.strokeCap = 'round';
	l.tCanvas.dashArray = [l.tCanvas.strokeWidth*2, l.tCanvas.strokeWidth*3];
	l.tCanvas.taskId = l.id;

	view.draw(); //Setup //Activate
};

Canvas.prototype.removeLine = function(l){
	l.canvas.remove();
	l.tCanvas.remove();
	view.draw(); //Setup //Activate
};


// --- Point : Add / Edit / Remove --- //
Canvas.prototype.addPoint = function(x,y,size){
	return new Point( this.xPos(x) , this.yPos(y) ) ;
};


// --- Rectangle : Add / Edit / Remove --- //
Canvas.prototype.addRectangle = function(r){
	//Add line view
	r.canvas = [];

	var p = new Path.Rectangle(
		new Point( this.xPos(r.p0.x) , this.yPos(r.p0.y) ),
		new Point( this.xPos(r.p1.x) , this.yPos(r.p1.y) )
	);
    p.strokeColor = canvasColor;
    p.strokeWidth = 3;

    r.canvas.push(p);

    //Add toolPath View
    r.tCanvas = [];
    
    var i = 0;

    for(i=0 ; i < r.t.length ; i++){
    	var p2 = new Path.Rectangle( 
    		new Point( this.xPos(r.t[i].p0.x) , this.yPos(r.t[i].p0.y) ) ,
    		new Point( this.xPos(r.t[i].p1.x) , this.yPos(r.t[i].p1.y) )
    	);
	    p2.strokeColor = toolpathColor//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

		r.tCanvas.push(p2);
    }

	view.draw(); //Setup //Activate
};

Canvas.prototype.removeRectangle = function(r){ //Make it generic with line removeFromCanvas / removeView
	$.each( r.canvas , function(i,shape){
		shape.remove();
	});
	$.each( r.tCanvas , function(i,shape){
		shape.remove();
	});

	view.draw(); //Setup //Activate
};


// --- Circle : Add / Edit / Remove --- //
Canvas.prototype.addCircle = function(c){
	//Add line view
	c.canvas = [];

	var p = new Path.Circle(
		new Point( this.xPos(c.p.x) , this.yPos(c.p.y) ),
		( this.yPos(c.p.y - c.p0.y) - view.bounds.height )
	);
    p.strokeColor = canvasColor;
    p.strokeWidth = 3;

    c.canvas.push(p);
    c.canvas.onclick = function(event){
    	console.log("truc");
    }

    //Add toolPath View
    c.tCanvas = [];
    
    var i = 0;

    for(i=0 ; i < c.t.length ; i++){
    	var p2 = new Path.Circle( 
    		new Point( this.xPos(c.t[i].p.x) , this.yPos(c.t[i].p.y) ) ,
    		( this.yPos(c.t[i].p.y - c.t[i].p0.y) - view.bounds.height ) 
    	);
	    p2.strokeColor = toolpathColor//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

		c.tCanvas.push(p2);
    }

	view.draw(); //Setup //Activate
};

Canvas.prototype.removeCircle = function(c){ //Make it generic with line removeFromCanvas / removeView
	$.each( c.canvas , function(i,shape){
		shape.remove();
	});
	$.each( c.tCanvas , function(i,shape){
		shape.remove();
	});

	view.draw(); //Setup //Activate
};


// --- Arc : Add / Edit / Remove --- //
Canvas.prototype.addArc = function(a){
	//Add line view
	a.canvas = [];
	var p = new Path.Arc(
		new Point( this.xPos(a.p0.x) , this.yPos(a.p0.y) ) ,
    	new Point( this.xPos(a.p1.x) , this.yPos(a.p1.y) ) ,
    	new Point( this.xPos(a.p2.x) , this.yPos(a.p2.y) )
	);
    p.strokeColor = canvasColor;
    p.strokeWidth = 3;

    a.canvas.push(p);

    //Add toolPath View
    a.tCanvas = [];
    
    var i = 0;

    for(i=0 ; i< a.t.length ; i++){
    	var p2 = new Path.Arc(
    		new Point( this.xPos(a.t[i].p0.x) , this.yPos(a.t[i].p0.y) ) ,
    		new Point( this.xPos(a.t[i].p1.x) , this.yPos(a.t[i].p1.y) ) ,
    		new Point( this.xPos(a.t[i].p2.x) , this.yPos(a.t[i].p2.y) )
    	);
    	p2.strokeColor = toolpathColor//'rgba(215, 44, 44, 0.6)';
	    p2.strokeWidth = this.w(s.bit_d)*0.5;
	    p2.strokeCap = 'round';
		p2.dashArray = [p2.strokeWidth*2, p2.strokeWidth*1];

		a.tCanvas.push(p2);
    }

	view.draw(); //Setup //Activate
};

Canvas.prototype.removeArc = function(a){ //Make it generic with line removeFromCanvas / removeView
	$.each( a.canvas , function(i,shape){
		shape.remove();
	});
	$.each( a.tCanvas , function(i,shape){
		shape.remove();
	});

	view.draw(); //Setup //Activate
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

//Tasks = array
//1 Element of this array = 1 task
//1 task can be a library shape (circle,line,arc,rectangle), or a custom shape (not implemented yet in the library)
//So each task from the "Tasks" array won't necessary be the 


/********** Function for "Tasks" object = all the tasks **********/
Tasks.reset = function(){
	$.each(this, function(index,t){
		t.removeCanvas();
	});

	//Set the number of Tasks to 0
	this.length = 0;

	//Save Tasks Model
	setAppSetting(appName,"Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addLine = function(){
	//Create a new line (task)
	var t = new line(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting(appName,"Tasks",this);

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
	setAppSetting(appName,"Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addCircle = function(){
	//Create a new line (task)
	var t = new circle(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting(appName,"Tasks",this);

	//View Tasks
	this.view();
};

Tasks.addArc = function(){
	//Create a new line (task)
	var t = new arc(this.length.toString());

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting(appName,"Tasks",this);

	//View Tasks
	this.view();
};

Tasks.remove = function(id){
	//remove the task from Canvas (if canvas)
	Tasks[Tasks.pos(id)].removeCanvas();

	//Search the position of the line to remove. Then remove
	this.splice(Tasks.pos(id), 1);

	//Save Tasks Model
	setAppSetting(appName,"Tasks",this);

	//View Tasks
	this.view();
};

Tasks.edit = function(id){
	//Search the position of the line to edit & get this line
	console.log("id a modifier : " + id);

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
		setAppSetting(appName,"Tasks",this);

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

calculAlpha = function(p,p0){
	var alpha = 0;

	if ( (p0.y!=p.y) && (p0.x!=p.x) ) {
		alpha = Math.atan((p0.y-p.y)/(p0.x-p.x));
	}
	else {
		if(p0.y == p.y) {
			if((p0.x-p.x)>0) 	{ alpha=0; }
			else 				{ alpha=pi; }
		}
		else if(p0.x == p.x) {
			if((p0.y-p.y)>0) 	{ alpha=pi/2; }
			else 				{ alpha=3*pi/2; }
		}
	}

	return alpha;
};

//Calcul the position of a point of a circle from the center, start point of the circle and the angle (clockwise)
//Could be use to rotate entire shaped & toolpath, from a base.
//x & y = center of the rotation
//x1 & y1 = point to transform
//angle = angle of transformation (clockwise) in degres
rot = function(p,p1,angle){
	var r = Math.round(Math.sqrt((p1.x-p.x)*(p1.x-p.x) + (p1.y-p.y)*(p1.y-p.y))*10000)/10000;
	var alpha = (-angle/180)*pi;

	return new p(
		(p1.x * Math.cos(alpha)) - (p1.y * Math.sin(alpha)),
		(p1.x * Math.sin(alpha)) + (p1.y * Math.cos(alpha))
	);
};

pos = function(C,L,T,R,B){
	this.center = C ? C : new p(null,null);
	this.left 	= L ? L : new p(null,null);
	this.top 	= T ? T : new p(null,null);
	this.right 	= R ? R : new p(null,null);
	this.bottom = B ? B : new p(null,null);
};


/*
*** Method & classes for use in elements
*/
p = function(x,y){
	this.x=x;
	this.y=y;
};

//Return distance of p from point "from", under as a svector (x & y distance)
p.prototype.distanceFrom = function(from){
	return new p(
		(this.x-from.x),
		(this.y-from.y)
	);
};

//Return distance of p from point "from", as a value
p.prototype.absoluteDistance = function(from){
	return Math.round(
		Math.sqrt(
			(this.distanceFrom(from).x*this.distanceFrom(from).x) + (this.distanceFrom(from).y*this.distanceFrom(from).y)
		)*10000
	)/10000;
}

p.prototype.sameAxisThan = function(p){
	if ((this.x == p.x) || (this.y == p.y))
		{ return true; }
	else 
		{ return false; }
}

p.prototype.middle = function(p1){
	return new p(
		(this.x + p1.x /2),
		(this.y + p1.y /2)
	);
}

p.prototype.translate = function(vector){ //vector is of p type
	this.x += vector.x;
	this.y += vector.y;
};

p.prototype.rotate = function(center,angle){
	var alpha = (-angle/(180))*pi;
	var xNew = ((this.x-center.x) * Math.cos(alpha)) - ((this.y-center.y) * Math.sin(alpha)) + center.x;
	var yNew = (((this.x-center.x) * Math.sin(alpha))) + ((this.y-center.y) * Math.cos(alpha)) + center.y;

	this.x = xNew;
	this.y = yNew;
};

p.prototype.mirror = function(center,axis){
	//Center is center point to mirror
	if(axis == 'x'){
		this.rotate(new p(this.x,center.y),180);
	}
	else if (axis == 'y'){
		this.rotate(new p(center.x,this.y),180);
	}
};


/*
*** Model and function of a single Line ***
*/

line = function(l,x0,y0,x1,y1,name,side) {
	//Basic informations
	this.id="line-" + l;
	this.pos = l;
	this.canvas = null;
	this.tCanvas = null;
	name ? this.name = name : (this.name = $("#line_name").val() 	? 	$("#line_name").val() : this.id);
	this.current=0;

	//Start Point
	this.p0 = new p(
		x0 ? x0 : ($("#line_x0").length 	? 	parseFloat($("#line_x0").val())	: 0),
		y0 ? y0 : ($("#line_y0").length 	?	parseFloat($("#line_y0").val()) : 0)
	);
	
	//End Point
	this.p1 = new p(
		x1 ? x1 : ($("#line_x1").length	?	parseFloat($("#line_x1").val()) : 0),
		y1 ? y1 : ($("#line_y1").length	?	parseFloat($("#line_y1").val()) : 0)
	);

	//Side of bit (for toolpath...)
	this.side = side ? side : ($("input:radio[name='line_side']:checked").length	?	parseInt($("input:radio[name='line_side']:checked").val()) : 1); //3 = center, 1 = Left, 2 = Right

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#line_name").val("");
	$("#line_name").data("cid","");
};

line.prototype.update = function(x0,y0,x1,y1,name,side) {
	this.p0 = new p(x0,y0); //Update Start Point
	this.p1 = new p(x1,y1);	//Update End Point

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "Line" + pos;

};

line.prototype.rotate = function(center,angle){ //Rotate a line around a center, and an angle
	this.p0.rotate(center,angle);
	this.p1.rotate(center,angle);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

line.prototype.mirror = function(center,axis){ //Mirror a line relatively  to a point and an axis (for example center point and axis 'x')
	this.p0.mirror(center,axis);
	this.p1.mirror(center,axis);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

line.prototype.translate = function(vector){ //Translate a line of a vector (p structure (x/y))
	this.p0 = translate(vector);
	this.p1 = translate(vector);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

line.prototype.setPos = function(){ //Set the center of the shape, its Left / Top / Right / Bottom limits
	this.position = new pos(
		this.p0.middle(this.p1), //Center
		Math.min( this.p0.x , this.p1.x ), //Left
		Math.min( this.p0.y , this.p1.y ), //Top
		Math.min( this.p0.x , this.p1.x ), //Right
		Math.min( this.p0.x , this.p1.x ) //Bottom
	);
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
	if ($("#line_x0").length) 	{ $("#line_x0").val(this.p0.x.toString()); }
	if ($("#line_y0").length) 	{ $("#line_y0").val(this.p0.y.toString()); }
	if ($("#line_x1").length) 	{ $("#line_x1").val(this.p1.x.toString()); }
	if ($("#line_y1").length) 	{ $("#line_y1").val(this.p1.y.toString()); }
	if ($("input:radio[name='line_side']:checked").length)	{ $("input:radio[name='line_side'][value='"+ this.side +"']").attr("checked",true); }
};

line.prototype.toolpath = function() {
	var alpha=0;

	this.t0 = new p(this.p0.x, this.p0.y);
	this.t1 = new p(this.p1.x, this.p1.y);

	if(this.side != 3) {
		alpha = calculAlpha(this.p0,this.p1);

		if(this.side == 1) { alpha = pi/2 + alpha; } //Left
		else { alpha = 3*pi/2 + alpha; } //Right

		this.t0.x += (s.bit_d/2) * Math.cos(alpha);
		this.t1.x += (s.bit_d/2) * Math.cos(alpha);
		this.t0.y += (s.bit_d/2) * Math.sin(alpha);
		this.t1.y += (s.bit_d/2) * Math.sin(alpha);
	}
};

line.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.p0.x.toString() + "," + this.p0.y.toString() + ") - (" + this.p1.x.toString() + "," + this.p1.y.toString() + ")</td>";
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
		code+='G1X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'F' + s.air_speed + '\n';

		//Go to the new depth
		code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

		//Go to the end of the line
		code+='G1X' + (this.p1.x + s.x0) + 'Y' + (this.p1.y + s.y0) + 'F' + s.cut_speed + '\n';

		//Go to z over the project
		code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n'; //Maybe will be removed (see when security is needed)
	}
	this.c = code;
	return this.c;
};

line.prototype.synch = function(){
	//First delete view
	this.removeCanvas();

	//Get Center, Top / Right / Bottom / Left pos
	this.setPos();

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};



/*
*** Model and function of a single rectangle ***
*/


//Can also do a part of a rectangle (if x0,y0 != of x1,y1)
rectangle = function(l,x0,y0,x1,y1,side,name) {
	//These variables will be checked later
	this.p0 = new p(x0,y0);
	this.p1 = new p(x1,y1);
	this.p2 = new p(x0,y1);
	this.p3 = new p(x1,y0);

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
	this.p0 = new p(
		x0 ? x0 : ($("#rectangle_x0").length 	? 	parseFloat($("#rectangle_x0").val())	: 0),
		y0 ? y0 : ($("#rectangle_y0").length 	?	parseFloat($("#rectangle_y0").val()) 	: 0)
	);

	//Set the end point
	if(!x1 || !y1){
		if( ($("#rectangle_x1").length) && $("#rectangle_x1").hasClass("active") ){
			x1 = parseFloat($("#rectangle_x1").val());
		}
		else if( ($("#rectangle_w").length) && $("#rectangle_w").hasClass("active") ){
			x1 = this.p0.x + parseFloat($("#rectangle_w").val());
		}

		
		if( ($("#rectangle_y1").length) && $("#rectangle_y1").hasClass("active") ){
			y1 = parseFloat($("#rectangle_y1").val());
		}
		else if( ($("#rectangle_h").length) && $("#rectangle_h").hasClass("active") ){
			y1 = this.p0.y + parseFloat($("#rectangle_h").val());
		}
	}

	this.p1 = new p(x1,y1);

	this.p2 = new p(this.p0.x,this.p1.y);
	this.p3 = new p(this.p1.x,this.p0.y);

	//Check for the toolpath side or assign the default one
	this.side = side ? side : ($("input:radio[name='rectangle_side']:checked").length	?	parseInt($("input:radio[name='rectangle_side']:checked").val()) : 1); //3 = on rectangle, 1 = exterior, 2 = Hole inside

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#rectangle_name").val("");
	$("#rectangle_name").data("cid","");
};

rectangle.prototype.update = function(x0,y0,x1,y1,side,name) {
	//Set the center
	this.p0 = new p(x0,y0);
	this.p1 = new p(x1,y1);
	this.p2 = new p(x0,y1);
	this.p3 = new p(x1,y0);

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "rectangle" + pos;

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

rectangle.prototype.rotate = function(center,angle){ //Rotate a rectangle around a center point, and an angle
	this.p0.rotate(center,angle);
	this.p1.rotate(center,angle);
	this.p2.rotate(center,angle);
	this.p3.rotate(center,angle);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

rectangle.prototype.mirror = function(center,axis){ //Mirror a rectangle relatively  to a point and an axis (for example center point and axis 'x')
	this.p0.mirror(center,axis);
	this.p1.mirror(center,axis);
	this.p2.mirror(center,axis);
	this.p3.mirror(center,axis);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

rectangle.prototype.translate = function(vector){ //Translate a rectangle of a vector (p structure (x/y))
	this.p0 = translate(vector);
	this.p1 = translate(vector);
	this.p2 = translate(vector);
	this.p3 = translate(vector);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

rectangle.prototype.setPos = function(){ //Set the center of the shape, its Left / Top / Right / Bottom limits
	this.position = new pos(
		this.p0.middle(this.p1), //Center
		Math.min(this.p0.x,this.p1.x,this.p2.x,this.p3.x), //Left
		Math.max(this.p0.y,this.p1.y,this.p2.y,this.p3.y), //Top
		Math.max(this.p0.x,this.p1.x,this.p2.x,this.p3.x), //Right
		Math.min(this.p0.y,this.p1.y,this.p2.y,this.p3.y) //Bottom
	);
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
	if ($("#rectangle_x0").length) 		{ $("#rectangle_x0").val(this.p0.x.toString()); }
	if ($("#rectangle_y0").length) 		{ $("#rectangle_y0").val(this.p0.y.toString()); }
	if ($("#rectangle_x1").length) 		{ $("#rectangle_x1").val(this.p1.x.toString()); }
	if ($("#rectangle_y1").length) 		{ $("#rectangle_y1").val(this.p1.y.toString()); }
	if ($("#rectangle_w").length) 		{ $("#rectangle_w").val((this.p1.x-this.p0.x).toString()); }
	if ($("#rectangle_h").length) 		{ $("#rectangle_h").val((this.p1.y-this.p0.y).toString()); }

	if ($("input:radio[name='rectangle_side']:checked").length)	{ $("input:radio[name='rectangle_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
rectangle.prototype.toolpath = function() {
	//Rotate method to point rotated from a point (use trigo and external general functions) ??????

	this.t=[];

	if (this.side == 3){ //Case toolpath on the rectangle
		var e={};
		e.p0=this.p0;
		e.p1=this.p1;
		e.p2=this.p2;
		e.p3=this.p3;

		this.t.push(e);	//Add rectangle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the rectangle
		var e={};
		var alpha0 = calculAlpha(this.p0,this.p2) + pi/2;
		var alpha1 = calculAlpha(this.p2,this.p1) + pi/2;
		var alpha2 = calculAlpha(this.p1,this.p3) + pi/2;
		var alpha3 = calculAlpha(this.p3,this.p0) + pi/2;

		e.p0 = new p(this.p0.x + (s.bit_d/2) * Math.cos(alpha0) , this.p0.y + (s.bit_d/2) * Math.sin(alpha0));
		e.p1 = new p(this.p1.x + (s.bit_d/2) * Math.cos(alpha1) , this.p1.y + (s.bit_d/2) * Math.sin(alpha1));
		e.p2 = new p(this.p2.x + (s.bit_d/2) * Math.cos(alpha2) , this.p2.y + (s.bit_d/2) * Math.sin(alpha2));
		e.p3 = new p(this.p3.x + (s.bit_d/2) * Math.cos(alpha3) , this.p3.y + (s.bit_d/2) * Math.sin(alpha3));

		this.t.push(e);	//Add rectangle to thel ist of toolpaths
	}
	else if (this.side == 2){ //Case toolpath inside the rectangle : do all the inside
		/*** Init ***/
		//Fonction to correct
		var W = this.p1.x - this.p0.x;
		var H = this.p1.y - this.p0.y;
		var cX = (this.p0.x + this.p1.x) / 2;
		var cY = (this.p0.y + this.p1.y) / 2;
		var R = W/H;
		var oldP0 = null;
		var oldP1 = null;
		var oldP2 = null;
		var oldP3 = null;
		var alpha0 = calculAlpha(this.p0,this.p2) + pi/2;
		var alpha1 = calculAlpha(this.p2,this.p1) + pi/2;
		var alpha2 = calculAlpha(this.p1,this.p3) + pi/2;
		var alpha3 = calculAlpha(this.p3,this.p0) + pi/2;
		
		if (W>H){
			oldP0 = new p(
				cX - ((s.bit_d / 2) * (R > 0 ? R : (1/R) )),
				cY - (s.bit_d / 2)
			);
			oldP1 = new p(
				cX + ((s.bit_d / 2) * (R > 0 ? R : (1/R) )),
				cY + (s.bit_d / 2)
			);
		}
		else {
			oldP0 = new p(
				cX - (s.bit_d / 2),
				cX - ((s.bit_d / 2) * (R > 0 ? R : (1/R) ))
			);
			oldP1 = newp(
				cX + (s.bit_d / 2),
				cX + ((s.bit_d / 2) * (R > 0 ? R : (1/R) ))
			);
		}

		var end = 0;

		while( end==0 ){ //ABS value
			var e={};

			//Check if current Rec is not too big
			if ( Math.abs(oldP0.x) < Math.abs(this.p0.x + s.bit_d/2) )  { oldP0.x = this.p0.x + s.bit_d/2; end=1;}
			if ( Math.abs(oldP0.y) < Math.abs(this.p0.y + s.bit_d/2) )  { oldP0.y = this.p0.y + s.bit_d/2; end=1;}
			if ( Math.abs(oldP1.x) > Math.abs(this.p1.x - s.bit_d/2) )  { oldP1.x = this.p1.x - s.bit_d/2; end=1;}
			if ( Math.abs(oldP1.y) > Math.abs(this.p1.y - s.bit_d/2) )  { oldP1.y = this.p1.y - s.bit_d/2; end=1;}

			if (	( Math.abs(oldP0.x) == Math.abs(this.p0.x + s.bit_d/2) )
				&& ( Math.abs(oldP0.y) == Math.abs(this.p0.y + s.bit_d/2) )
				&& ( Math.abs(oldP1.x) == Math.abs(this.p1.x - s.bit_d/2) )
				&& ( Math.abs(oldP1.y) == Math.abs(this.p1.y - s.bit_d/2) )
			)  { end=1; }

			//Put the value of the new arc
			e.p0 = oldP0;
			e.p1 = oldP1;

			//Increment position for next arc
			oldP0 = new p( oldP0.x - (s.bit_d) , oldP0.y - (s.bit_d) );
			oldP1 = new p( oldP1.x + (s.bit_d) , oldP1.y + (s.bit_d) );

			this.t.push(e);	//Add arc to the list of toolpaths
		}
	}
};

rectangle.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.p0.x + "," + this.p0.y + ") - (" + this.p1.x + "," + this.p1.y + ")</td>";
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
			code+='G1X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the 2nd corner
			code+='G1X' + (this.p2.x + s.x0) + 'Y' + (this.p2.y + s.y0) + 'F' + s.cut_speed + '\n';

			//Go to the 3rd corner
			code+='G1X' + (this.p1.x + s.x0) + 'Y' + (this.p1.y + s.y0) + 'F' + s.cut_speed + '\n';

			//Go to the 4th corner
			code+='G1X' + (this.p3.x + s.x0) + 'Y' + (this.p3.y + s.y0) + 'F' + s.cut_speed + '\n';

			//Go back to the 1st corner
			code+='G1X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'F' + s.cut_speed + '\n';
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};

rectangle.prototype.synch = function(){
	//First delete view
	this.removeCanvas();

	//Get Center, Top / Right / Bottom / Left pos
	this.setPos();

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
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

	if (diam) {d = diam;}
	else if ( $("#circle_diam").length && $("#circle_diam").hasClass("active")) { d = parseFloat($("#circle_diam").val()); }
	else if ( $("#circle_radius").length && $("#circle_radius").hasClass("active")) { r = parseFloat($("#circle_radius").val()); }

	//Change the diameter to radius if applicable, and save it
	if (d) { r=d/2};
	this.r = r;

	//Set the center
	this.p = new p(
		 x ? x : ($("#circle_x").length 	? 	parseFloat($("#circle_x").val())	: 0),
		 y ? y : ($("#circle_y").length 	?	parseFloat($("#circle_y").val()) : 0)
	);

	//Change coordinates to paper.js / gcode compatible coordinates
	this.p0 = new p( this.p.x , this.p.y + r );

	//Check for the toolpath side or assign the default one
	this.side = side ? side : ($("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : 1); //3 = on circle, 1 = exterior, 2 = Hole inside

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#circle_name").val("");
	$("#circle_name").data("cid","");
};

circle.prototype.update = function(x,y,diam,side,name) {
	this.r = diam/2;

	//Set the center

	//Change coordinates to paper.js / gcode compatible coordinates
	this.p = new p(x,y);
	this.p0 = new p( this.p.x , this.p.y + r );

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "circle" + pos;

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

circle.prototype.rotate = function(center,angle){ //Rotate a circle around a center point, and an angle
	this.p.rotate(center,angle);
	this.p0.rotate(center,angle);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

circle.prototype.mirror = function(center,axis){ //Mirror a circle relatively to a point and an axis (for example center point and axis 'x')
	this.p.mirror(center,axis);
	this.p0.mirror(center,axis);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

circle.prototype.translate = function(vector){ //Translate a circle of a vector (p structure (x/y))
	this.p = translate(vector);
	this.p0 = translate(vector);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

circle.prototype.setPos = function(){ //Set the center of the shape, its Left / Top / Right / Bottom limits
	this.position = new pos(
		this.p, //Center
		this.p.x - this.r, //Left
		this.p.y + this.r, //Top
		this.p.x + this.r, //Right
		this.p.y - this.r //Bottom
	);
};

//Should move to Tasks (set a task as current, and not a form)
circle.prototype.setCurrent = function() { this.current=1 };
circle.prototype.resetCurrent = function() { this.current=0 };

circle.prototype.getForm = function(){
	//Add attributes
	this.update(
		$("#circle_x").length 	? 	parseFloat($("#circle_x").val())	: null,
		$("#circle_y").length 	?	parseFloat($("#circle_y").val()) : null,
		($("#circle_radius").length && $("#circle_radius").hasClass("active"))	?
			parseFloat($("#circle_radius").val()*2)	:
			(($("#circle_diam").length && $("#circle_diam").hasClass("active") ) ?
				parseFloat($("#circle_radius").val()) : null
			),
		$("input:radio[name='circle_side']:checked").length	?	parseInt($("input:radio[name='circle_side']:checked").val()) : null,
		this.name = $("#circle_name").val() 	? 	$("#circle_name").val() : this.id
	);

	//Reset the value of "name" input & unique id "cid"
	$("#circle_name").val("");
	$("#circle_name").data("cid","");
};

circle.prototype.setForm = function(){
	if ($("#circle_name").length)	{
		$("#circle_name").val(this.name);
		$("#circle_name").data("cid",this.id);
	}
	if ($("#circle_x").length) 		{ $("#circle_x").val(this.p.x.toString()); }
	if ($("#circle_y").length) 		{ $("#circle_y").val(this.p.y.toString()); }
	if ($("#circle_radius").length) { $("#circle_radius").val( this.r.toString()); }
	if ($("#circle_diam").length) 	{ $("#circle_diam").val( (this.r*2).toString()); }
	if ($("input:radio[name='circle_side']:checked").length)	{ $("input:radio[name='circle_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
circle.prototype.toolpath = function() {
	this.t=[];

	if (this.side == 3){ //Case toolpath on the circle
		var e={};
		e.p = new p(this.p.x,this.p.y);
		e.p0 = new p(this.p0.x,this.p0.y);
		this.t.push(e);	//Add circle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the circle
		var alpha0 = calculAlpha(this.p,this.p0);
		var e={};
		e.p = new p(this.p.x,this.p.y);
		e.p0 = new p(this.p0.x + (s.bit_d/2) * Math.cos(alpha0) , this.p0.y + (s.bit_d/2) * Math.sin(alpha0));
		this.t.push(e);	//Add circle to the list of toolpaths
	}
	else if (this.side == 2){ //Case toolpath inside the circle : do all the insidekkkk
		var alpha0 = calculAlpha(this.p,this.p0);
		var oldP0 = new p(this.p.x,this.p.y);
		var end = 0;

		while( end==0 ){ //ABS value
			var e={};
			e.p = new p(this.p.x,this.p.y);

			//Check if current arc is not too big
			if ( Math.abs(oldP0.x) > Math.abs( (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)) ) )  { oldP0.x = (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( Math.abs(oldP0.y) > Math.abs( (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)) ) )  { oldP0.y = (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)); end=1;}

			if (	( Math.abs(oldP0.x) == Math.abs( (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)) ) )
				&& ( Math.abs(oldP0.y) == Math.abs( (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)) ) )
			)  { end=1; }

			//Put the value of the new arc
			e.p0 = new p(oldP0.x , oldP0.y);

			//Increment position for next arc
			oldP0.x += (s.bit_d) * Math.cos(alpha0);
			oldP0.y += (s.bit_d) * Math.sin(alpha0);

			this.t.push(e);	//Add arc to the list of toolpaths

		}
	}
};

circle.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.p.x.toString() + "," + this.p.y.toString() + ") R=" + (this.p0.y - this.p.y).toString() + "</td>";
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
			code+='G1X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'F' + s.air_speed + '\n';

			//Go to the new depth
			code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';

			//Go to the end of the circle (or part of the circle)
			code+='G2X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'I' + (this.p0.x - this.p.x + s.x0) + 'J' + (this.p0.y - this.p.y + s.y0) + 'F' + s.cut_speed + '\n';
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};

circle.prototype.synch = function(){
	//First delete view
	this.removeCanvas();

	//Get Center, Top / Right / Bottom / Left pos
	this.setPos();

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};



/*
*** Model and function of a single arc ***
*/


//Can also do a part of a arc (if x0,y0 != of x1,y1)
arc = function(l,x,y,x0,y0,angle,side,name) {

	//Give an id if possible
	if (l) {
		this.id="ar-c" + l;
		this.pos = l;
	}
	
	//Initialisations
	this.canvas = []; //Become an array, even if there is just 1 shape for the canvas, can be more than one for other objects...
	this.tCanvas = [];
	this.current=0;

	//Give a name to the arc, if applicable
	name ? this.name = name : (this.name = $("#arc_name").val() 	? 	$("#arc_name").val() : this.id);
	
	this.p = new p(
		 x ? x : ($("#arc_x").length 	? 	parseFloat($("#arc_x").val())	: 0),
		 y ? y : ($("#arc_y").length 	?	parseFloat($("#arc_y").val()) : 0)
	);
	this.p0 = new p(
		x0 ? x0 : ($("#arc_x0").length 	? 	parseFloat($("#arc_x0").val())	: 0),
		y0 ? y0 : ($("#arc_y0").length 	?	parseFloat($("#arc_y0").val()) : 0)
	);

	this.angle = angle ? angle : ( $("#arc_angle").length	?	parseFloat($("#arc_angle").val())	: 	0);

	this.p1 = new p(this.p0.x,this.p0.y);
	this.p2 = new p(this.p0.x,this.p0.y);
	this.p1.rotate(this.p,this.angle/2);
	this.p2.rotate(this.p,this.angle);

	this.side = side ? side : ($("input:radio[name='arc_side']:checked").length	?	parseInt($("input:radio[name='arc_side']:checked").val()) : 1); //3 = On line, 1 = Exterior, 2 = Interior, 4 = inside (from center)

	console.log(this);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();

	//Reset the value of "name" input & unique id "cid" -> By Security
	$("#arc_name").val("");
	$("#arc_name").data("cid","");
};

arc.prototype.update = function(x,y,x0,y0,angle,side,name) {
	this.p = new p(x,y);
	this.p0 = new p(x0,y0);

	this.angle=angle; //Angle from the start point of the arc

	this.p1 = new p(this.p0.x,this.p0.y);
	this.p2 = new p(this.p0.x,this.p0.y);
	this.p1.rotate(this.p,this.angle/2);
	this.p2.rotate(this.p,this.angle);

	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right, 4 = Inside from center
	
	//Rename the shape if applicable
	if(name) this.name=name;

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

arc.prototype.rotate = function(center,angle){ //Rotate a circle around a center point, and an angle
	this.p.rotate(center,angle);
	this.p0.rotate(center,angle);
	this.p1.rotate(center,angle);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

arc.prototype.mirror = function(center,axis){ //Mirror a circle relatively to a point and an axis (for example center point and axis 'x')
	this.p.mirror(center,axis);
	this.p0.mirror(center,axis);
	this.p1.mirror(center,axis);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

arc.prototype.translate = function(vector){ //Translate a circle of a vector (p structure (x/y))
	this.p = translate(vector);
	this.p0 = translate(vector);
	this.p1 = translate(vector);

	//Synch ToolPath (also with settings), Gcode, Canvas
	this.synch();
};

arc.prototype.setPos = function(){ //Set the center of the shape, its Left / Top / Right / Bottom limits
	this.position = new pos(
		this.p, //Center
		Math.min(this.p.x,this.p0.x,this.p1.x),	//Left
		Math.max(this.p.y,this.p0.y,this.p1.y),	//Top
		Math.max(this.p.x,this.p0.x,this.p1.x),	//Right
		Math.min(this.p.y,this.p0.y,this.p1.y)	//Bottom
	);
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
		$("#arc_angle").length	?	parseFloat($("#arc_angle").val()) : null,
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
	if ($("#arc_x").length) 	{ $("#arc_x").val(this.p.x.toString()); 	}
	if ($("#arc_y").length) 	{ $("#arc_y").val(this.p.y.toString()); 	}
	if ($("#arc_x0").length) 	{ $("#arc_x0").val(this.p0.x.toString()); }
	if ($("#arc_y0").length) 	{ $("#arc_y0").val(this.p0.y.toString()); }
	if ($("#arc_angle").length) { $("#arc_angle").val(this.angle.toString()); }
	if ($("input:radio[name='arc_side']:checked").length)	{ $("input:radio[name='arc_side'][value='"+ this.side +"']").attr("checked",true); }
};

//To change, won't work with this formula
arc.prototype.toolpath = function() {
	this.t=[];

	if (this.side == 3){ //Case toolpath on the circle
		var e={};
		e.p = new p(this.p.x,this.p.y);
		e.p0 = new p(this.p0.x,this.p0.y);
		e.p1 = new p(this.p0.x,this.p0.y);
		e.p2 = new p(this.p0.x,this.p0.y);
		e.p1.rotate(this.p,this.angle/2);
		e.p2.rotate(this.p,this.angle);
		this.t.push(e);	//Add circle to the list of toolpaths
	}
	else if (this.side == 1){ //Case toolpath outside the circle
		var e={};
		e.p = new p(this.p.x,this.p.y);
		e.p0 = new p(this.p0.x,this.p0.y);
		e.p1 = new p(this.p0.x,this.p0.y);
		e.p2 = new p(this.p0.x,this.p0.y);
		e.p1.rotate(this.p,this.angle/2);
		e.p2.rotate(this.p,this.angle);

		e.p0.x += (s.bit_d/2) * Math.cos(calculAlpha(this.p,e.p0));
		e.p0.y += (s.bit_d/2) * Math.sin(calculAlpha(this.p,e.p0));
		e.p1.x += (s.bit_d/2) * Math.cos(calculAlpha(this.p,e.p1));
		e.p1.y += (s.bit_d/2) * Math.sin(calculAlpha(this.p,e.p1));
		e.p2.x += (s.bit_d/2) * Math.cos(calculAlpha(this.p,e.p2));
		e.p2.y += (s.bit_d/2) * Math.sin(calculAlpha(this.p,e.p2));

		this.t.push(e);	//Add circle to thel ist of toolpaths
	}
	else if (this.side == 2){ //Case toolpath outside the circle
		var e={};
		e.p = new p(this.p.x,this.p.y);
		e.p0 = new p(this.p0.x,this.p0.y);
		e.p1 = new p(this.p0.x,this.p0.y);
		e.p2 = new p(this.p0.x,this.p0.y);
		e.p1.rotate(this.p,this.angle/2);
		e.p2.rotate(this.p,this.angle);

		e.p0.x -= (s.bit_d/2) * Math.cos(calculAlpha(this.p,this.p0));
		e.p0.y -= (s.bit_d/2) * Math.sin(calculAlpha(this.p,this.p0));
		e.p1.x -= (s.bit_d/2) * Math.cos(calculAlpha(this.p,e.p1));
		e.p1.y -= (s.bit_d/2) * Math.sin(calculAlpha(this.p,e.p1));
		e.p2.x -= (s.bit_d/2) * Math.cos(calculAlpha(this.p,e.p2));
		e.p2.y -= (s.bit_d/2) * Math.sin(calculAlpha(this.p,e.p2));

		this.t.push(e);	//Add circle to thel ist of toolpaths
	}
	else if (this.side == 4){ //Case toolpath inside the circle : do all the inside --> Not implemented properly yet (convert to arc cirlce)
		var alpha0 = calculAlpha(this.p,this.p0);
		var oldP0 = this.p;

		var end = 0;

		while( end==0 ){ //ABS value
			var e={};
			e.p0 = this.p;

			//Check if current arc is not too big
			if ( Math.abs(oldP0.x) > Math.abs( (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)) ) )  { oldP0.x = (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)); end=1;}
			if ( Math.abs(oldP0.y) > Math.abs( (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)) ) )  { oldP0.y = (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)); end=1;}

			if (	( Math.abs(oldP0.x) == Math.abs( (this.p0.x - (s.bit_d/2) * Math.cos(alpha0)) ) )
				&& ( Math.abs(oldP0.y) == Math.abs( (this.p0.y - (s.bit_d/2) * Math.sin(alpha0)) ) )
			)  { end=1; }

			//Put the value of the new arc
			e.P0 = oldP0;

			//Increment position for next arc
			oldP0.x += (s.bit_d) * Math.cos(alpha0);
			oldP0.y += (s.bit_d) * Math.sin(alpha0);

			this.t.push(e);	//Add arc to the list of toolpaths

		}
	}
};

arc.prototype.addTaskList = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.p.x.toString() + "," + this.p.y.toString() + ") - (" + this.p1.x.toString() + "," + this.p1.y.toString() + ") α=" + (this.p0.y - this.p.y).toString() + "</td>";
	str += "<td class='edit'><span>E</span></td>";
	str += "<td class='delete'><span>D</span></td>";
	str += "</tr>";
	return str;
};

arc.prototype.removeCanvas = function(){
	if(c && this.canvas){
		c.removeArc(this);
	}
};

arc.prototype.addCanvas = function(){
	if(c){
		c.addArc(this);
	}
};

arc.prototype.gCode = function(c){
	this.c="";
	code = "";
	var curHeight = 0;
	var curAngle = this.angle;
	var reverse = 1;
	var p0 = null;
	var p2 = null;

	while(curHeight > -s.z) {
		curHeight -= s.dz; //Lower the new z
		if (curHeight < -s.z) {curHeight = -s.z;} //Set -z limit

		$.each(this.t , function(i, t){
			//Reverse direction to save time
			reverse ? reverse = 0 : reverse = 1;

			code += ";***** STARTING A NEW ARC *****\n";
			if (!reverse) {
				//Go to start pos
				code+='G1X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'F' + s.air_speed + '\n';
				//Go to the new depth
				code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';
				
				//Do circle
				if (curAngle>0){
					code+='G2X' + (this.p2.x + s.x0) + 'Y' + (this.p2.y + s.y0) + 'I' + (this.p.x - this.p0.x + s.x0) + 'J' + (this.p.y - this.p0.y + s.y0) + 'F' + s.cut_speed + '\n';
				}
				else {
					code+='G3X' + (this.p2.x + s.x0) + 'Y' + (this.p2.y + s.y0) + 'I' + (this.p.x - this.p0.x + s.x0) + 'J' + (this.p.y - this.p0.y + s.y0) + 'F' + s.cut_speed + '\n';
				}
			}
			else {
				//Go to start pos
				code+='G1X' + (this.p2.x + s.x0) + 'Y' + (this.p2.y + s.y0) + 'F' + s.air_speed + '\n';
				//Go to the new depth
				code+='G1Z' + curHeight + 'F' + s.cut_speed + '\n';
				//Do circle
				if(curAngle>0){
					code+='G3X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'I' + (this.p.x - this.p2.x + s.x0) + 'J' + (this.p.y - this.p2.y + s.y0) + 'F' + s.cut_speed + '\n';
				}
				else {
					code+='G2X' + (this.p0.x + s.x0) + 'Y' + (this.p0.y + s.y0) + 'I' + (this.p.x - this.p2.x + s.x0) + 'J' + (this.p.y - this.p2.y + s.y0) + 'F' + s.cut_speed + '\n';
				}	
			}
		});
	}

	//Go to z over the project
	code+='G1Z' + s.z0 + 'F' + s.air_speed + '\n';

	this.c = code;
	return this.c;
};

arc.prototype.synch = function(){
	//First delete view
	this.removeCanvas();

	//Get Center, Top / Right / Bottom / Left pos
	this.setPos();

	//Synch ToolPath
	this.toolpath();

	//Synch gCode
	this.gCode();

	//Synch Canvas
	this.addCanvas();
};








/*_____________________________________________________________________________
|																			   |
|******************************************************************************|
|**************************** CUSTOM SHAPE OBJECT *****************************|
|******************************************************************************|
|******************************************************************************|
|______________________________________________________________________________|
*/

customShape = function(){
	this.shapes = []; //List of shapes that compose the current shape
	this.oldShapes = []; //List of the original shapes that form this custom shape
	this.canvas = []; //This one is a special One
	this.tCanvas = [];
	this.current = 0;
	this.pos = null;
	this.id = null;
	this.name = null;
}

//Add each of the custom prototype = read tabs to render (similar to Tasks functions, but adapted to the typology of the structure)
// !!! Be carreful not to render or calcul each small shape = no action on it (Toolpath / Canvas / Gcode)

//Calcul the custom Shape
customShape.prototype.calculShape = function(){
	//THE special function that should buid the "this.shapes" array from the "this.oldShapes" array
	return true
}

//Add "addOldShape"
//Add "removeOldShape"