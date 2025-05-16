require('./jquery.dragster.js');
require('jquery');
var setApps = require('./app_manager.js');
var setUsers = require('./user_manager');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

// Having ABC operate differently than XYZ and G2 makes this axis overloaded with special cases
// ... and using ips rather than G2's mps makes it even more complicated; lots of fussing here
// For jerk values, we stick with "per minute" reports as these values don't have intuitive meaning
// ... and it just makes it easier to stay consistent with G2


$('body').bind('focusin focus', function(e){
  e.preventDefault();
})

var axis_modes = {
  a_mode: 0, // For ABC axis mode:   0=disable; 1=degrees; 2=linear; 3=speed/radius(not implemented)
  b_mode: 0,
  c_mode: 0,
};

var unit_label_index = {}
var registerUnitLabel = function(label, in_label, mm_label) {
  var labels = {
    'in' : in_label,
    'mm' : mm_label
  }
  unit_label_index[label] = labels;
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
        // We want the version prefix for cache-busting during development,
        // but don't need to display it as part of the version string
        const VERSION_STRING_START_INDEX = 6;
        $('.engine-version').text(version.number.substring(VERSION_STRING_START_INDEX));
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
      let decimals = '';
      configData = data;
      ['driver', 'engine', 'machine', 'opensbp'].forEach(function(branchname) {
          branch = flattenObject(data[branchname]);
          for(key in branch) {
            v = branch[key];
            // for managing decimal places
            if ( key === 'units') {decimals = v == "mm" ? 100 : 1000};
            // Get ABC axis modes for later use
            if ( key === 'aam') {axis_modes["a_mode"] = v}
            if ( key === 'bam') {axis_modes["b_mode"] = v}
            if ( key === 'cam') {axis_modes["c_mode"] = v}  
            input = $('#' + branchname + '-' + key);
            if(input.length) {
                if (input.is(':checkbox')){
                  if (v){
                      input.prop( "checked", true );
                  } else {
                      input.prop( "checked", false );
                  }
                } else {
                  if ( key != 'jogy_speed' &&  key != 'y_maxjerk' ) {    // ...ugly way to handle, per below
                    input.val(String(v));                                // Most values updated here    
                      
                      if (key.substring(1,3) === 'fr') {                // Handle special case of feedrate values
                          input.val((Math.round(String(v) * 100) / (60 * 100)));
                      }  
                    }
                }  
            }
            // Handle special case of representing jogs in config manager display in units/sec
            if ( key.substring(0,3) === 'jog' && key != 'jogy_speed') {
                input.val((Math.round(String(v) * decimals) / decimals));
            }    
            // Handle special case that some Y axis values are linked to X axis in FabMo
            // ... for Jog speed
            if ( key === 'jogxy_speed' ) {
                $('#' + branchname + '-' + 'jogy_speed').val((Math.round(String(v) * decimals) / decimals));
            }

            if ( key === 'xy_maxjerk' ) {
                $('#' + branchname + '-' + 'y_maxjerk').val(String(v));
            }
          }
        });
      // Update all the labels based on the current unit setting
      var unit = data.machine.units;
      $.each(unit_label_index, function(key, value) {  // handles units for XYZ
          $(key).html(value[unit]);
      });
      for (var key in axis_modes) {                    // handles units for ABC
        if (axis_modes.hasOwnProperty(key)) {
          var axis = key.substring(0,1);
          var mode = axis_modes[key];
          if (mode === 2) { // if linear
            if (unit === "in") {
              $("." + axis + "-axis-unit").html("in/sec");
              $("." + axis + "-axis-jerk-unit").html("in/min<sup>3</sup>");
            } else {
              $("." + axis + "-axis-unit").html("mm/sec");
              $("." + axis + "-axis-jerk-unit").html("mm/min<sup>3</sup>");
            }
          } else {
            $("." + axis + "-axis-unit").html("degs/sec");
            $("." + axis + "-axis-jerk-unit").html("deg/min<sup>3</sup>");
          }
        }
      }
      var profiles = data['profiles'] || {}
      var profilesList = $('#profile-listbox');
      profilesList.empty();
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


// Handle Backups

$('#btn-backup').click(function(evt) {
    fabmo.getConfig(function(err,conf){
        if(err){
            fabmo.notify('error','cannot backup the config !');
        }else{
            fabmo._download(JSON.stringify(conf), 'fabmo_config_backup.fmc','text/json');
        }
    });
});

$('#btn-restore').click(function(evt) {
    $('#restore_conf_file').trigger('click');
});

$("#restore_conf_file").change(function() {
    var files = $(this).prop('files');
    if(files.length===1){
        var conf_file = files[0];
        if(!conf_file)return;
        if(conf_file.name.split('.').pop()!=='fmc'){
            fabmo.notify('error','the file you submitted is not valid');
            $("#restore_conf_file").attr("value", "");
            return;
        }
        var reader = new FileReader();
        reader.readAsText(conf_file);
        reader.onload = function(evt)
        {
            try{
                conf = JSON.parse(evt.target.result);
            }catch(ex){
            fabmo.notify("error","Error reading file : "+ex);
            $("#restore_conf_file").attr("value", "");
            return;
            }
            fabmo.setConfig(conf,function(err){
                if(err){
                    fabmo.notify("error",err);
                    $("#restore_conf_file").attr("value", "");
                    return;
                }
                fabmo.notify("success","the configuration file have been successfully loaded !");
                $("#restore_conf_file").attr("value", "");
            });
        }
        reader.onerror = function (evt) {
            fabmo.notify("error","Error reading file");
            $("#restore_conf_file").attr("value", "");
        }
    }
});

// Backup Macros
$('#btn-macros-backup').click(function () {
  fetch('/macros/backup', {
      method: 'GET',
  })
    .then((response) => {
        if (!response.ok) {
            throw new Error('Failed to backup macros');
        }
        return response.blob(); // Get the response as a binary Blob
    })
    .then((blob) => {
        // Create a download link for the Blob
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'fabmo_macros_backup.zip'; // Set the file name
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url); // Clean up the URL
        fabmo.notify('success', 'Macros backup completed successfully!');
    })
  .catch((err) => {
      fabmo.notify('error', 'Failed to backup macros: ' + err.message);
  });
});


// Restore Macros
$('#btn-macros-restore').click(function () {
    $('#restore_macros_dir').trigger('click');
});

$('#restore_macros_dir').change(function() {
  const files = $(this).prop('files');
  if (files.length === 1) {
    const macroFile = files[0];
    fabmo.notify('info', 'Uploading and restoring macros...');
    const formData = new FormData();
    formData.append('file', macroFile);
    
    $.ajax({
      url: '/macros/restore',
      type: 'POST',
      data: formData,
      processData: false,
      contentType: false,
      timeout: 120000, // 2-minute timeout
      success: function(response) {
        fabmo.notify('success', 'Macros restored successfully!');
      },
      error: function(xhr, status, error) {
        console.error('Upload error:', xhr.responseText);
        let errorMessage = 'Failed to restore macros';
        
        try {
          const errorObj = JSON.parse(xhr.responseText);
          if (errorObj && errorObj.message) {
            errorMessage += ': ' + errorObj.message;
          }
        } catch (e) {
          errorMessage += ': ' + error;
        }
        fabmo.notify('error', errorMessage);
      },
      complete: function() {
        // Reset the file input
        $('#restore_macros_dir').val('');
        location.reload(); // Uncomment this line to refresh the page
      }
    });
  }
});

// Other Config page functions

$('#btn-flash-firm').click(function() {
    $('#firmware-input').trigger('click');
  });

$('#btn-update').click(function(){
  fabmo.navigate('/updater');  // for the moment, let's just go to updater to check for updates
  //  $('#update-input').trigger('click');
});

$('#update-input').change(function(evt) {
    var files = [];
    for(var i=0; i<evt.target.files.length; i++) {
      files.push({file:evt.target.files[i]});
    }
    fabmo.submitUpdate(files, {}, function(err, data) {
        if(err){
            console.log(err)
        }else {
            console.log(data);
        }
      
    }, function(progress) {
      console.log(progress);
    });
  });

// Upload a package file manually
$('#firmware-input').change(function(evt) {
  var files = [];
  for(var i=0; i<evt.target.files.length; i++) {
    files.push({file:evt.target.files[i]});
  }
  fabmo.submitFirmwareUpdate(files, {}, function(err, data) {
      if(err){
          console.log(err)
      }else {
          console.log(data);
      }
    
  }, function(progress) {
    console.log(progress);
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
      update();
    });
    
    // Trigger a status update to get the ball rolling
    fabmo.requestStatus();

    // Populate Settings
    update();

    // tool tip logic
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

        // Handle getting the driver input value from seconds to min before saving to g2.config
        } else if(v === "xfr" || v === "yfr" || v === "zfr" || v === "afr" || v === "bfr" || v === "cfr") {
            new_config.driver[v] = this.value * 60;
            setConfig(this.id,  new_config.driver[v]);
        
        // Fix up the symbol and label for ABC axis mode
        } else if (v === "aam" || v === "bam" || v === "cam") {
            console.log ("Got a new Axis Mode - " + (v) + " - " + this.value); 
            setConfig(this.id, this.value);
            update();

         // General "driver-input" updates  
         } else {
            setConfig(this.id, this.value);
         }

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

    $('.opensbp-input').change( function() {  // speccial case for XY jerk and jog speed
        setConfig(this.id, this.value);
        if (this.id === "opensbp-xy_maxjerk") {
            setConfig("opensbp-y_maxjerk", this.value);
        }
        if (this.id === "opensbp-jogxy_speed") {
            setConfig("opensbp-jogy_speed", this.value);
        }
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

    setApps(fabmo);
    setUsers(fabmo);
});
