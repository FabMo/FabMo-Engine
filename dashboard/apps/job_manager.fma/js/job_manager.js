// Current position in the history browser
var historyStart = 0;
var historyCount = 10;
var historyTotal = 0;

// Timer for the running job indicator
var blinkTimer = null;

// The currently running Job ID
var currentJobId = -1; 

function setupDropTarget() {
	$('#tabpending').dragster({
		enter : function(devt, evt) {
			$('#tabpending').addClass('hover');
			console.log("Hovering")
			return false; 
		}, 

		leave : function (devt, evt) {
			$('#tabpending').removeClass('hover');
			console.log("Exiting")
			return false;
		},
		drop : function (devt, evt) {
			evt.preventDefault();
			try {
				file = evt.originalEvent.dataTransfer.files;
				console.log(file);
				fabmo.submitJob(file, {}, function(err, data) {
					if(err){
						fabmo.notify('error', err);
					}
					updateQueue();
				});
			}
			finally {
				$('#tabpending').removeClass('hover');
				return false;
			}
		}
	});	
}

function updateQueue(running, callback) {
	// Update the queue display.
	fabmo.getJobsInQueue(function(err, jobs) {
		if(err) { return callback(err); }
		clearQueue();
		if(jobs) {
			if(running) {
				if(jobs.length > 0) {
					addQueueEntries(jobs);
					$('.job-queue').show(500);
				}
			} else {
				console.log("not running")
				setNextJob(jobs[0]);
				if (jobs.length > 1) { // Show the queue table if there's more than one job in the queue.
					$('.job-queue').show(500);
					addQueueEntries(jobs.slice(1));
				} else {
					$('.job-queue').slideUp(500);
				}				
			}
		}
		typeof callback === 'function' && callback();
	});

}

function clearQueue() {
	var table = document.getElementById('queue_table');
	var rows = table.rows.length;
	for(var i=0; i<rows; i++) {
		table.deleteRow(0);
	}
}

function createQueueMenu(id) {
	var menu = "<div data-jobid='JOBID' class='ellipses' title='more actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='cancelJob' data-jobid='JOBID'>Cancel Job</a></li><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job</a></li></ul></div>";
	return menu.replace(/JOBID/g, id);
}	

function addQueueEntries(jobs) {
	var table = document.getElementById('queue_table');
	jobs.forEach(function(job) {
		var row = table.insertRow(table.rows.length);
		var menu = row.insertCell(0);
		menu.className += ' actions-control';
		var name = row.insertCell(1);

		menu.innerHTML = createQueueMenu(job._id);
		name.innerHTML = job.name;
	});
	bindMenuEvents();
}

/*
 * -----------
 *   HISTORY
 * -----------
 */
function updateHistory(callback) {
	fabmo.getJobHistory({
		start : historyStart,
		count : historyCount
	}, function(err, jobs) {
		if(err) { return callback(err); }
		// Hide/show the next/prev buttons according to the history total
		historyTotal = jobs.total_count;
		$('#history_page_next').toggle(historyTotal > (historyStart + historyCount));
		$('#history_page_prev').toggle(historyStart > 0);
		// Eliminate entries in the table and repopulate with fresh data
		clearHistory();
		addHistoryEntries(jobs.data);
		typeof callback === 'function' && callback();
	});
}

function historyPreviousPage(callback) {
	historyStart -= historyCount;
	if(historyStart < 0) { historyStart = 0;}
	updateHistory(callback);
}

function historyNextPage(callback) {
	historyStart += historyCount;
	updateHistory(callback);
}

function clearHistory() {
	var table = document.getElementById('history_table');
	var rows = table.rows.length;
	for(var i=0; i<rows; i++) {
		table.deleteRow(0);
	}
}

function createHistoryMenu(id) {
	var menu = "<div class='ellipses' title='More Actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='resubmitJob' data-jobid='JOBID'>Run Again</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job</a></li></ul></div>"
	return menu.replace(/JOBID/g, id)
}

function addHistoryEntries(jobs) {
	var table = document.getElementById('history_table');
	jobs.forEach(function(job) {
		var row = table.insertRow(table.rows.length);
		var menu = row.insertCell(0);
		menu.className += ' actions-control';
		var name = row.insertCell(1);
		var done = row.insertCell(2);
		var time = row.insertCell(3);

		menu.innerHTML = createHistoryMenu(job._id);
		name.innerHTML = '<div class="job-' + job.state + '">' + job.name + '</div>';
		done.innerHTML = moment(job.finished_at).fromNow();
		time.innerHTML = moment.utc(job.finished_at - job.started_at).format('HH:mm:ss');
	});
	bindMenuEvents();
}

function bindMenuEvents() {
	function hideDropDown() {
		$('.dropDownWrapper').hide();
		$('.dropDown').hide();
		$('.commentBox').hide();
	}

	$('.resubmitJob').click(function(e) {
		console.log("resubmit")
		fabmo.resubmitJob(this.dataset.jobid, function(err, result) {
			console.log("Resubmitted");
			//refresh_jobs_list();
			fabmo.getJobsInQueue(function(err, data) {
				$('.toggle-topbar').click();
				$('#nav-pending').click();
				updateQueue(false);
			});
		});
		hideDropDown();
	});

	$('.cancelJob').click(function(e) {
		fabmo.cancelJob(this.dataset.jobid, function(err, data) {
			if(err) { fabmo.notify(err); }
			else {
				updateQueue();
				updateHistory();
			}
		});
		hideDropDown();
	});

	$('.previewJob').click(function(e) {
		fabmo.launchApp('previewer', {'job' : this.dataset.jobid});
		hideDropDown();
	});

	$('.editJob').click(function(e) {
		fabmo.launchApp('editor', {'job' : this.dataset.jobid});
		hideDropDown();
	});

	$('.downloadJob').click(function(e) {
		fabmo.navigate('/job/' + this.dataset.jobid + '/file');
	});	

	$('.dropDownWrapper').click(function (){
		hideDropDown();
	});

    $('.ellipses').click(function (evt) {
    	//create and show a transparent overlay that you can click to close
		$('.dropDownWrapper').show();
		var dd = $(this).nextAll();
		dd.show();
 	});
}

function bindNextJobEvents() {
		$('.cancel').on('click', function(e) {
			fabmo.cancelJob( $(this).data('id'), function(err, data) {
				updateQueue(false);
				updateHistory();					
			});
		});
		$('.preview').on('click', function(e) {
			fabmo.launchApp('previewer', {'job' : $(this).data('id')});
		});
		$('.edit').on('click', function(e) {
			fabmo.launchApp('editor', {'job' : $(this).data('id')});
		});
		$('.download').on('click', function(e) {
			$('.download').attr({'href':'/job/' + $(this).data('id') + '/file'});
		});	
}

function noJob() {
		$('.cancel').slideUp();		
		$('.download').slideUp();
		$('.edit').slideUp();
		$('.preview').slideUp();
		$('.play-button').slideUp();
		$('.without-job').css('left', '0px');
		$('.nextJobTitle').text('');
		$('.nextJobDesc').text('');
        $('.no-jobs').css('left', '0px');
        $('.up-next').css('left', '-2000px');
        $('.with-job').css('left','-2000px');
};

function nextJob(job) {
   		$('.without-job').css('left','-2000px');
		$('.cancel').data('id', job._id);
		$('.preview').data('id', job._id);
		$('.download').data('id', job._id);
		$('.edit').data('id', job._id);
		$('.with-job').css('left','10px');
		$('.nextJobTitle').text(job.name);
		$('.nextJobDesc').text(job.description);
		$('.cancel').show(500);
		$('.download').show(500);
		$('.edit').show(500);
		$('.preview').show(500);
		$('.play-button').show();
        $('.up-next').css('left', '0px');
        $('.no-jobs').css('left', '-2000px');
};

function runningJob(job) {
   	$('.nextJobTitle').text(job.name);
	$('.nextJobDesc').text(job.description);
	$('.cancel').slideUp(100);
	$('.download').slideUp(100);
	$('.edit').slideUp(100);
	$('.preview').slideUp(100);
	$('body').css('background-color', '#898989');
	$('.topjob').addClass('running');
	$('.up-next').css('left', '-2000px');
    $('.no-jobs').css('left', '-2000px');
	$('.now-running').css('left', '0px');
	$('.without-job').css('left','-2000px');;
	$('.with-job').css('left','10px');	
	$('.play-button').show();
    fabmo.showFooter();
};

var setNextJob = function (job) {
	job ? nextJob(job) : noJob();
}

var setJobheight = function () {
	var w = $('.with-job').height();
	var wo = $('.without-job').height();
	var height = 0;
	if (w > wo) {
		height = w;
		
	} else {
		height = wo;
		
	}
	$('.jobs-wrapper').height(height);
};

var setProgress = function(status) {
	var prog = ((status.line/status.nb_lines)*100).toFixed(2);
	var percent = Math.ceil(prog);
	var rotation = Math.ceil(180*(percent/100));
 	var fill_rotation = rotation;
 	var fix_rotation = rotation * 2;
	var transform_styles = ['-webkit-transform','-ms-transform','transform'];
	if (!status.job) {
		$('.fill, .mask.full').css(transform_styles[i], 'rotate(0deg)');
		$('.fill.fix').css(transform_styles[i], 'rotate(0deg)');
		$('.up-next').css('left', '-2000px');
		$('.now-running').css('left', '-2000px');
		$('.play').removeClass('active');
	} 
	for(i in transform_styles) {
			$('.fill, .mask.full').css(transform_styles[i], 'rotate(' + fill_rotation + 'deg)');
			$('.fill.fix').css(transform_styles[i], 'rotate(' + fix_rotation + 'deg)');
	}
}

/*
 * ---------
 *  STATUS
 * ---------
 */
function handleStatusReport(status) {

	// Either we're running a job currently or null
	try {
		var jobid = status.job._id || null;
	} catch(e) {
		var jobid = null;
	}

	if(jobid) { // Job is currently running
		setProgress(status);
		if(jobid != currentJobId) { // Freshly started or changed job
			$('.play').addClass('active')
			currentJobId = jobid;
			runningJob(status.job);
			updateQueue(true);
		}
	} else {
		if(currentJobId) {
			$('.play').removeClass('active')
			setProgress(status);
			// UI Stuff
			$('.topjob').removeClass('running');
			$('body').css('background-color', '#EEEEEE');
			$('.play').removeClass('active');

			currentJobId = null;
			updateQueue(false);
			updateHistory();
		}
	}
}