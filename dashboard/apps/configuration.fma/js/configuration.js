var unit_label_index = {}

var registerUnitLabel = function(label, in_label, mm_label) {
  var labels = {
    'in' : in_label,
    'mm' : mm_label
  }
  unit_label_index[label] = labels;
}

var updateLabels = function(unit) {
	$.each(unit_label_index, function(key, value) {
		$(key).html(value[unit]);
	});
}

var flattenObject = function(ob) {
  var toReturn = {};
  for (var i in ob) {
    if (!ob.hasOwnProperty(i)) continue;

    if ((typeof ob[i]) == 'object') {
      var flatObject = flattenObject(ob[i]);
      for (var x in flatObject) {
        if (!flatObject.hasOwnProperty(x)) continue;
    
        toReturn[i + '_' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }
  return toReturn;
};

function update() {
    fabmoDashboard.getConfig(function(err, data) {
      if(err) {
        console.error(err);
      } else {
        ['driver', 'engine', 'opensbp', 'machine'].forEach(function(branchname) {
            if(branchname === 'machine') {
              branch = flattenObject(data[branchname]);
            } else {
              branch = data[branchname];
            }
            for(key in branch) {
              v = branch[key];
              input = $('#' + branchname + '_' + key);
              if(input.length) {
                input.val(String(v));
              }
            }
        });
      }
    });
}

function setConfig(id, value) {
    var parts = id.split("_");
    var type = parts[0];
    var key = parts[1];
    // Workaround for (restify bug?)
    if(key[0].match(/[0-9]/)) {
      key = '_' + key;
    }
    var o = {};
    o[key] = value;
    cfg = {};
    cfg[type] = o;
    fabmoDashboard.setConfig(cfg, function(err, data) {
      update();
    });
}

function setConfig(id, value) {
	var parts = id.split("_");
	var o = {};
	var co = o;
	var i=0;

	do {
	  co[parts[i]] = {};
	  if(i < parts.length-1) {
	    co = co[parts[i]];            
	  }
	} while(i++ < parts.length-1 );

	co[parts[parts.length-1]] = value;
	fabmoDashboard.setConfig(o, function(err, data) {
	  update();
	});
}