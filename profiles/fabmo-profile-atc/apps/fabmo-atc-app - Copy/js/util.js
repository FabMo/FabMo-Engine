
function getFile(url, options) {
	return new Promise(function(resolve, reject) {
		function onLoad () {
			console.info(this.status)
			switch(this.status) {
				case 0:
				case 200:
					resolve(this.responseText);
					break;
				default:
					reject(new Error(this.responseText))
					break;
			}
		}

		var oReq = new XMLHttpRequest();
		oReq.addEventListener("load", onLoad);
		oReq.open("GET", url);
		oReq.send();	
	});
}

// Super cool pyramid of death for running shopbot code as a test
function doSBP(sbpCode, name) {
	name = name || 'test.sbp'
	return new Promise(function(fulfill, reject) {
		fabmo.clearJobQueue(function() {
			fabmo.submitJob({file : sbpCode, filename : name}, {
					stayHere : true
				}, function(err, data) {
					if(err) {
						console.error(err);
						fabmo.notify('err', err);
						return reject(err);
					}
					var jobId = data.jobs[0]._id;
					fabmo.on('status', function(status) {
						if(status.state === 'idle') {
							fabmo.getJobInfo(jobId, function(err, info) {
								switch(info.state) {
									case 'finished':
										fabmo.off('status');
										return fulfill();
										break;
									case 'failed':
										fabmo.off('status');
										return reject(new Error('Job failed.'));
										break;
									default:
									break;
								}
							});
						}
					});
					fabmo.runNext();
			});
		});
	});	
}

function doSBPURL(url) {
	return getFile(url)
		.then(function resolve(data) {
			return doSBP(data);
		});
}