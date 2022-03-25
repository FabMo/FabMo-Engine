
var fabmo = new FabMoDashboard()
var TOOLS = [1,2,3,4,5,6,7,8,9,10];

var okButtonHandler = null;
var cancelButtonHandler = null;
var textEnterHandler = null;

function goToolList() {
	showScreen('screen-tools');
}

function goHome() {
	showScreen('screen-home');
}

function pickupTool(num) {
	console.info("Picking up tool " + num);
	fabmo.runSBP('&Tool=' + num + '\nC9\n');
}

function doStoreTool() {
	console.info("Storing the current tool");
	fabmo.runSBP('&Tool=0\nC9\n');
}

function doVac() {
	console.info("Vacuuming the table");
	fabmo.runSBP('C104\n');
}

function doPark() {
	console.info("Parking the tool");
	fabmo.runSBP('C105\n');
}

function doCalibrate() {
	//fabmo.showDRO(function() { console.log("done")});
	doModal({
		title : 'Calibrate ATC',
		text : 'Install an empty tool holder <em>upside down</em> in the first tool slot, and using the manual drive function of the tool, position the spindle (with an empty tool cup installed) above the first tool holder.',
		image : 'images/calibrate1.jpg'
	}).then(function resolve() {
		fabmo.runSBP('C101\n');
	}, function reject() {
		console.error("Rejected calibration modal.");
	});
}

function doHome() {
	fabmo.runSBP('C3\n');
}

function doZZero() {
	fabmo.runSBP('C2\n');
}

function doMeasureTool() {
	fabmo.runSBP('C102\n');
}

function updateName(i, currentName) {
		doModal({
		title : 'Tool Name',
		text : '<b>Enter a new name for tool ' + i + ':</b>',
		image : 'images/nametag.png',
		defaultText : currentName,
		onText : function changeToolName(txt) {
			var cfg = {opensbp:{variables:{}}};
			cfg.opensbp.variables['Tool' + i + 'Name'] = txt
			fabmo.setConfig(cfg, function() {
				updateToolTable();
			});
		}
	}).then(function resolve() {
		console.info("Done")
	}, function reject() {
		console.error("Rejected tool name change modal.");
	});
}


function initToolTable() {
	var toolTable = document.getElementById('table-tools');
	toolTable.innerHTML = '';
	TOOLS.forEach(function(i) {

		var tool = document.createElement('tr');
		tool.id = 'tool-' + i + '-row';
		// Tool ID
		var numCell = document.createElement('th');
		numCell.innerHTML = '' + i;
		tool.appendChild(numCell);

		// X Location
		var name = document.createElement('td');
		name.id = 'tool' + i + '-name';
		name.innerHTML = '';
		name.className = "clickable"
		tool.appendChild(name);

		// X Location
		var x = document.createElement('td');
		x.id = 'tool' + i + '-x';
		x.innerHTML = '';
		x.className = "is-hidden-touch"
		tool.appendChild(x);

		// Y Location
		var y = document.createElement('td');
		y.id = 'tool' + i + '-y';
		y.innerHTML = '';
		y.className = "is-hidden-touch"

		tool.appendChild(y);

		// Tool length (distance to prox)
		var length = document.createElement('td');
		length.id = 'tool' + i + '-length';
		length.innerHTML = '';
		length.className = "is-hidden-touch"
		tool.appendChild(length);

		// Button for tool pickup
		var controls = document.createElement('td');
		controls.style = "width: 1%"
		controls.innerHTML = '<a id="pickup-' + i + '-button" class="button noselect btn-pickup"></a>';
		var pickup = function(evt) {
			switch(evt.target.textContent) {
				case 'Pick Up':
					pickupTool(i);
					break;
				case 'Put Away':
					doStoreTool();
					break;
			}
		}
		controls.firstElementChild.addEventListener('click',pickup);

		tool.appendChild(controls);
		toolTable.appendChild(tool);
	});

	document.getElementById('btn-back-tools').addEventListener('click', function(evt) {
		goHome();
	});

	document.getElementById('btn-measure-tool').addEventListener('click', function(evt) {
		doMeasureTool();
	});
/*
	document.getElementById('btn-store-tool').addEventListener('click', function(evt) {
		doStoreTool();
	});
*/
}

function updateToolTable() {
	fabmo.getConfig(function(err, config) {
		if(err) { 
			log.error("Problem getting config: " + err)
		}
		var vars = config.opensbp.variables || {};
		document.getElementById('span-current-tool').textContent = (vars['CurrentTool'] || 0) === 0 ? "None" : ('Tool ' + vars['CurrentTool']);		
		TOOLS.forEach(function(i) {
			var row = document.getElementById('tool-' + i + '-row');
			var button = document.getElementById('pickup-' + i + '-button')

			if(vars['CurrentTool'] == i) {
				row.className = 'is-selected';
				button.textContent = 'Put Away';
			} else {
				row.className = '';
				button.textContent = 'Pick Up';
			}

			var name = document.getElementById('tool' + i + '-name');
			name.innerHTML = (vars['Tool' + i + 'Name'] || ("Tool " + i));
			name.addEventListener('click', function(evt) {
				updateName(i, name.innerHTML);
			});

			var x = document.getElementById('tool' + i + '-x');
			x.innerHTML = (vars['Tool' + i + 'X'] || 0).toFixed(3);

			var y = document.getElementById('tool' + i + '-y');
			y.innerHTML = (vars['Tool' + i + 'Y'] || 0).toFixed(3);

			var length = document.getElementById('tool' + i + '-length');
			length.innerHTML = (vars['Tool' + i + 'Length'] || 0).toFixed(3);

		});
		switch(vars['CurrentTool']) {
			case 0:
				document.getElementById('btn-measure-tool').style.display = 'none';
				break;
			default:
				document.getElementById('btn-measure-tool').style.display = 'flex';
				break;			
		}
	});
}

function initMenu() {
	document.getElementById('menu-tools').addEventListener('click', function(evt) {
		goToolList();
	});

	document.getElementById('menu-calibrate').addEventListener('click', function(evt) {
		doCalibrate();
	});

	document.getElementById('menu-home').addEventListener('click', function(evt) {
		doHome();
	});
	document.getElementById('menu-vac').addEventListener('click', function(evt) {
		doVac();
	});
	document.getElementById('menu-zzero').addEventListener('click', function(evt) {
		doZZero();
	});

	document.getElementById('menu-park').addEventListener('click', function(evt) {
		doPark();
	});

/*
	document.getElementById('menu-zzero').addEventListener('click', function(evt) {
		doZZero();
	});
*/
}
function init(options) {
	options = options || {};

	initToolTable();
	updateToolTable();
	initMenu();
	showScreen('screen-home');

	fabmo.on('status', function(status) {
		if(status['state'] == 'idle') {
			updateToolTable();
		}
	})
}

document.addEventListener('DOMContentLoaded', function () {

  // Get all "navbar-burger" elements
  var $navbarBurgers = Array.prototype.slice.call(document.querySelectorAll('.navbar-burger'), 0);

  // Check if there are any navbar burgers
  if ($navbarBurgers.length > 0) {

    // Add a click event on each of them
    $navbarBurgers.forEach(function ($el) {
      $el.addEventListener('click', function () {

        // Get the target from the "data-target" attribute
        var target = $el.dataset.target;
        var $target = document.getElementById(target);

        // Toggle the class on both the "navbar-burger" and the "navbar-menu"
        $el.classList.toggle('is-active');
        $target.classList.toggle('is-active');

      });
    });
  }

});
