/********** Function for "Tasks" object = all the tasks **********/
Tasks.reset = function(){
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
	t.getForm();

	//Add this to the list of Tasks
	this.push(t);

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
};

Tasks.remove = function(id){
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
	//Search for the line
	var t = this[this.pos(id)];
	t.getForm();

	//Remove current
	t.resetCurrent();

	//Save Tasks Model
	setAppSetting("straight-lines","Tasks",this);

	//View Tasks
	this.view();
}

Tasks.view = function(){
	var str=""; //Str will be the HTML content
	$.each(this, function(index,line){
		str += line.viewLine(); //For each Line, we add the HTML content
	});
	$(".list-lines-container").html(str); //Set this into the HTML table

	//Synch the click listener on this view
	listenClickTasks();
};

Tasks.toolpath = function(){
	$.each(this, function(i,t){
		t.toolpath();
	});
}

Tasks.pos = function(id) {
	var pos = false;
	$.each(this, function(i,t) {
		if(t.id == id) {
			pos = i;
		}
	});
	return pos;
};

//Sort Line by position
Tasks.sort = function(){
	this.sort(function(a,b) {return (a.id > b.id) ? 1 : ((b.id > a.id) ? -1 : 0);} );
};


	/********** Model and function of a single line **********/
line = function(l,x0,y0,x1,y1,name,side) {
	this.id="line-" + l;
	this.pos = l;
	name ? this.name = name : this.name = this.id;
	this.current=0;
	this.x0 = x0 ? x0 : 0; //X start position of a line
	this.y0 = y0 ? y0 : 0; //Y start position of a line
	this.x1 = x1 ? x1 : 0; //X end position of a line
	this.y1 = y1 ? y1 : 0; //Y end position of a line
	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right

	this.toolpath();
};

line.prototype.update = function(x0,y0,x1,y1,name,side) {
	this.x0=x0; //X start position of a line
	this.y0=y0; //Y start position of a line
	this.x1=x1; //X end position of a line
	this.y1=y1; //Y end position of a line
	this.side = side ? side : 1; //3 = center, 1 = Left, 2 = Right
	
	if(name) this.name=name;
	//else name = "Line" + pos;

	this.toolpath();
};

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

	console.log(parseInt($("input:radio[name='line_side']:checked").val()));

	//Reset the value of "name" input & unique id "cid"
	$("line_#name").val("");
	$("line_#name").data("cid","");
};

line.prototype.setForm = function(){
	if ($("#line_name").length)	{ $("#line_name").val(this.name); }
	if ($("#line_name").length)	{ $("#line_name").data("cid",this.id); }
	if ($("#line_x0").length) 	{ $("#line_x0").val(this.x0.toString()); }
	if ($("#line_y0").length) 	{ $("#line_y0").val(this.y0.toString()); }
	if ($("#line_x1").length) 	{ $("#line_x1").val(this.x1.toString()); }
	if ($("#line_y1").length) 	{ $("#line_y1").val(this.y1.toString()); }
	if ($("input:radio[name='line_side']:checked").length)	{ $("input:radio[name='line_side'][value='"+ this.side +"']").attr("checked",true); }

	console.log(this.side);
};

line.prototype.toolpath = function() {
	var alpha=0;

	var x0 = this.x0; 		var x1 = this.x1; 		var y0 = this.y0; 		var y1 = this.y1;
	this.t_x0 = this.x0;	this.t_x1 = this.x1;	this.t_y0 = this.y0;	this.t_y1 = this.y1;

	if(this.side != 3) {
		if ( (y1!=y0) && (x1!=x0) ) {
			alpha = Math.atan((y1-y0)/(x1-x0));
		}
		else {
			if(y1 == y0) {
				if((x1-x0)>0) 	{ alpha=0; }
				else 			{ alpha=pi; }
			}
			else if(x1 == x0) {
				if((y1-y0)>0) 	{ alpha=pi/2; }
				else 			{ alpha=3*pi/2; }
			}
		}

		if(this.side == 1) { alpha = pi/2 + alpha; } //Left
		else { alpha = 3*pi/2 + alpha; } //Right

		this.t_x0 += (s.bit_d/2) * Math.cos(alpha);
		this.t_x1 += (s.bit_d/2) * Math.cos(alpha);
		this.t_y0 += (s.bit_d/2) * Math.sin(alpha);
		this.t_y1 += (s.bit_d/2) * Math.sin(alpha);
	}
};

line.prototype.viewLine = function() {
	var str = "";
	str += "<tr class='" + (this.current ? 'current' : '') + "' id='" + this.id + "'>";
	str += "<td>" + this.name + "</td>";
	str += "<td>(" + this.x0.toString() + "," + this.y0.toString() + ") - (" + this.x1.toString() + "," + this.y1.toString() + ")</td>";
	str += "<td class='edit'><span>E</span></td>";
	str += "<td class='delete'><span>D</span></td>";
	str += "</tr>";
	return str;
};

line.prototype.viewToolPath = function() {
	//Read the x0... y1 of the line and trace a red / Blue line
	//Read the toolPath of the line and trace a grey shadow
	return true;
};