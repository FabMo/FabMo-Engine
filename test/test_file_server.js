var assert = require("assert");
var async = require("async");
var curl = require('node-curl');
var expect = require('chai').expect;
var base = require('./test_base');
var request = require('request');
var fs = require('fs');

//require('../log').suppress();

describe('File API', function(){

	it('Get file listing from server', function(done){
		request.get('http://127.0.0.1:9876/file', function(err, res, body) {
			var json = JSON.parse(body);
			expect(json).to.have.property('files');
			done();
		});
	});


	it('Upload a file', function(done){
		// Log level
		var formData = {
			file : fs.createReadStream(__dirname + '/data/square.nc')
		}
		// Do a post request to change the log level
		request.post({url: 'http://127.0.0.1:9876/file', 'formData' : formData}, function(err, res, body) {
			json = JSON.parse(body);
			expect(json).to.have.property('filename');
			expect(json.filename).to.equal('square.nc');
			done();
		});
	});

})
