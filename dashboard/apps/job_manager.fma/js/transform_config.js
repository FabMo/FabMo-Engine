require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

$('body').bind('focusin focus', function(e){
  e.preventDefault();
})
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

        toReturn[i + '-' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }
  return toReturn;
};

function update() {
  fabmo.getVersion(function(err, version) {
    switch(version.type) {
      case 'dev':
        ////## updated display of dev verisons
        $('.engine-version').text(version.number); 
        //$('.engine-version').text(version.hash.substring(0,9) + '-' + version.number);
        break;
      case 'release':
        $('.engine-version').text(version.number);
        break;
    }
  });
  fabmo.getInfo(function(err, info) {
    if(err) {
      console.error(err);
    } else {
      $('.firmware-version').text(info.firmware.version.replace("-dirty","")) 
    }
  });
  fabmo.getConfig(function(err, data) {
    if(err) {
      console.error(err);
    } else {
      configData = data;
      ['driver', 'engine', 'opensbp', 'machine'].forEach(function(branchname) {
          branch = flattenObject(data[branchname]);
          for(key in branch) {
            v = branch[key];
            input = $('#' + branchname + '-' + key);
            if(input.length) {
                if (input.is(':checkbox')){
                  if (v){
                      input.prop( "checked", true );
                  } else {
                      input.prop( "checked", false );
                  }
                } else {
                  input.val(String(v));
                }
            }
          }
      });
      var profiles = data['profiles'] || {}
      var profilesList = $('#profile-listbox');
      profilesList.empty();
      //profilesList.empty();
      if(profiles) {
        for(var name in profiles) {
          profilesList.append(
              $('<option></option>').val(name).html(name)
          );
        }
      } else {
        console.error("No profiles!")
      }
      // Shim
      if(data.engine.profile === 'default') {
        data.engine.profile = 'Default';
      }
      profilesList.val(data.engine.profile);
    }
  });
}

function setConfig(id, value) {
	var parts = id.split("-");
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
	fabmo.setConfig(o, function(err, data) {
    notifyChange(err,id);
    update();
	});
}

var notifyChange = function(err,id){
  if(err){
    $('#'+id).addClass("flash-red");
  }else{
    $('#'+id).addClass("flash-green");
  }
  setTimeout(function(){$('#'+id).removeClass("flash-red flash-green")},500);
};

var configData = null;

$('#btn-backup').click(function(evt) {
    fabmo.getConfig(function(err,conf){
        if(err){
            fabmo.notify('error','cannot backup the config !');
        }else{
            fabmo._download(JSON.stringify(conf), 'fabmo_config_backup.fmc','text/json');
        }
    });
});


$(document).ready(function() {
    $(document).foundation();

    // Setup Unit Labels
    registerUnitLabel('.in_mm_label', 'in', 'mm');
    registerUnitLabel('.ipm_mmpm_label', 'in/min', 'mm/min');
    registerUnitLabel('.ips_mmps_label', 'in/sec', 'mm/sec');
    registerUnitLabel('.inpm2_mmpm2_label', 'in/min<sup>2</sup>', 'mm/min<sup>2</sup>');
    registerUnitLabel('.inrev_mmrev_label', 'in/rev', 'mm/rev');
    registerUnitLabel('.inpm3_mmpm3_label', 'in/min<sup>3</sup>', 'mm/min<sup>3</sup>');

    fabmo.on('status', function(status) {
        updateLabels(status.unit);
    });
    fabmo.requestStatus();

    // Populate Settings
    update();

    ///tool tip logic

$('.tool-tip').click(function(){
     var tip =$(this).parent().data('tip');
     var eTop = $(this).offset().top;
     var eLeft = $(this).offset().left;
     
     var realTop = eTop - 10;
     $('.tip-output').show();
     var eWidth = $('.tip-output').width();
     var realLeft = eLeft - eWidth - 40;
     $('.tip-text').text(tip);
     $('.tip-output').css('top', realTop + 'px');
     $('.tip-output').css('left', realLeft + 'px');
});

$('body').scroll(function(){
    $('.tip-output').hide();
});

$('body').click(function(event){   
       if($(event.target).attr('class') == "tool-tip"){
          return
       } else {
           $('.tip-output').hide();
       }
});
    // Update settings on change
    $('.driver-input').change( function() {
        var parts = this.id.split("-");
        var new_config = {};
        new_config.driver = {};
        var v = parts[1];
        if(v === "gdi") {
            new_config.driver.gdi = this.value;
            if (this.value == 0) { fabmo.runGCode("G90"); }
            else { fabmo.runGCode("G91"); }
            fabmo.setConfig(new_config, function(err, data) {
                notifyChange(err, data.driver.gid);
                setTimeout(update, 500);
            });
        }
        else {
            setConfig(this.id, this.value);
        }
        // How to send G90 or G91 from here?
    });

    $('#engine-version').click(function(evt) {
        evt.preventDefault();
        fabmo.navigate('/updater');
    });

    $('.engine-input').change( function() {
        setConfig(this.id, this.value);
    });

    $("#machine-auth_required").on('change', function() {
        if ($(this).is(':checked')) {
            $(this).attr('value', 'true');
        } else {
            $(this).attr('value', 'false');
        }
    });

    $("#machine-interlock_required").on('change', function() {
        if ($(this).is(':checked')) {
            $(this).attr('value', 'true');
        } else {
            $(this).attr('value', 'false');
        }
    });

    $('.machine-input').change( function() {
        setConfig(this.id, this.value);
    });

    $('.opensbp-input').change( function() {
        setConfig(this.id, this.value);
    });

    $('.opensbp-values').change( function() {
        var parts = this.id.split("-");
        var new_config = {};
        new_config.driver = {};
        var v = parts[1];

        if (!configData) { return; }
        if(v !== undefined) {
            if(v === "units1"){
                new_config.driver['1tr']=(360/configData.driver["1sa"])*configData.driver["1mi"]/this.value;
            }
            else if(v === "units2"){
                new_config.driver['2tr']=(360/configData.driver["2sa"])*configData.driver["2mi"]/this.value;
            }
            else if(v === "units3"){
                new_config.driver['3tr']=(360/configData.driver["3sa"])*configData.driver["3mi"]/this.value;
            }
            else if(v === "units4"){
                new_config.driver['4tr']=(360/configData.driver["4sa"])*configData.driver["4mi"]/this.value;
            }
            else if(v === "units5"){
                new_config.driver['5tr']=(360/configData.driver["5sa"])*configData.driver["5mi"]/this.value;
            }
            else if(v === "units6"){
                new_config.driver['6tr']=(360/configData.driver["6sa"])*configData.driver["6mi"]/this.value;
            }
            fabmo.setConfig(new_config, function(err, data) {
                notifyChange(err,id);
                setTimeout(update, 500);
            });
        }
    });



    // setupUserManager();

    fabmo.on('reconnect', function() {
        update();
    });

    $('#profile-listbox').on('change', function(evt) {
      evt.preventDefault();
      fabmo.showModal({
        title : 'Change Profiles?',
        message : 'Changing your machine profile will reset all of your apps and settings. Are you sure you want to change profiles?',
        okText : 'Yes',
        cancelText : 'No',
        ok : function() {
          fabmo.setConfig({engine : {profile : $("#profile-listbox option:checked").val()}});
        },
        cancel : function() {}
      });
    });

});
