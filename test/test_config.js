var assert = require("assert");
var async = require("async")
var config = require("../config");
var base = require("./test_base");

describe('Config Module', function(){

	it('Update with a valid value', function(done){
		var expected = {'st':1};
		config.driver.update(expected, function(err, result) {
			if(err) { done(err); }
			assert.equal(result.st, expected.st)
			return done();
		});
	});

	it('Update with an invalid value', function(done){
		var expected = {'st':'carrot'};
		config.driver.update(expected, function(err, result) {
			if(err) { done(err); }
			// We expect G2 to swallow the carrot and replace it with zero
			assert.equal(result.st, 0)
			return done();
		});
	});

	it('Update with multiple values', function(done){
		var expected = {'xsn':1, 'ysn':1};
		config.driver.update(expected, function(err, result) {
			if(err) { done(err); }
			// We expect G2 to swallow the carrot and replace it with zero
			assert.equal(result.xsn, 1)
			assert.equal(result.ysn, 1)
			return done();
		});
	});

	it('Update an invalid key', function(done){
		var expected = {'carrot':3.14};
		config.driver.update(expected, function(err, result) {
			if(err) { done(err); }
			assert.equal(result.carrot, null)
			return done();
		});
	});

	it('Multi Set', function(done){
		var expected = {'carrot':3.14};
		base.engine.machine.driver.setMany({'1tr':1,'2tr':2,'3tr':3}, function(err, result) {
			if(err) { done(err); }
			return done();
		});
	});

});
