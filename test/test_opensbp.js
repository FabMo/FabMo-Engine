var assert = require("assert");
var async = require("async");
var curl = require('node-curl');
var expect = require('chai').expect;
var base = require('./test_base');
var opensbp = require('../runtime/opensbp');

var sbp;

describe('OpenSBP', function(){
	before(function(done) {
		sbp = new opensbp.SBPRuntime();
		done();
	}); 

	it('CG', function(done){

		sbp.cmd_posx = 4;
		sbp.cmd_posy = 3;
		sbp.cmd_posz = 3;

		p0 = undefined;		// dia
		p1 = 1;				// endX (X)
		p2 = 0;				// endY (Y)
		p3 = 0;				// centerX (I)
		p4 = -3;				// centerY (J)
		p5 = undefined;		// O-I-T
		p6 = -1;			// Dir
		p7 = -0.125;		// Plunge
		p8 = 1;		// Passes
		p9 = undefined;		// PropX
		p10 = undefined;	// PropY	
		p11 = 0;	// Options 1-tab, 2-pocket, 3-spiral plunge & 4-spiral plunge with bottom pass
		p12 = 0;			// No Pull Up after cut
		p13 = 1;			// Start plunge from Zero

		sbp.CG([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12,p13]);

		expect(sbp.current_chunk).to.deep.equal([ 'G1Z0F40', 'G1Z-0.125F40', 'G3X1Y0I0K-3F60', 'G0Z3' ]);

		done();
	});

	it('CR', function(done) {

		sbp.cmd_posx = 0;
		sbp.cmd_posy = 0;
		sbp.cmd_posz = 0.25;

		p0 = 4;				// lenX (X)
		p1 = 2;				// lenY (Y)
		p2 = "T";			// O-I-T
		p3 = -1;			// Dir
		p4 = 0;				// Starting Corner
		p5 = -0.1;	// Plunge
		p6 = 1;				// Repetitions
		p7 = 2;		// Options - 1-Tab, 2-Pocket Outside-In, 3-Pocket Inside-Out
		p8 = 1;				// Start Plunge from Zero <0-NO, 1-YES>
		p9 = 45;		// Rotation Angle
		p10 = undefined;	// Plunge Axis
		p11 = 1;			// Spiral Plunge <1-Yes>
		p12 = 0;	// noPullUp at end

		sbp.CR([p0,p1,p2,p3,p4,p5,p6,p7,p8,p9,p10,p11,p12]);

		expect(sbp.current_chunk).to.deep.equal([ 'G1Z0F40',
			'G1Z-0.125F40',
			'G3X1Y0I0K-3F60',
			'G0Z3',
			'G0Z0.25',
			'G1Z0.25F40',
			'G1X-0.7071Y-2.1213',
			'G1Z0F40',
			'G1X2.1213Y0.7071Z-0.0250F60',
			'G1X0.7071Y2.1213Z-0.0500F60',
			'G1X-2.1213Y-0.7071Z-0.0750F60',
			'G1X-0.7071Y-2.1213Z-0.1000F60',
			'G1X2.1213Y0.7071F60',
			'G1X0.7071Y2.1213F60',
			'G1X-2.1213Y-0.7071F60',
			'G1X-0.7071Y-2.1213F60',
			'G1X-0.7071Y-1.8031F60',
			'G1X1.8031Y0.7071F60',
			'G1X0.7071Y1.8031F60',
			'G1X-1.8031Y-0.7071F60',
			'G1X-0.7071Y-1.8031F60',
			'G1X-0.7071Y-1.4849F60',
			'G1X1.4849Y0.7071F60',
			'G1X0.7071Y1.4849F60',
			'G1X-1.4849Y-0.7071F60',
			'G1X-0.7071Y-1.4849F60',
			'G1X-0.7071Y-1.1667F60',
			'G1X1.1667Y0.7071F60',
			'G1X0.7071Y1.1667F60',
			'G1X-1.1667Y-0.7071F60',
			'G1X-0.7071Y-1.1667F60',
			'G1X-0.7071Y-0.8485F60',
			'G1X0.8485Y0.7071F60',
			'G1X0.7071Y0.8485F60',
			'G1X-0.8485Y-0.7071F60',
			'G1X-0.7071Y-0.8485F60',
			'G0Z0.25',
			'G1X0Y0F60',
			'G0Z0.25' ]
		);
		done();
	});

})