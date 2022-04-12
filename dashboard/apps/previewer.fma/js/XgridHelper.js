/**
 * @author mrdoob / http://mrdoob.com/
 * ## Modified by TH to do unequal X and Y grid line per threejs examples
 * ## This is working differently than the orbit control call; seems to have to reference three orbit
 */

// import { LineSegments } from 'three/src/objects/LineSegments.js';
// import { VertexColors } from 'three/src/constants.js';
// import { LineBasicMaterial } from 'three/src/materials/LineBasicMaterial.js';
// import { Float32BufferAttribute } from 'three/src/core/BufferAttribute.js';
// import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
// import { Color } from 'three/src/math/Color.js';


//var THREE = require("three");

THREE.XgridHelper = function ( sizeX, stepX, sizeZ, stepZ) {

	var halfsizeX = sizeX / 2;
	var halfsizeZ = sizeZ / 2;
	
	var geometry = new THREE.Geometry();
	var material = new THREE.LineBasicMaterial( { vertexColors: THREE.VertexColors } );
	
	this.color1 = new THREE.Color( 0x888888 );
//	this.color2 = new THREE.Color( 0x880000 );
	var color = this.color1
		
	for ( var i = - 1 * halfsizeX; i <= halfsizeX; i += stepX ) {
			geometry.vertices.push(
			new THREE.Vector3( i, 0, - 1 * halfsizeZ ),
			new THREE.Vector3( i, 0, halfsizeZ )
		);
	//	var color = i === 0 ? this.color1 : this.color2;
		geometry.colors.push( color, color, color, color );
	}
        for ( var i = halfsizeZ; i >= -1 * halfsizeZ; i -= stepZ ) {
                geometry.vertices.push(
			new THREE.Vector3( - 1 * halfsizeX, 0, i ),
			new THREE.Vector3( halfsizeX, 0, i )
		);
	//	var color = i === 0 ? this.color1 : this.color2;
		geometry.colors.push( color, color, color, color );
	}
	
	THREE.Line.call( this, geometry, material, THREE.LineSegments );
    };
	
	THREE.XgridHelper.prototype = Object.create( THREE.LineSegments.prototype );
	THREE.XgridHelper.prototype.constructor = THREE.XgridHelper;
	
	THREE.XgridHelper.prototype.setColors = function( colorCenterLine, colorGrid ) {
	
	this.color1.set( colorCenterLine );
	this.color2.set( colorGrid );
	
	this.geometry.colorsNeedUpdate = true;
	
	}

// export { XgridHelper };
