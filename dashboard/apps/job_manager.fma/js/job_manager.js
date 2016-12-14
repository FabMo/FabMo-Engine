require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Sortable = require('./Sortable.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

// Current position in the history browser
var historyStart = 0;
var historyCount = 10;
var historyTotal = 0;
// Timer for the running job indicator
var blinkTimer = null;

// The currently running Job ID
var currentJobId = -1;
var currentStatus = {};

function setupDropTarget() {
  $('#tabpending').dragster({
    enter: function(devt, evt) {
      $('#tabpending').addClass('hover');
      return false;
    },

    leave: function(devt, evt) {
      $('#tabpending').removeClass('hover');
      return false;
    },
    drop: function(devt, evt) {
      evt.preventDefault();
      try {
        file = evt.originalEvent.dataTransfer.files;
        if(file.length > 0) {
          fabmo.submitJob(file, {}, function(err, data) {
            if (err) {
              fabmo.notify('error', err);
            }
            updateQueue();
          });
        }
      } finally {
        $('#tabpending').removeClass('hover');
        return false;
      }
    }
  });
}

function updateQueue(callback) {
  callback = callback || function() {};
  // Update the queue display.
  fabmo.getJobsInQueue(function(err, jobs) {
    var jobElements = document.getElementById("queue_table").childElementCount;
    if (err) {
      return callback(err);
    }
    if (jobs.pending.length === jobElements && jobs.pending.length != 0) {
      return
    } else {
      jobs.pending.sort(function(a, b) {
        return a.order - b.order;
      });
      if (jobs.running.length) {
        var current = jobs.running[0];
        jobs.pending.unshift(current);
        addQueueEntries(jobs.pending);
        runningJob(current);
      } else {
        runningJob(null);
        addQueueEntries(jobs.pending);
      }
    }
    callback();
  });
}

function clearQueue() {
  var elements = document.getElementsByClassName('job_item');
  while (elements.length > 0) {
    elements[0].parentNode.removeChild(elements[0]);
  }
}

function clearRecent() {
  var elements = document.getElementsByClassName('recent_item');
  while (elements.length > 0) {
    elements[0].parentNode.removeChild(elements[0]);
  }
}

function createQueueMenu(id) {
  var menu = "<div data-jobid='JOBID' class='ellipses' title='more actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job</a></li><li><a class='deleteJob' data-jobid='JOBID'>Delete Job</a></li></ul></div>";
  return menu.replace(/JOBID/g, id);
}

function createRecentMenu(id) {
  var menu = "<div  class='ellipses' title='Run Again'><i data-jobid='JOBID'class='fa fa-arrow-circle-up add resubmitJob' aria-hidden='true'></i></div>";
  return menu.replace(/JOBID/g, id);
}

function makeActions() {
  var actions = '<div> <div class="small-2 medium-4 columns play-button" style="text-align:right;"> <div class="radial_progress"> <div class="perecent_circle"> <div class="mask full"><div class="fill"></div></div><div class="mask half"><div class="fill"></div><div class="fill fix"> </div> </div> <div class="shadow"> </div> </div> <div class="inset"> <div id="run-next" class="play"><span></span></div> </div></div></div></div><div class="small-8 medium-12 icon-row" sortable="false"><div class="medium-1 small-2 columns"><a class="preview" title="Preview Job"><img  class="svg" src="css/images/visible9.svg"></a></div><div class="medium-1 small-2 columns"><a class="edit" title="Edit Job"><img class="svg" src="images/edit_icon.png"></a></div><div class="medium-1 small-2 columns"><a class="download" title="Download Job"><img  class="svg" src="css/images/download151.svg"></a></div><div class="medium-1 small-2 columns"><a class="cancel" title="Cancel Job"><img  class="svg" src="css/images/recycling10.svg"></a></div><div class="sm-1 columns"></div></div><div class="row"></div><div class="job-lights-container"><div class="job-status-light one off"><div class="job-status-indicator"></div></div><div class="job-status-light two off"><div class="job-status-indicator"></div></div><div class="job-status-light three off"><div class="job-status-indicator"></div></div></div>'
  return actions;
}

function addQueueEntries(jobs) {
  clearQueue();
  var table = document.getElementById('queue_table');
  var temp = [];
  var recent = [];
  if (jobs.length) {
    $('.no-jobs').css('left', '-2000px');
    nextJob();
    for (i = 0; i < jobs.length; i++) {
      var listItem = document.createElement("div");
      listItem.setAttribute("id", jobs[i]._id);
      if (jobs[i].order === null) {
        var max = 0;
        for (var i = 0; i < temp.length; i++) {
          if (temp[i] > max)
            max = temp[i];
        }
        temp.push(max + 1);
        jobs[i].order = max + 1;
      } else {
        temp.push(jobs[i].order);
      }
      listItem.setAttribute("class", "job_item");
      listItem.setAttribute("data-id", jobs[i]._id);
      table.appendChild(listItem);
      var id = document.getElementById(jobs[i]._id);
      id.innerHTML = '<div id="menu"></div><div class="name">' + jobs[i].name + '</div><div class="description">' + jobs[i].description + '</div>';
      var menu = id.firstChild;

      // menu.className += ' actions-control';
      // var name = row.insertCell(1);

      menu.innerHTML = createQueueMenu(jobs[i]._id);
      // name.innerHTML = job.name;
    };
    setFirstCard(jobs[0]._id);
    bindMenuEvents();
  } else {
    $('.no-jobs').css('left', '0px');
    fabmo.getJobHistory({
      start: 0,
      count: 0
    }, function(err, jobs) {
      var arr = jobs.data;
      var i = 0;
      for (var a = 0; a < arr.length; a++){
        if (i === 4 ){
          break;
        } else {
         var result = recent.filter(function(e){ return e.file_id == arr[a].file_id; });
         if (result.length === 0) {
           recent.push(arr[a]);
           i++;
         }
        }
      }
    var recentJobs = document.getElementById('recent');
    clearRecent();
    for (i = 0; i < recent.length; i++) {
      var recentItem = document.createElement("div");
      recentItem.setAttribute("id", recent[i]._id);
      recentItem.setAttribute("class", "recent_item");
      recentItem.setAttribute("data-id", recent[i]._id);
      recentJobs.appendChild(recentItem);
      var id = document.getElementById(recent[i]._id);
      id.innerHTML = '<div id="menu"></div><div class="name">' + recent[i].name + '</div><div class="description">' + recent[i].description + '</div>';
      var menu = id.firstChild;

      // menu.className += ' actions-control';
      // var name = row.insertCell(1);

      menu.innerHTML = createRecentMenu(recent[i]._id);

    };
     bindMenuEvents();
      // for(var i = 0; i< arr.length; i++) {
      // var num = arr[i].file_id;
      //   counts[num] = counts[num] ? counts[num]+1 : 1;
      // }
      if (err) {
        return callback(err);
      }
    });
  }
}

function setFirstCard(id) {
  var el = document.getElementById(id);
  var cardActions = document.createElement("div");
  cardActions.setAttribute("id", "actions");
  el.appendChild(cardActions);
  var actions = document.getElementById("actions");
  actions.innerHTML = makeActions();
  $('.cancel').data('id', id);
  $('.preview').data('id', id);
  $('.download').data('id', id);
  $('.edit').data('id', id);
}

/*
 * -----------
 *   HISTORY
 * -----------
 */
function updateHistory(callback) {
  fabmo.getJobHistory({
    start: historyStart,
    count: historyCount
  }, function(err, jobs) {
    if (err) {
      return callback(err);
    }
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
  if (historyStart < 0) {
    historyStart = 0;
  }
  updateHistory(callback);
}

function historyNextPage(callback) {
  historyStart += historyCount;
  updateHistory(callback);
}

function clearHistory() {
  var table = document.getElementById('history_table');
  var rows = table.rows.length;
  for (var i = 0; i < rows; i++) {
    table.deleteRow(0);
  }
}

function createHistoryMenu(id) {
  var menu = "<div class='ellipses' title='More Actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='resubmitJob' data-jobid='JOBID'>Add To Queue</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job</a></li><li><a class='deleteJob' data-jobid='JOBID'>Delete Job</a></li></ul></div>"
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

  $('.resubmitJob').off('click');
  $('.resubmitJob').click(function(e) {
    fabmo.resubmitJob(this.dataset.jobid, function(err, result) {
      //refresh_jobs_list();
      fabmo.getJobsInQueue(function(err, data) {
        $('.toggle-topbar').click();
        $('#nav-pending').click();
        updateQueue(false);
      });
    });
    hideDropDown();
  });




  $('.previewJob').off('click');
  $('.previewJob').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('previewer', {
      'job': this.dataset.jobid
    });
    hideDropDown();
  });

  $('.editJob').off('click');
  $('.editJob').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('editor', {
      'job': this.dataset.jobid
    });
    hideDropDown();
  });

  $('.downloadJob').off('click')
  $('.downloadJob').click(function(e) {
    fabmo.navigate('/job/' + this.dataset.jobid + '/file');
  });

  $('.deleteJob').off('click')
  $('.deleteJob').click(function(e) {
    fabmo.deleteJob(this.dataset.jobid);
    updateHistory(callback);
  });

  $('.dropDownWrapper').off('click')
  $('.dropDownWrapper').click(function() {
    hideDropDown();
  });

  $('.ellipses').off('click')
  $('.ellipses').click(function(evt) {
    //create and show a transparent overlay that you can click to close
    $('.dropDownWrapper').show();
    var dd = $(this).nextAll();
    dd.show();
  });
}


function noJob() {
  $('.with-job').data('job', false);
  $('.up-next').css('left', '-2000px');
};

function nextJob(job) {
  $('.with-job').data('job', true);
  $('.with-job').css('left', '10px');
  // $('.icon-row a').show(500);
  // $('.cancel').show(500);
  // $('.download').show(500);
  // $('.edit').show(500);
  // $('.preview').show(500);
  // $('.play-button').show();
  $('.up-next').css('left', '0px');
};

// Job should be the running job or null
function runningJob(job) {
  if (!job) {
    setProgress(status);
    $('.play').removeClass('active')
    $('body').css('background-color', '#EEEEEE');
    $('.play').removeClass('active');
    $('.play-button').show();
    sortable.options.disabled = false;
    return
  }


  $('.cancel').slideUp(100);
  $('.download').slideUp(100);
  $('.edit').slideUp(100);

  // $('.preview').slideUp(100); // Here if the live viewer button moves
  $('.preview').off('click');
  $('.preview').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('previewer', {
      'job': job._id,
      "isLive" : true
    });
    hideDropDown();
  });

  $('body').css('background-color', '#898989');
  $('.topjob').addClass('running');
  // $('.job-lights-container').show();
  // $('.job-status-indicator').css({
  //     '-moz-box-shadow': '0 .5px 1px rgba(0, 0, 0, .25), 0 2px 3px rgba(0, 0, 0, .1)',
  //     '-webkit-box-shadow':'0 .5px 1px rgba(0, 0, 0, .25), 0 2px 3px rgba(0, 0, 0, .1)',
  //     'box-shadow':'0 .5px 1px rgba(0, 0, 0, .25), 0 2px 3px rgba(0, 0, 0, .1)'
  // })
  $('.up-next').css('left', '-2000px');
  $('.no-jobs').css('left', '-2000px');
  $('.now-running').css('left', '0px');
  $('.without-job').css('left', '-2000px');;
  $('.play-button').show();
  $('.play').addClass('active')
  sortable.options.disabled = true;
};

var setProgress = function(status) {
  var prog = ((status.line / status.nb_lines) * 100).toFixed(2);
  if (prog > 100){
			prog = 100;
	}
	if (isNaN(prog)){
			prog = 0;
	}
  var percent = Math.ceil(prog);
  var rotation = Math.ceil(180 * (percent / 100));
  var fill_rotation = rotation;
  var fix_rotation = rotation * 2;
  var transform_styles = ['-webkit-transform', '-ms-transform', 'transform'];
  if (!status.job) {
    $('.up-next').css('left', '-2000px');
    $('.now-running').css('left', '-2000px');

    for (i in transform_styles) {
      $('.fill, .mask.full').css(transform_styles[i], 'rotate(0deg)');
      $('.fill.fix').css(transform_styles[i], 'rotate(0deg)');
    }

  }
  for (i in transform_styles) {
    $('.fill, .mask.full').css(transform_styles[i], 'rotate(' + fill_rotation + 'deg)');
    $('.fill.fix').css(transform_styles[i], 'rotate(' + fix_rotation + 'deg)');
  }
}

// var lightsOn = function (param) {
//     if (param === "on"){
//     var arr = ['one','two','three'];
//     var i = 0;
//     setInterval(
//        function (){
//             $('.job-status-light.' + arr[i]).toggleClass('off', 500);
//             i++;
//             if(i >= arr.length) i = 0;
//         },500);
//     } else if (param === "off") {

//         return f
//     }
// }
/*
 * ---------
 *  STATUS
 * ---------
 */
function handleStatusReport(status) {
  // Either we're running a job currently or null
  try {
    var jobid = status.job._id || null;
  } catch (e) {
    var jobid = null;
  }

  if (jobid) { // Job is currently running
    setProgress(status);
  }
}



	var el = document.getElementById('queue_table');
	var sortable = Sortable.create(el, {
	ghostClass: 'ghost',
	chosenClass: 'chosen',
	dataIdAttr: 'data-id',
	clickDelay: 0,
	touchDelay: 100,
	animation: 150,
	filter: ".cancel, .preview, .edit, .download, .play-button, .previewJob, .editJob, .downloadJob, .deleteJob, .ellipses",
	onStart: function(evt) {
		var remove = document.getElementById('actions');
		remove.parentNode.removeChild(remove);
		var ctrl =  evt.item;
		ctrl.removeAttribute("style");
	},
	onFilter: function (evt) {
        var item = evt.item,
            ctrl = evt.target;
			var id = ctrl.getAttribute('data-jobid');
			if (Sortable.utils.is(ctrl, ".cancel")) {
				fabmo.deleteJob( $('.cancel').data('id'), function(err, data) {
      				updateQueue(false);
      				updateHistory();
   				});
			} else if (Sortable.utils.is(ctrl, ".preview")) {
				fabmo.launchApp('previewer', {
					'job': $('.preview').data('id')
				});
			} else if (Sortable.utils.is(ctrl, ".edit")) {
				 fabmo.launchApp('editor', {
      				'job': $('.edit').data('id')
   				 });
			} else if (Sortable.utils.is(ctrl, ".download")) {
				$('.download').attr({
     				 'data-href': '/job/' + $('.download').data('id') + '/file'
    			});
        fabmo.navigate($('.download').data('href'));
			} else if (Sortable.utils.is(ctrl, ".ellipses")){
				var dd = ctrl.parentNode.childNodes[2];
				var cd = ctrl.parentNode.childNodes[1];
				 $('.dropDownWrapper').show();
    			dd.style.display = 'block';
				cd.style.display = 'block';
			} else if (Sortable.utils.is(ctrl, ".previewJob")){
				 fabmo.launchApp('previewer', {
					 'job': id
				 });
				hideDropDown();
			} else if (Sortable.utils.is(ctrl, ".editJob")){
				fabmo.launchApp('editor', {
					 'job': id
				 });
				hideDropDown();
			} else if (Sortable.utils.is(ctrl, ".downloadJob")){
				fabmo.navigate('/job/' + id + '/file');
			} else if (Sortable.utils.is(ctrl, ".deleteJob")){
				 fabmo.deleteJob(id);
			} else if (Sortable.utils.is(ctrl, ".play-button")){
          if ($('.play').hasClass('active')) {
            fabmo.pause(function(err, data) {});
          }
          else {
          fabmo.runNext(function(err, data) {
              if (err) {
                fabmo.notify(err);
              } else {
                updateQueue();
              }
            });
        }
			}
		},

	onMove : function(evt){
		var ctrl =  evt.dragged;
		ctrl.removeAttribute("style");
	},
	onEnd: function(evt) {
		var firstJob = document.getElementById('queue_table').firstChild;
		var cardActions = document.createElement("div");
		setFirstCard(firstJob.id);
		var newOrder = sortable.toArray();
		fabmo.getJobsInQueue(function(err, jobs) {
		for (i = 0; i < newOrder.length; i++) {
			var id = jobs.pending.filter(function(id) {
			return id._id == newOrder[i];
			});
			id[0].order = i + 1;
			fabmo.updateOrder({
			id: id[0]._id,
			order: id[0].order
			}, function(err, result) {});
		}
		});
		$('.cancel').show(500);
		$('.download').show(500);
		$('.edit').show(500);
		$('.preview').show(500);
		$('.play-button').show();
	}
	});


	var current_job_id = 0;

	$(document).ready(function() {
	//Foundation Init
  $(document).foundation();

	fabmo.on('change', function(topic) {

		if (topic === 'jobs') {
		updateQueue();
		updateHistory();
		}
	});


	// Request infoes from the tool
	// The queue will update when the status report comes in
	// But the history needs to be updated manually
	fabmo.requestStatus();
	updateQueue();
	updateHistory();

	setupDropTarget();

	$('#queue_table').on('mousedown', '.job_item:first-child', function(e) {
		$('#queue_table').on('mousedown', '#actions', function(e){
			e.stopPropagation();
		});
		if ($(window).width() > 750 ){
			var left = e.pageX - (145/2);
			var right = $(document).width() - e.pageX - (145/2);
			$(this).css({
				"margin-left":left.toString() + "px",
				"margin-right":right.toString() + "px"
			});

			$(this).on('mouseup', function(e) {
				$(this).css({
					"margin-left":"",
					"margin-right":""
				});
			});
		}
	});

	$('#queue_table').on('touchstart', '.job_item:first-child', function(e) {
		$('#queue_table').on('touchstart', '#actions', function(e){
			e.stopPropagation();
		});
		if ($(window).width() > 750 ){
			var left = e.originalEvent.touches[0].pageX; - (145/2);
			var right = e.originalEvent.touches[0].pageX; - (145/2);
			$(this).css({
				"margin-left":left.toString() + "px",
				"margin-right":right.toString() + "px"
			});

			$(this).on('touchend', function(e) {
				$(this).css({
					"margin-left":"",
					"margin-right":""
				});
			});
		}
	});





	$('#history_page_next').click(function(evt) {
		evt.preventDefault();
		historyNextPage();
	});

	$('#history_page_prev').click(function(evt) {
		evt.preventDefault();
		historyPreviousPage();
	});

	$('.no-jobs-item').click(function(e) {
		$('#job_selector').click();
	});

	$('#queue_table').on('click', '.play-button', function(e) {

	});

	$('#clear-jobs').click(function(e) {
		fabmo.clearJobQueue(function(err, data) {
		updateQueue();
		});
	});

	$('.submit-button').click(function(evt) {
		jQuery('#file').trigger('click');
	});

	$('.without-job').click(function(evt) {
		jQuery('#file').trigger('click');
	});

	$('#file').change(function(evt) {
		fabmo.submitJob($('#fileform'), {}, function(err, data) {
		if (err) {
			fabmo.notify('error', err);
		}
		resetFormElement($('#file'));
		updateQueue();
		$('#nav-pending').click();
		});
	});

	// $( window ).resize(function() {
	// 	setJobheight();
	// }).resize();
	fabmo.on('reconnect', function() {
		updateQueue();
		updateHistory();
	});

	fabmo.on('status', function(status) {
		handleStatusReport(status);
		if (status.job == null && status.state != 'idle') {
		$('.play-button').hide();
		} else if (status.state == 'idle' && el.firstChild) {
		$('.play-button').show();
		}
		// if (status.state == 'running') {
		//     $('.job-status-light.one').css({'animation': 'off 1.5s  infinite', '-moz-animation': 'off 1.5s  infinite', '-webkit-animation': 'off 1.5s  infinite'});
		//     $('.job-status-light.two').css({'animation': 'off 1.5s 0.5s infinite', '-moz-animation': 'off 1.5s 0.5s infinite', '-webkit-animation': 'off 1.5s 0.5s infinite'});
		//     $('.job-status-light.three').css({'animation': 'off 1.5s 1s infinite', '-moz-animation': 'off 1.5s 1s infinite', '-webkit-animation': 'off 1.5s 1s infinite'});
		// } else if ( status.state == 'paused'){
		//     $('.job-status-light').css({'animation': 'pause 1.5s  infinite', '-moz-animation': 'pause 1.5s  infinite', '-webkit-animation': 'pause 1.5s  infinite'});
		// } else {
		//     $('.job-status-light').css({'animation': 'none', '-moz-animation': 'none', '-webkit-animation': 'none'});
		// }
	});

	function resetFormElement(e) {
		e.wrap('<form>').closest('form').get(0).reset();
		e.unwrap();
	}

	//    window.setInterval(function(){
	//    		$('.job-status-light').toggleClass('off');
	// 	}, 1000);

	});
