require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

$(document).ready(function() {
	$('#submitSingleString').click(function(evt){
		evt.preventDefault();
		console.info("Submitting a single string")
		fabmo.submitJob({file : "G0 X1", filename : 'myfile.nc'}, function(err, result) {
			if(err) {
				fabmo.notify('error', err);
			}
			else {
				fabmo.notify('Success');
			}
		});
	});

	$('#submitArrayOfStrings').click(function(evt){
		evt.preventDefault();
		console.info("Submitting an array of strings")
		fabmo.submitJob([
			{file : "G0 X1", filename : "ex_one.nc"},
			{file : "G0 Y1", filename : "wye_one.nc"},
			{file : "G0 Z1", filename : "zee_one.nc"}
			], function(err, result) {

		});
	});

	$('#submitSingleObject').click(function(evt){
		evt.preventDefault();
		fabmo.submitJob({
			filename : 'job1.nc',
			file : 'G0 X1',
			name : 'Job 1',
			description : "Job 1"
		});
	});

	$('#submitJobStayHere').click(function(evt){
		evt.preventDefault();
		fabmo.submitJob({
			filename : 'job1.nc',
			file : 'G0 X1',
			name : 'Job 1',
			description : "Job 1"
		}, {stayHere : true}, function(err, result) { {
			if(err) { return console.error(err); }
			console.info("Got submitJob Callback");
		}});
	});

	$('#resubmitJobStayHere').click(function(evt){
		evt.preventDefault();
		fabmo.resubmitJob(558, {stayHere : true}, function(err, result) { {
			if(err) { return console.error(err); }
			console.info("Got resubmitJob Callback")
		}});
	});

	$('#resubmitJob').click(function(evt){
		evt.preventDefault();
		fabmo.resubmitJob(558, function(err, result) { {
			if(err) { return console.error(err); }
			console.info("Got resubmitJob Callback")
		}});
	});

	$('#runNext').click(function(evt){
		evt.preventDefault();
		fabmo.runNext(function(err, result) { {
			if(err) { return console.error(err); }
			console.info("Got runNext callback")
		}});
	});

	$('#submitArrayOfObjects').click(function(evt){
		evt.preventDefault();
		fabmo.submitJobs([{
			filename : 'job1.nc',
			file : 'G0 X1',
			name : 'Job 1',
			description : "Job 1"
		},

		{
			filename : 'job1.nc',
			file : 'G0 X1',
			name : 'Job 1',
			description : "Job 1"
		},

		{
			filename : 'job1.nc',
			file : 'G0 X1',
			name : 'Job 1',
			description : "Job 1"
		}]);
	});

	$('#showModal').click(function(evt) {
		fabmo.showModal({
			title: "Modal Dialog!",
			message: "This is a modal I sure hope it doesn't get interrupted."
		});
	});

	$('#fileForm').submit(function(evt){
		evt.preventDefault();
		fabmo.submitJobs($('#fileForm'));
	});

	$("#navigateRelative").click(function(evt) {
		fabmo.navigate('path/sample.pdf');
	});

	$("#navigateAbsolute1").click(function(evt) {
		fabmo.navigate('/log');
	});

	$("#navigateAbsolute2").click(function(evt) {
		fabmo.navigate('http://www.handibot.com/');
	});


});
