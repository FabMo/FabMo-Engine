var Terrain = function(element, options) {
	this.element = element;
	this.options(options);
}

Terrain.prototype.options = function(options) {
	default_options = {
		width : 5.0,
		height : 5.0,
		material_thickness : 1.0,
		base_thickness : 1.0, 
		method : 'simplex2',
		resolution : 0.0625,
		scale : 1.0
	};

	options = options || {};

	this.width = options.width || default_options.width;
	this.height = options.height || default_options.height;
	this.material_thickness = options.material_thickness || default_options.material_thickness;
	this.base_thickness = options.base_thickness || default_options.base_thickness;
	this.method = options.method || default_options.method;
	this.resolution = options.resolution || default_options.resolution;
	this.scale = options.scale || default_options.scale;
}

Terrain.prototype.generate = function(seed) {
	seed = seed || Math.random();
	noise.seed(seed);
	var geometry = new THREE.PlaneGeometry( this.width, this.height, this.width/this.resolution, this.height/this.resolution );
	var terrain_scale = 1.0/this.scale;
	
	//set height of plane vertices
	for ( var i = 0; i<geometry.vertices.length; i++ ) {
		var x = geometry.vertices[i].x;
		var y = geometry.vertices[i].y;
		var z = this.material_thickness*noise.simplex2(terrain_scale*x,terrain_scale*y);
		geometry.vertices[i].z = z;
	}
	return geometry
}