require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Sortable = require('./Sortable.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;
var step;
var testFileSubmitted = "false";
var cameFromTour = false;
var firstRun = true;
var isTestJob = '';
var tourComplete = false;
var numberJobs = 0;
var x = 0;

// Current position in the history browser
var historyStart = 0;
var historyCount = 10;
var historyTotal = 0;
// Timer for the running job indicator
var blinkTimer = null;

// The currently running Job ID
var currentJobId = -1;
var currentStatus = {};

function fileUploadProgress(progress) {
  var pg = (progress * 100).toFixed(0) + '%';
  $('.progressbar .fill').width(pg);
  if (progress === 1) {
    setTimeout(function() {
      $('.progressbar').addClass('hide');
      $('.progressbar .fill').width(0);
    }, 200);
  }
}


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
        if (file.length > 0) {
          var file_size = file[0].size;
          $('.progressbar').removeClass('hide');
          fabmo.on('upload_progress', function(progress) {
            fileUploadProgress(progress.value);
          });
          synchJobSubmit(file);
        }
      } catch (e) {
        console.log(e);
      } finally {
        $('#tabpending').removeClass('hover');
        return false;
      }
    }
  });
}

function synchJobSubmit(files) {
  fabmo.submitJob(files[x], {
    compressed: files[x].size > 2000000 ? true : false
  }, function(err, data) {
    if (err) {
      console.log(err);
      fabmo.notify('error', err);

      return
    } else {
      x++;
      if (x < files.length) {
        synchJobSubmit(files);
      } else {
        updateQueue();
        x = 0;
      }
    }

  });
}

function updateQueue(callback) {
  callback = callback || function() {};
  // Update the queue display.
  fabmo.getJobsInQueue(function(err, jobs) {
    numberJobs = jobs.pending.length;
    var jobElements = document.getElementById("queue_table").childElementCount;
    if (err) {
      return callback(err);
    }

    if (jobs.pending.length === jobElements && jobs.pending.length != 0 && jobs.running.length === 0) {
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

// Returns an img string DOM element for holding the job preview thumbnail.
// function createPreviewThumbnail(job, width, height) {
//   var img = document.createElement("img");
//   img.style.marginRight = "4px";
//   img.width = width;
//   img.height = height;
//   img.alt = "[No possible preview]";
//   img.src = "/job/" + job._id + "/thumbnail";
//   return img.outerHTML;
// }

function search(nameKey, arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i]._id.toString() === nameKey) {
      return true;
    }
  }
}

function addQueueEntries(jobs) {
  var elements = document.getElementsByClassName('job_item'); //All current jobs in DOM
  var table = document.getElementById('queue_table');
  var recent = [];


  for (var j = 0; j < elements.length; j++) { /// If a job is in the DOM and is not pending remove it
    var found = search(elements[j].id, jobs);
    if (found) {

    } else {
      $('#' + elements[j].id).remove();
    }
  }


  if (jobs.length) {
    $('.no-jobs').css('left', '-2000px'); /// Remove no jobs menu
    nextJob();
    for (var i = 0; i < jobs.length; i++) {
      if ($('#' + jobs[i]._id).length < 1) { // If a job already has a card do nothing else make a card for job
        var listItem = document.createElement("div");
        listItem.setAttribute("id", jobs[i]._id);
        listItem.setAttribute("class", "job_item");
        listItem.setAttribute("data-id", jobs[i]._id);
        table.appendChild(listItem);
        var id = document.getElementById(jobs[i]._id);
        id.innerHTML = '<div id="menu"></div><div class="job_name">' + jobs[i].name + '</div><div class="description">' + jobs[i].description + '</div>';
        var menu = id.firstChild;
        menu.innerHTML = createQueueMenu(jobs[i]._id);
      }
    };
    setFirstCard(); //Add play button and css style for first card
    isTestJob = jobs[0];
    bindMenuEvents();
    var newOrder = sortable.toArray(); ///Update order to DB
    for (var i = 0; i < newOrder.length; i++) {
      var id = jobs.filter(function(id) {
        return id._id == newOrder[i];
      });
      id[0].order = i + 1;
      fabmo.updateOrder({
        id: id[0]._id,
        order: id[0].order
      }, function(err, result) {});
    }

  } else {
    clearQueue();
    $('.no-jobs').css('left', '0px');
    fabmo.getJobHistory({
      start: 0,
      count: 0
    }, function(err, jobs) {
      var arr = jobs.data;
      var i = 0;
      for (var a = 0; a < arr.length; a++) {
        if (i === 4) {
          break;
        } else {
          var result = recent.filter(function(e) {
            return e.file_id == arr[a].file_id;
          });
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
        id.innerHTML = '<div id="menu"></div><div id="name">' + recent[i].name + '</div><div class="description">' + recent[i].description + '</div>';
        var menu = id.firstChild;


        menu.innerHTML = createRecentMenu(recent[i]._id);

      };
      bindMenuEvents();

      if (err) {
        return callback(err);
      }
    });
  }
  setStep(tour);
}

function setFirstCard() {
  var firstId = $('.job_item').first().attr('id');
  var el = document.getElementById(firstId);
  var cardActions = document.createElement("div");
  cardActions.setAttribute("id", "actions");
  el.appendChild(cardActions);
  var actions = document.getElementById("actions");
  actions.innerHTML = makeActions();
  $('.cancel').data('id', firstId);
  $('.preview').data('id', firstId);
  $('.download').data('id', firstId);
  $('.edit').data('id', firstId);

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
    var thumbnail = row.insertCell(1);
    thumbnail.style.width = "60px";
    var name = row.insertCell(2);
    var done = row.insertCell(3);
    var time = row.insertCell(4);

    menu.innerHTML = createHistoryMenu(job._id);
    // thumbnail.innerHTML = createPreviewThumbnail(job, 50, 50);
    name.innerHTML = '<div class="job-' + job.state + '">' + job.name + '</div>';
    done.innerHTML = moment(job.finished_at).fromNow();
    time.innerHTML = moment.utc(job.finished_at - job.started_at).format('HH:mm:ss');
  });
  bindMenuEvents();
}

function hideDropDown() {
  $('.dropDownWrapper').hide();
  $('.dropDown').hide();
  $('.commentBox').hide();
}


function bindMenuEvents() {

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
    fabmo.deleteJob(this.dataset.jobid, function(err,data){
      if(err){
        console.log(err);
      } else {
        updateQueue();
        updateHistory();
      }
    });

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
  $('.up-next').css('left', '0px');
};

// Job should be the running job or null
function runningJob(job) {
  if (!job) {
    console.log('no job');
    setProgress(status);
    $('.play').removeClass('active')
    $('body').css('background-color', '#EEEEEE');
    $('.play-button').show();
    sortable.options.disabled = false;
    return
  }

  console.log('job');
  $('.cancel').slideUp(100);
  $('.download').slideUp(100);
  $('.edit').slideUp(100);

  // $('.preview').slideUp(100); // Here if the live viewer button moves
  $('.preview').off('click');
  $('.preview').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('previewer', {
      'job': job._id,
      "isLive": true
    });
    hideDropDown();
  });

  $('body').css('background-color', '#898989');
  $('.topjob').addClass('running');
  $('.up-next').css('left', '-2000px');
  $('.no-jobs').css('left', '-2000px');
  $('.now-running').css('left', '0px');
  $('.play-button').show();
  if (!$('.play').hasClass('active')){
    console.log('adding active');
    $('.play').addClass('active');
  }
  sortable.options.disabled = true;
};

var setProgress = function(status) {
  var prog = ((status.line / status.nb_lines) * 100).toFixed(2);
  if (prog > 100) {
    prog = 100;
  }
  if (isNaN(prog)) {
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

/*
 * ---------
 *  STATUS
 * ---------
 */
function handleStatusReport(status) {
  // Either we're running a job currently or null
  try {
    var jobId = status.job._id || null;
    var jobState = status.state;

  } catch (e) {
    var jobid = null;
  }

  if (jobId && jobState === "running") { // Job is currently running
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
  filter: ".cancel, .preview, .edit, .download, .play, .previewJob, .editJob, .downloadJob, .deleteJob, .ellipses",
  onStart: function(evt) {
    var remove = document.getElementById('actions');
    remove.parentNode.removeChild(remove);
    var ctrl = evt.item;
    ctrl.removeAttribute("style");
  },
  onFilter: function(evt) {
    var item = evt.item,
      ctrl = evt.target;
    var id = ctrl.getAttribute('data-jobid');
    if (Sortable.utils.is(ctrl, ".cancel")) {
      fabmo.deleteJob($('.cancel').data('id'), function(err, data) {
        updateQueue();
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
    } else if (Sortable.utils.is(ctrl, ".ellipses")) {
      var dd = ctrl.parentNode.childNodes[2];
      var cd = ctrl.parentNode.childNodes[1];
      $('.dropDownWrapper').show();
      dd.style.display = 'block';
      cd.style.display = 'block';
    } else if (Sortable.utils.is(ctrl, ".previewJob")) {
      fabmo.launchApp('previewer', {
        'job': id
      });
      hideDropDown();
    } else if (Sortable.utils.is(ctrl, ".editJob")) {
      fabmo.launchApp('editor', {
        'job': id
      });
      hideDropDown();
    } else if (Sortable.utils.is(ctrl, ".downloadJob")) {
      fabmo.navigate('/job/' + id + '/file');
    } else if (Sortable.utils.is(ctrl, ".deleteJob")) {
      fabmo.deleteJob(id);

    }


  },

  onMove: function(evt) {
    var ctrl = evt.dragged;
    ctrl.removeAttribute("style");
  },
  onEnd: function(evt) {
    var firstJob = document.getElementById('queue_table').firstChild;
    var cardActions = document.createElement("div");
    setFirstCard();
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


////TOUR LOGIC //////


function setStep(callback) {
  fabmo.getAppConfig(function(err, data) {
    if (data) {
      callback(data);
    } else {
      console.log('no data')
    }
  });
}


function countStep(step, callback) {
  fabmo.getAppConfig(function(err, data) {
    if (data) {
      if (data.step > -1) {
        data.step = step;
        fabmo.setAppConfig(data, function(err, data) {
          if (err) {
            console.log(err);
          } else {
            callback(step);
          }
        });
      }
    } else {
      console.log('no data')
    }
  });
}

function stepOne(step) {
  if (step === 0) {
    $('.no').hide();
    $('.filter').show();
    $('.tour-dialogue').show();
    $('.tour-text').text('Welcome to the Job Manager. This is where you will manage jobs. Jobs can exist in multiple states. The first we will talk about is a job that is queued.');
    $('.next').click(function() {
      step++;
      countStep(step, stepTwo);
    });
  } else {
    $('.no').hide();
    $('.filter').show();
    $('.tour-dialogue').show();
    stepTwo(step);
  }
}

function stepTwo(step) {
  $('.next').off();
  if (step === 1) {
    $('.tour-text').text('A queued job is a job that is ready to run. If you have a job queued the job manager will tell you so by displaying "Up Next" in the top left of the screen.');
    $('.up-next').css({
      'z-index': 2001,
      'color': '#fff'
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepThree);
    });
  } else if (step > 1) {
    stepThree(step);
  }
}

function stepThree(step) {

  $('.next').off();
  if (step === 2) {
    sortable.options.disabled = true;
    $('.up-next').css({
      'z-index': '',
      'color': ''
    });
    $('.tour-text').text('This card represents the job and allows you to interact with it...');
    $('.job_item:first-child').css({
      'z-index': 2001
    });
    $('#queue_table').unbind();
    $('.tour-dialogue').css({
      'top': '70%'
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepFour);
    });
  } else if (step > 2) {
    sortable.options.disabled = true;
    $('.up-next').css({
      'z-index': 'inherit',
      'color': '#666'
    });
    $('.tour-text').text('This card represents the job and allows you to interact with it...');
    $('.job_item:first-child').css({
      'z-index': 2001
    });
    $('#queue_table').unbind();
    $('.tour-dialogue').css({
      'top': '70%'
    });
    stepFour(step);
  }

}

function stepFour(step) {
  $('.next').off();
  var p = $('.preview').offset();
  if (step === 3) {
    $('.tour-pointer').show();
    $('.tour-pointer').css({
      'top': (p.top - 50),
      'left': p.left
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepFive);
    });
  } else if (step > 3) {
    $('.tour-pointer').show();
    stepFive(step);
  }
}

function stepFive(step) {
  $('.next').off();
  var e = $('.edit').offset();
  if (step === 4) {
    $('.tour-pointer').css({
      'top': (e.top - 50),
      'left': e.left
    });
    $('.tour-pointer span').text('You can edit the job');
    $('.next').click(function() {
      step++;
      countStep(step, stepSix);
    });
  } else if (step > 4) {
    $('.tour-pointer span').text('You can edit the job');
    stepSix(step);
  }
}

function stepSix(step) {
  $('.next').off();
  var d = $('.download').offset();
  if (step === 5) {
    $('.tour-pointer').css({
      'top': (d.top - 50),
      'left': d.left
    });
    $('.tour-pointer span').text('You can download the job');
    $('.next').click(function() {
      step++;
      countStep(step, stepSeven);
    });
  } else if (step > 5) {
    $('.tour-pointer span').text('You can download the job');
    stepSeven(step);
  }
}

function stepSeven(step) {
  $('.next').off();
  var c = $('.cancel').offset();
  if (step === 6) {
    $('.tour-pointer').css({
      'top': (c.top - 50),
      'left': c.left
    });
    $('.tour-pointer span').text('You can cancel the job');
    $('.next').click(function() {
      step++;
      countStep(step, stepEight);
    });
  } else if (step > 6) {
    $('.tour-pointer span').text('You can cancel the job');
    stepEight(step);
  }
}

function stepEight(step) {
  $('.next').off();
  if (step === 7) {
    $('.job_item:first-child').css({
      'z-index': ''
    });
    $('.tour-pointer').hide();
    $('.tour-text').text('Here we can tell the job by name');
    $('.job_name').css({
      'z-index': 2001,
      'color': '#fff'
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepNine);
    });
  } else if (step > 7) {
    $('.job_item:first-child').css({
      'z-index': ''
    });
    $('.tour-pointer').hide();
    $('.tour-text').text('Here we can tell the job by name');
    $('.job_name').css({
      'z-index': 2001,
      'color': '#fff'
    });
    stepNine(step);
  }
}

function stepNine(step) {
  $('.next').off();
  if (step === 8) {
    $('.job_name').css({
      'z-index': '',
      'color': ''
    });
    $('.description').css({
      'z-index': 2001,
      'color': '#fff'
    });
    $('.tour-text').text('and get a short description of the job.');
    $('.next').click(function() {
      step++;
      countStep(step, stepTen);
    });
  } else if (step > 8) {
    $('.job_name').css({
      'z-index': 'inherit',
      'color': 'inherit'
    });
    $('.description').css({
      'z-index': 2001,
      'color': '#fff'
    });
    $('.tour-text').text('and get a short description of the job.');
    stepTen(step);
  }
}

function stepTen(step) {
  $('.next').off();
  if (step === 9) {
    $('.description').css({
      'z-index': '',
      'color': ''
    });
    $('.tour-pointer').hide();
    $('.tour-text').text('Finally we can run a job by clicking the green "play" button. If you are ready go ahead and push it now to run your first job.');
    $('.play-button').css({
      'z-index': 2001
    });
    $('.next').hide();
    runNext();
    var finished = false;
    var firstStatus = 0;
    fabmo.on('status', function(status) {
      if (status.state === "running") {
        $('.tour-text').text('Congrats! You are running your first job.');
        $('.play-button').css({
          'z-index': 2001
        });
        $('.next').hide();
        $('.no').hide();
        finished = true;
      } else if (status.state === "idle" && finished === true && firstStatus === 0) {
        firstStatus++;
        step++;
        countStep(step, stepEleven);
      }
    });
  } else if (step > 9) {
    stepEleven(step);
  }
}

function stepEleven(step) {
  $('.next').off();
  if (step === 10) {
    $('.tour-dialogue').css({
      'width': '',
      'padding': '',
      'top': ''
    });
    $('.tour-text').text('You ran your first Job! Would you like to continue to the tour of the Job Manager or explore on your own?');
    $('.next').show();
    $('.next').text('Continue')
    $('.no').show();
    $('.next').click(function() {
      step++;
      countStep(step, stepTwelve);
      fabmo.clearJobQueue(function(err, data) {});
    })
  } else if (step > 10) {
    $('.tour-dialogue').css({
      'width': '',
      'padding': '',
      'top': ''
    });
    $('.next').show();
    $('.next').text('Continue')
    $('.no').show();
    stepTwelve(step);
  }
}

function stepTwelve(step) {
  $('.next').off();
  if (step === 11) {
    $('.no').hide();
    $('.next').text('Next');
    $('.tour-text').text('Great now lets look what happens to a job after you run it.');
    $('.next').click(function() {
      step++;
      countStep(step, stepThirteen);
    });
  } else if (step > 11) {
    $('.no').hide();
    $('.next').text('Next');
    stepThirteen(step);
  }
}

function stepThirteen(step) {
  $('.next').off();
  if (step === 12) {
    $('.tour-text').text('Bellow you will see text for recent jobs. This will always show the most recent jobs you have run');
    $('.no-job').css({
      'z-index': 2001,
      'color': '#fff',
      'position': 'relative'
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepFourteen);
    });
  } else if (step > 12) {
    $('.no-job').css({
      'z-index': 2001,
      'color': '#fff',
      'position': 'relative'
    });
    stepFourteen(step);
  }

}

function stepFourteen(step) {
  $('.next').off();
  if (step === 13) {
    $('.tour-text').text('This is the job you just ran');
    $('.no-job').css({
      'z-index': 'inherit',
      'color': '#666'
    });
    $('.recent_item:first-child').css({
      'z-index': 2001
    });

    $('.next').click(function() {
      step++;
      countStep(step, stepFifteen);
    });
  } else if (step > 13) {
    $('.tour-text').text('This is the job you just ran');
    $('.no-job').css({
      'z-index': 'inherit',
      'color': '#666'
    });
    $('.recent_item:first-child').css({
      'z-index': 2001
    });
    stepFifteen(step);
  }
}

function stepFifteen(step) {
  $('.next').off();
  if (step === 14) {
    $('.tour-text').text('By clicking the up arrow you can re-run a job. This is useful when you are making a bunch of copies of the same job. (The arrow is disabled until you leave the tour.)');

    $('.next').click(function() {
      step++;
      countStep(step, stepSixteen);
    });
  } else if (step > 14) {
    $('.tour-text').text('By clicking the up arrow you can re-run a job. This is useful when you are making a bunch of copies of the same job. (The arrow is disabled until you leave the tour.)');
    stepSixteen(step);
  }
}

function stepSixteen(step) {
  $('.next').off();
  if (step === 15) {
    $('.recent_item:first-child').css({
      'z-index': ''
    });
    $('.tour-text').text('All jobs will go into your job history. From there you can re-run, edit, permenently delete, or preview all old jobs');
    $('#nav-history').css({
      'z-index': 2001,
      'position': 'relative'
    });
    $('.next').click(function() {
      step++;
      countStep(step, stepSeventeen);
    });
  } else if (step > 15) {
    $('.recent_item:first-child').css({
      'z-index': ''
    });
    $('.tour-text').text('All jobs will go into your job history. From there you can re-run, edit, permenently delete, or preview all old jobs');
    $('#nav-history').css({
      'z-index': 2001,
      'position': 'relative'
    });
    stepSeventeen(step);
  }
}

function stepSeventeen(step) {
  $('.next').off();
  if (step === 16) {
    $('#nav-history').css({
      'z-index': '',
      'position': ''
    });
    $('.tour-text').text('There are two ways to submit a new job, first you can click the "Submit Jobs..." tab and search through your files.');
    $('#nav-submit').css({
      'z-index': 2001,
      'position': 'relative'
    });

    $('.next').click(function() {
      step++;
      countStep(step, stepEighteen);
    });
  } else if (step > 16) {
    $('#nav-history').css({
      'z-index': 'inherit',
      'position': 'inherit'
    });
    $('.tour-text').text('There are two ways to submit a new job, first you can click the "Submit Jobs..." tab and search through your files.');
    $('#nav-submit').css({
      'z-index': 2001,
      'position': 'relative'
    });
    stepEighteen(step);
  }
}

function stepEighteen(step) {
  $('.next').off();
  if (step === 17) {
    $('#nav-submit').css({
      'z-index': 'inherit',
      'position': 'inherit'
    });
    $('.without-job').css({
      'z-index': 2001,
      'position': 'relative'
    });
    $('.tour-dialogue').css({
      'top': '60%'
    });
    $('.tour-text').text('Second if you have your job handy you can just drag and drop it here');

    $('.next').click(function() {
      step++;
      countStep(step, stepNineteen);
    });
  } else if (step > 17) {
    $('#nav-submit').css({
      'z-index': 'inherit',
      'position': 'inherit'
    });
    $('.without-job').css({
      'z-index': 2001,
      'position': 'relative'
    });
    $('.tour-dialogue').css({
      'top': '60%'
    });
    $('.tour-text').text('Second if you have your job handy you can just drag and drop it here');
    stepNineteen(step);
  }
}

function stepNineteen(step) {
  $('.next').off();
  if (step === 18) {
    sortable.options.disabled = false;
    $('.tour-dialogue').css({
      'top': ''
    });
    $('.without-job').css({
      'z-index': 'inherit'
    });
    $('.tour-text').text('Congratulations! Those are the basic functions of the Job Manager. Would you now like help getting your tool on your network?');
    $('.no').show();
    $('.next').text('Yes');
    step++;
    countStep(step, tourDone);
    $('.next').click(function() {
      fabmo.launchApp('network-manager');
      $('.filter').hide();
      $('.tour-dialogue').hide();
    });
  } else if (step > 18) {
    $('.filter').hide();
    $('.tour-dialogue').hide();

  }
}

function tourDone(step) {
  sortable.options.disabled = false;
  tourComplete = true;
  cameFromTour = false;
}

function tour(data) {
  if (data.step > -1) {
    step = data.step;
  } else {
    step = 0;
    data.step = step;
    fabmo.setAppConfig(data, function(err, data) {});
  }


  if (tourComplete === false && cameFromTour === true && numberJobs === 1) {
    $('.no').off();
    $('.no').click(function() {
      $('.filter').hide();
      $('.tour-dialogue').hide();
      sortable.options.disabled = false;
      tourDone();
    });
    stepOne(step);
  }
}

function runNext() {
  $('#queue_table').on('click touchstart', '.play', function(e) {
    if ($('.play').hasClass('active')) {
      fabmo.pause(function(err, data) {});
    } else {
      $('.play').addClass('loading');
      fabmo.runNext(function(err, data) {
        if (err) {
          fabmo.notify(err);
        } else {
        }
      });
    }
  });
}

function findUpTag(el, id) {
  while (el.parentNode) {
    el = el.parentNode;
    if (el.id === id)
      return el;
  }
  return null;
}

//function determining  arguments submitted from other apps
function setup() {
  fabmo.getAppArgs(function(err, args) {
    if ('from_tour' in args) {
      cameFromTour = true;
      tourComplete = false;
    };

  });
}

$(document).ready(function() {
  //Foundation Init

  setup();

  $(document).foundation();


  fabmo.on('job_end',function (cmd) {
    updateQueue();
    updateHistory();
  });

   fabmo.on('job_start',function (cmd, data) {
    updateQueue();
    updateHistory();
  });


  // Request infoes from the tool
  // The queue will update when the status report comes in
  // But the history needs to be updated manually
  fabmo.requestStatus();
  updateQueue();
  updateHistory();

  setupDropTarget();
  runNext();

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
    var file_size = $('#fileform').find('input:file')[0].files[0].size;
    $('.progressbar').removeClass('hide');
    fabmo.on('upload_progress', function(progress) {
      fileUploadProgress(progress.value);
    });
    fabmo.submitJob($('#fileform'), {
      compressed: file_size > 2000000 ? true : false
    }, function(err, data) {
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

  });

  function resetFormElement(e) {
    e.wrap('<form>').closest('form').get(0).reset();
    e.unwrap();
  }



  $('#queue_table').on('touchstart, mousedown', '.job_item:first-child', function(e) {
    var el = e.target;
    var a = findUpTag(el, "actions"); // search <a ...>
    if (a) {
      return
    }
    if ($(window).width() > 750) {
      var left = e.pageX - (145 / 2);
      var right = $(document).width() - e.pageX - (145 / 2);
      $(this).css({
        "margin-left": left.toString() + "px",
        "margin-right": right.toString() + "px"
      });

      $(this).on('touchend, mouseup', function(e) {
        $(this).css({
          "margin-left": "",
          "margin-right": ""
        });
      });
    }
  });


});
