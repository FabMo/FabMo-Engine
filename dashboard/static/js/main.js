/*
 * main.js is the entry point for the application.
 */
define(function(require) {

	// context is the application context
	// dashboard is the bridge between the application context and the apps
	var context = require('context');
	var dashboard = require('dashboard');

	// Vendor libraries
	var $ = require('jquery');
	var Backbone = require('backbone');
	var underscore = require('underscore');

	// Our libraries
	var FabMoAPI = require('fabmo');
	var FabMoUI = require('fabmo-ui');
	
	var Keyboard = require('keyboard');
	var Keypad = require('keypad');

	var keypad, keyboard;
	
	// API object defines our connection to the tool.
	var engine = new FabMoAPI();

	var modalIsShown = false;
	var daisyIsShown = false;
	var authorizeDialog = false;
	// Detect touch screen
	
	var supportsTouch = 'ontouchstart' in window || navigator.msMaxTouchPoints;
    
    //Give editor focus 
    
    $('#icon_editor').on('click', function(){
        $('iframe').focus();

    });
	// Initial read of engine configuration
	engine.getConfig();
	engine.getVersion(function(err, version) {
		context.setEngineVersion(version);

		context.apps = new context.models.Apps();
		// Load the apps from the server
		context.apps.fetch({
			success: function() {
				// Create the menu based on the apps thus retrieved 
				context.appMenuView = new context.views.AppMenuView({collection : context.apps, el : '#app_menu_container'});

				// Create a FabMo object for the dashboard
				dashboard.setEngine(engine);
				dashboard.ui=new FabMoUI(dashboard.engine);

				keyboard = setupKeyboard();
				keypad = setupKeypad();

				// Start the application
				router = new context.Router();
				router.setContext(context);

				// Sort of a hack, but works OK.
				$('#spinner').hide();

				// Start backbone routing
				Backbone.history.start();
				
				// Request a status update from the tool
				engine.getStatus();

				dashboard.engine.on('change', function(topic) {
					if(topic === 'apps') {
						context.apps.fetch();
					}
				});
			}
		});
	});


function getManualMoveSpeed(move) {
	var speed_ips = null;
	try {
		switch(move.axis) {
			case 'x':
			case 'y':
				speed_ips = engine.config.machine.manual.xy_speed;
				break;
			case 'z':
				speed_ips = engine.config.machine.manual.z_speed;
				break; 
		}
	} catch(e) {
		console.error(e);
	}
	return speed_ips;
}

function getManualNudgeIncrement(move) {
	var increment_inches = null;
	try {
		switch(move.axis) {
			case 'x':
			case 'y':
				increment_inches = engine.config.machine.manual.xy_increment;
				break;
			case 'z':
				increment_inches = engine.config.machine.manual.z_increment;
				break; 
		}
	} catch(e) {
		console.error(e);
	}
	return increment_inches;
}

function setupKeyboard() {
	var keyboard = new Keyboard('#keyboard');
	keyboard.on('go', function(move) {
		if(move) {
			dashboard.engine.manualStart(move.axis, move.dir*60.0*(getManualMoveSpeed(move) || 0.1));
		} 
	});

	keyboard.on('stop', function(evt) {
		dashboard.engine.manualStop();
	});

	keyboard.on('nudge', function(nudge) {
		dashboard.engine.manualMoveFixed(nudge.axis, 60*getManualMoveSpeed(nudge), nudge.dir*getManualNudgeIncrement(nudge))
	});

	return keyboard;
}

function setupKeypad() {

	var keypad = new Keypad('#keypad');
	keypad.on('go', function(move) {
		if(move) {
			dashboard.engine.manualStart(move.axis, move.dir*60.0*(getManualMoveSpeed(move) || 0.1));
		} 
	});

	keypad.on('stop', function(evt) {
		dashboard.engine.manualStop();
	});

	keypad.on('nudge', function(nudge) {
		dashboard.engine.manualMoveFixed(nudge.axis, 60*getManualMoveSpeed(nudge), nudge.dir*getManualNudgeIncrement(nudge))
	});
	return keypad;
}

function showDaisy(callback) {
	if(daisyIsShown) {
		return;
	}
	hideModal(function() {
		daisyIsShown = true;
		$('#disconnectDialog').foundation('reveal', 'open');
	});

}

function hideDaisy(callback) {
	var callback = callback || function() {};
	if(!daisyIsShown) { return callback(); }
	daisyIsShown = false;
	$(document).one('closed.fndtn.reveal', '[data-reveal]', function () {
 		var modal = $(this);
 		if(modal.attr('id') === 'disconnectDialog') {
 			callback();
 		}
	});
	$('#disconnectDialog').foundation('reveal', 'close');	
}

function showModal(options) {

	hideDaisy(function() {

	var modalAlreadyUp = modalIsShown;

	modalIsShown = true;

	if(options['title']) {
		$('#modalDialogTitle').html(options.title).show();		
	} else {		
		$('#modalDialogTitle').hide();
	}

	if(options['lead']) {
		$('#modalDialogLead').html(options.lead).show();		
	} else {		
		$('#modalDialogLead').hide();
	}

	if(options['message']) {
		$('#modalDialogMessage').html(options.message).show();		
	} else {		
		$('#modalDialogMessage').hide();
	}

	if(options['detail']) {
		$('#modalDialogDetail').html(options.detail).show();		
	} else {		
		$('#modalDialogDetail').hide();
	}

	$('#modalDialogButtons').hide();
	if(options['okText']) {
		$('#modalDialogButtons').show();
		$('#modalDialogOKButton').text(options.okText).show().one('click', function() {
			$('#modalDialogCancelButton').off('click');
			(options['ok'] || function() {})();
		});
	} else {
		$('#modalDialogOKButton').hide();
	}

	if(options['cancelText']) {
		$('#modalDialogButtons').show();
		$('#modalDialogCancelButton').text(options.cancelText).show().one('click', function() {
			$('#modalDialogOKButton').off('click');
			(options['cancel'] || function() {})();
		});
	} else {
		$('#modalDialogClose').hide();
		$('#modalDialogCancelButton').hide();
	}

	if(options['cancel']) {
		$('#modalDialogClose').show().one('click', function() {
			options.cancel();
		});
	} else {
		$('#modalDialogClose').hide();
	}

	if(!modalAlreadyUp) {
		var modalTry = function() {
			try {
				$('#modalDialog').foundation('reveal', 'open');				
			} catch(e) {
				console.log("fail")
				setTimeout(modalTry, 10);
			}
		}
		modalTry();
	}
});
}

function hideModal(callback) {
	console.log('hide')
	var callback = callback || function() {};
	if(!modalIsShown) { callback(); }
	modalIsShown = false;
	$(document).one('closed.fndtn.reveal', '[data-reveal]', function () {
 		var modal = $(this);
 		if(modal.attr('id') === 'modalDialog') {
 			callback();
 		}
	});
	$('#modalDialog').foundation('reveal', 'close');	
}

// listen for escape key press to quit the engine
$(document).on('keyup', function(e) {
    if(e.keyCode == 27) {
        console.warn("ESC key pressed - quitting engine.");
        dashboard.engine.quit();
    }
});

//goto this location 

var axisValues = [];
$('.axi').each( function(){
    var strings = this.getAttribute('class').split(" ")[0];
    var axis = strings.slice(-1).toUpperCase();
    axisValues.push({"className" : ("."+strings), "axis": axis});
});

$('.go-here').on('mousedown', function () {
    var gcode = "G0 ";
    for (var i = 0; i<axisValues.length; i++) {
        if ($(axisValues[i].className).attr('value','')[1].value.length > 0){
            if ($(axisValues[i].className).attr('value','')[1].value != $(axisValues[i].className).val()) {
                gcode += axisValues[i].axis + $(axisValues[i].className).attr('value','')[1].value + " ";
            }
        }
    }
    dashboard.engine.gcode(gcode);
    $('.go-here').hide();
    
});
    
$('.axi').on('click', function(e) { 
    e.stopPropagation();
    $('.go-here').show();
});

$('.axi').on('focus', function(e) { 
    e.stopPropagation();
    $(this).val(parseFloat($(this).val().toString()));
    $(this).select();
});
$(document).on('click', function() { 
    $('.posx').val($('.posx').val());
    $('.posy').val($('.posy').val());
    $('.posz').val($('.posz').val());
    $('.go-here').hide();
});

$('.axi').keyup(function(e){
    if(e.keyCode == 13){
        var gcode = "G0 ";
        for (var i = 0; i<axisValues.length; i++) {
            if ($(axisValues[i].className).attr('value','')[1].value.length > 0){
                if ($(axisValues[i].className).attr('value','')[1].value != $(axisValues[i].className).val()) {
                    gcode += axisValues[i].axis + $(axisValues[i].className).attr('value','')[1].value + " ";
                }
            }
        }
		dashboard.engine.gcode(gcode);
		$('.go-here').hide();    
    }
});

// Handlers for the home/probe buttons
$('.button-zerox').click(function(e) {dashboard.engine.sbp('ZX'); });  
$('.button-zeroy').click(function(e) {dashboard.engine.sbp('ZY'); });  
$('.button-zeroz').click(function(e) {dashboard.engine.sbp('ZZ'); });
$('.button-zeroa').click(function(e) {dashboard.engine.sbp('ZA'); });
$('.button-zerob').click(function(e) {dashboard.engine.sbp('ZB'); });

$('.play').on('click', function(e){
	$("#main").addClass("offcanvas-overlap-left");
    console.log('is this still a thing?')
	dashboard.engine.job_run(function (){
		dashboard.engine.getJobQueue(function (err, data){
			if (data.name == 'undefined' || data.length === 0) {
				$('.nextJob').text('No Job Pending');
				$('.play').hide();
				$('.gotoJobManager').show();
				$('.nextJob').css('top', '2px');
				$('.startnextLabel').css('top', '2px');
			} else {
				$('.nextJob').text(data[0].name);
			}
		});
	});
});



var disconnected = false;

engine.on('disconnect', function() {
	if(!disconnected) {
		disconnected = true;
		setConnectionStrength(null);
		showDaisy();
	}
});

engine.on('connect', function() {
	if(disconnected) {
		disconnected = false;
		setConnectionStrength(5);
//		hideDaisy();
	}
});

engine.on('status', function(status) {
	switch(status.state) {
		case 'running':
		case 'paused':
		case 'stopped':
			console.log("openin dat footer");
			dashboard.handlers.showFooter();
			break;
		default:
			console.log("Closin dat footer");
            dashboard.handlers.hideFooter();
			break;
	}

  if (status.state != 'idle'){
        $('#position input').attr('disabled', true);
    } else {
        $('#position input').attr('disabled', false);
    }

/*
    if(status.auth && authorizeDialog) {
    	hideModal();
    }
*/
    if(status['info']) {
		if(status.info['message']) {
			showModal({
				title : 'Message',
				lead : status.info.message,
				okText : 'Continue',
				cancelText : 'Quit',
				ok : function() {
					dashboard.engine.resume();
				},
				cancel : function() {
					dashboard.engine.quit();
				}
 			});
		} else if(status.info['error']) {
			if(dashboard.engine.status.job) {
				var detailHTML = '<p>' + 
					  '<b>Job Name:  </b>' + dashboard.engine.status.job.name + '<br />' + 
					  '<b>Job Description:  </b>' + dashboard.engine.status.job.description + 
					'</p>'
			} else {
				var detailHTML = '<p>Check the <a style="text-decoration: underline;" href="/log">debug log</a> for more information.</p>';
			}

			showModal({
				title : 'Message',
				lead : '<div style="color:#91331E; font-weight: bolder;">An Error Has Occurred!</div>',
				message: status.info.error,
				detail : detailHTML,
				cancelText : status.state === 'dead' ? undefined : 'Quit',
				cancel : status.state === 'dead' ? undefined : function() {
					dashboard.engine.quit();
				}
			});
		} else {
			hideModal();
		}
	} else if(status.state == 'armed') {
		authorizeDialog = true;
		showModal({
			title : 'Authorization Required!',
			lead : '<div style="color:#7F5323; font-weight: bolder;">Press Green Button to Continue</div>',
			message: 'To authorize your tool, press and hold the green button for one second.',
			cancelText : 'Quit',
			cancel : function() {
				authorizeDialog=false;
				dashboard.engine.quit();
			}
		});
	} else {
		hideModal();
	}
});

function setConnectionStrength(level) {
	var onclass = 'on';
	if(level === null) {
		level = 4;
		onclass = 'err';
	}
	for(i=1; i<5; i++) {
		 var bar = $('#cs' + i);
		 if(i<=level) {
		 	bar.attr('class', onclass);
		 } else {
		 	bar.attr('class', 'off');
		 }
	}
}

var signal_window = [];
var err_count = 0;

function ping() {
	engine.ping(function(err, time) {
		// 5-point Moving average
		signal_window.push(time);
		if(signal_window.length > 5) {
			signal_window.shift(0);
		}
		var sum = 0;
		for(var i=0; i<signal_window.length; i++) {
			sum += signal_window[i];
		}
		var avg = sum/signal_window.length;
		
		if(err) {
			console.error(err);
		} else {
			if(avg < 100) {setConnectionStrength(4);}
			else if(avg < 200) { setConnectionStrength(3);}
			else if(avg < 400) { setConnectionStrength(2);}
			else if(avg < 800) { setConnectionStrength(1);}
			else { setConnectionStrength(0);}
		}
		setTimeout(ping, 2000);
	});
};

ping();

(function () {
if ($(window).width() < 620) {
    function start_marquee() {
        function go() {
            i = i < width ? i + step : 1;
            m.style.marginLeft = -i + 'px';
        }
        var i = 0,
            step = 3,
            space = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        var m = document.getElementById('marquee');
        var t = m.innerHTML; 
        m.innerHTML = t + space;
        m.style.position = 'absolute'; 
        var width = (m.clientWidth + 1);
        m.style.position = '';
        m.innerHTML = t + space + t + space + t + space + t + space + t + space + t + space + t + space;
        if (m.addEventListener) {
            m.addEventListener('mouseenter', function () {
                step = 0;
            }, false);
            m.addEventListener('mouseleave', function () {
                step = 3;
            }, false);
        }
        var x = setInterval(go, 50);
    }
    if (window.addEventListener) {
        window.addEventListener('load', start_marquee, false);
    } else if (window.attachEvent) { //IE7-8
        window.attachEvent('onload', start_marquee);
    }
	
	$('.currentContainer').css('width', '100px');
	$('.currentJobTitle').css('width', '50%');
	$('.currentJobTitle').css('padding-left', '100px');
}
})();
$.post('/time', {
	'utc' : new Date().toUTCString()
});
function touchScreen () {
	if (supportsTouch && window.innerWidth < 800) {
		$('#app-client-container').css({'-webkit-overflow-scrolling':'touch','overflow-y':'scroll'});
	} 
}
touchScreen();

// $('.dro-button').click(function() {
// 	$('.dro-button').removeClass('active');
// 	$(this).addClass('active')
// 	$('.dro-view').hide();
// 	$('#' + this.dataset.view).show();
// });

});






