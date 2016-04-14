var LoadTests = function() {

RegisterTest({
	name : 'Submit Job (G-Code)',
	description: 'Submit a G-Code Job',
	},
	function(callback) {
		fabmo.submitJob({file : "G0 X1", filename : 'myfile.nc'}, function(err, result) {
			callback(err);
		});
	});

}
