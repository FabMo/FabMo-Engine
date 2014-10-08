var assert = require("assert");
var async = require("async");
var curl = require('node-curl');
var expect = require('chai').expect;
var base = require('./test_base');

//require('../log').suppress();

describe('Config API', function(){

	it('Get configuration from server', function(done){
		curl('http://127.0.0.1:9876/config', function(err) {
			var json = JSON.parse(this.body);
			expect(json).to.have.property('engine');
			expect(json).to.have.property('driver');						
			done();
		});
	});
})
