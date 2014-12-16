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

//Global var
var pi = 3.14159265358979323846264338327950288419716939937510582;
var s = null;
var Tasks = [] ;
var toolPath = null;
var backPath = null;


//On Load Init
$(document).ready(function(){
	//Get settings or set default settings
	s = new settings();
	s.synchForm(); //Also synch view
});


/*
*** Save / Restore Data ***
*/


/* App Settings */
setAppSetting = function(app,setting,val) {
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
	if (localStorage.getItem('app-' + app)) {
		var s = JSON.parse(localStorage.getItem('app-' + app));
		delete s[setting];
		localStorage.setItem('app-' + app,JSON.stringify(s));
	}
};




/*
*** Project Settings ***
*/


/********** Model and function related to tool & project settings **********/
settings = function(){
	var dashSettings = getAppSetting("straight-lines","s") ? getAppSetting("straight-lines","s") : false;

	this.x= dashSettings ? dashSettings.x : 3; //x Size of project
	this.y= dashSettings ? dashSettings.y : 2; //y Size of project
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
	s.update();
	setAppSetting("straight-lines","s",s);
	//dashboard.notification("success","Settings Saved");
	Tasks.toolpath();
});

//Changes tool & project settings
$("#default-settings").click(function(){
	delAppSetting("straight-lines","s");
	s = new settings();
	s.synchForm();
	//dashboard.notification("success","Settings Reseted");
	Tasks.toolpath();
});




/*
*** Play with gCode ***
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

gcode.prototype.getGc = function(){
	return ("" + this.header + this.body + this.footer);
}

gcode.prototype.G1 = function(x,y,z,s){
	//Not working yet
	console.log('G1' + (x ? 'X' + (x + s.x0).toString() : '') + (y ? 'Y' + (y + s.y0).toString() : '') + (z ? 'Z' + z.toString() : '') + 'F' + s + '\n');
	return ('G1' + (x ? 'X' + (x + s.x0) : '') + (y ? 'Y' + (y + s.y0) : '') + (z ? 'Z' + z : '') + 'F' + s + '\n');
}

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
		this.body +='G1Z' + s.z0 + 'F' + s.air_speed + '\n';
	}
};