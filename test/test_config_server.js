var assert = require("assert");
var async = require("async");
var curl = require('node-curl');
var expect = require('chai').expect;
var base = require('./test_base');
var request = require('request');

//require('../log').suppress();

describe('Config API', function(){

	it('Get configuration from server', function(done){
		request.get('http://127.0.0.1:9876/config', function(err, res, body) {
			var json = JSON.parse(body);
			expect(json).to.have.property('engine');
			expect(json).to.have.property('driver');
			done();
		});
	});

	it('Post a configuration update', function(done){
		// Log level
		data = {engine:{log_level:'g2'}};

		// Do a post request to change the log level
		request.post({url: 'http://127.0.0.1:9876/config', json: true, body: data}, function(err, res, body) {
			expect(body).to.exist;
			expect(body).to.have.property('log_level');
			expect(body.log_level).to.equal('g2');

			// Do a get request to check the new configuration
			request.get('http://127.0.0.1:9876/config', function(err, res, body) {
				var json = JSON.parse(body);
				expect(json).to.have.property('engine');
				expect(json.engine.log_level).to.equal('g2');
				done();
			});
		});


	});

})
