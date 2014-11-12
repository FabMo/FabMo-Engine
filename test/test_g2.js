var assert = require("assert");
var async = require("async")
var machine = require('../machine')
var config = require("../config");
var base = require("./test_base");

describe('G2', function(){

	it('Multi Set', function(done){
		var expected = {'carrot':3.14};
		base.engine.machine.driver.setMany({'1tr':1,'2tr':2,'3tr':3}, function(err, result) {
			if(err) { done(err); }
			return done();
		});
	});

	it('Set a value', function(done){
		base.engine.machine.driver.set('st', 1, function(err, result) {
			if(err) { done(err); }
			assert.equal(result, 1);
			return done();
		});
	});

	it('Set a bogus value', function(done){
		base.engine.machine.driver.set('carrot', 0.5, function(err, result) {
			if(err) { 
				assert.equal(err.message, "Timeout");
				return done();
			}
			else {
				throw new Error("Did not get the expected timeout error from setting an illegal value")
			}
		});
	});

});
