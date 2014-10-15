var assert = require("assert");
var async = require("async")
var machine = require('../machine')
var log = require('../log');
var config = require("../config");
var base = require("./test_base");

log.suppress();

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
			assert.equal(result, 1)
			return done();
		});
	});

});
