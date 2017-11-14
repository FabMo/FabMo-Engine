require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

var networks = {};
var network_history = {};

// Get networks from the tool, and add entries to the table
function refreshWifiTable(callback){
	callback = callback || function() {};
	fabmo.getWifiNetworks(function(err, networks) {
		if(err) {return callback(err);}
		addWifiEntries(networks);
		callback(null, networks);
	});
}

// Add wifi entries (retrieved from the tool) to the HTML table in the UI
function addWifiEntries(network_entries, callback) {
	callback = callback || function() {};
	var table = document.getElementById('wifi_table');
	network_entries.forEach(function(entry) {""
        if(entry.ssid in networks) {
            return;
        }
        networks[entry.ssid] = entry;
		var row = table.insertRow(table.rows.length);
		var ssid = row.insertCell(0);
        ssid.className = 'ssid noselect'
		var security = row.insertCell(1);
		security.className = 'security noselect'
        var strength = row.insertCell(2);
        strength.className = 'wifi0';

    var ssidText = entry.ssid || '<Hidden SSID>';
	var securityText = entry.flags ? entry.flags : '';
    var rawStrength = entry.signalLevel;
    var strengthNumber;
    if(rawStrength > -65) {
        strengthNumber = 4;
    } else if(-70 < rawStrength < -65) {
        strengthNumber = 3;
    } else if(-80 < rawStrength < -70) {
        strengthNumber = 2;
    } else if(-90 < rawStrength < -80) {
        strengthNumber =  1;
    } else {
        strengthNumber =  0;
    }
	ssid.innerHTML = ssidText;
	security.innerHTML = securityText;
	strength.className = 'wifi'+(strengthNumber);
   });
}

// Get history from the tool, and add entries to the table
function refreshHistoryTable(callback){
    callback = callback || function() {};
    fabmo.getWifiNetworkHistory(function(err, networks) {
        if(err) {return callback(err);}
        if(Object.keys(networks).length > 0) {	
            addHistoryEntries(networks);            
            $('#recent').removeClass('hidden');
        } else {
            $('#recent').addClass('hidden');
        }
        callback(null, networks);
    });
}

// Add history entries (retrieved from the tool) to the HTML table in the UI
function addHistoryEntries(history_entries, callback) {
    callback = callback || function() {};
    var table = document.getElementById('history_table');
    for(ssid in history_entries) {
        entry = history_entries[ssid];
        if(entry.ssid in network_history) {
            return;
        }
        network_history[entry.ssid] = entry;
        var row = table.insertRow(table.rows.length);
        var ssid = row.insertCell(0);
        ssid.className = 'ssid noselect'
        var ipaddress = row.insertCell(1);
        ipaddress.className = 'ipaddress noselect'
        var lastseen = row.insertCell(2);
        //lastseen.className = '';

        var ssidText = entry.ssid || '<Hidden SSID>';
        var ipAddressText = entry.ipaddress || '';
        var lastSeenText = moment(entry.lastseen).fromNow();

        ssid.innerHTML = ssidText
        ipaddress.innerHTML = ipAddressText;
        lastseen.innerHTML = lastSeenText;
    };
}
// Show the confirmation dialog
function confirm(options){
    options.ok = options.ok || function() {};
    options.cancel = options.cancel || function() {};

    $('#confirm-modal-title').text(options.title || '');
    $('#confirm-modal-description').text(options.description || '');

    $('#confirm-modal-ok').text(options.ok_message || 'Ok');
    $('#confirm-modal-cancel').text(options.cancel_message || 'Cancel');

    $('#confirm-modal-ok').one('click', function(evt) {
        $('#confirm-modal').foundation('reveal', 'close');
        $('#confirm-modal-cancel').off('click');
        options.ok();
    });

    $('#confirm-modal-cancel').one('click', function(evt) {
        $('#confirm-modal').foundation('reveal', 'close');
        $('#confirm-modal-ok').off('click');
        options.cancel();
    });
           
    $('#confirm-modal').foundation('reveal', 'open');
}

// Prompt for a password with a modal dialog
function requestPassword(ssid, callback){
    $('#modal-title').text('Enter the passphrase for ' + ssid);
    $('#passwd-modal').foundation('reveal', 'open');

    function teardown() {

      $('#btn-connect').off('click');
      $('#txt-password').off('change');
      $('#txt-password').val('');
    }

    function submit() {
      callback($('#txt-password').val());
      teardown();
      $('#passwd-modal').foundation('reveal', 'close');
      $("#passwd-form").trigger('reset');         
    }

    $('#btn-connect').one('click', submit);
    $('#txt-password').one('change', submit);

    $('#passwd-modal').bind('closed.fndtn.reveal', function (event) {
      teardown();
    });
}

// Confirm, then go to AP mode if requested.
function enterAPMode(callback) {
    confirm({
        title : "Enter AP Mode?",
        description : "You will lose contact with the dashboard and need to reconnect in Access Point Mode.",
        ok_message : "Yes",
        cancel_message : "No",
        ok : function() {
            fabmo.enableWifiHotspot(function(err, data) {
                if(err) {
                    fabmo.notify('error', err);
                } else {
                    fabmo.notify('info', data);
                }
            });
        }, 
        cancel : function() {
        	// No action required.
        }
    });
}

  $(document).ready(function() {

    //Foundation Init
    $(document).foundation();

    // Check for new networks initially, and then every 3 seconds
    refreshWifiTable(function(err, data) {
        if(err){
            fabmo.notify('error',"failed to retrieve network information. Network management may not be available on your tool.");
            return;
        }
        setInterval(refreshWifiTable, 3000);
    });

    refreshHistoryTable();

    // Action for clicking the SSID
    $('tbody').on('click', 'td.ssid', function () {
        var name = $(this).text();
        requestPassword(name, function(passwd){
        fabmo.showModal({message:"Your tool is connecting to the network, please use the Tool Minder to find me on the new network called "+name+" ."});
            fabmo.connectToWifi(name, passwd,function(err,data){
                if(err) {
                    fabmo.notify('error',err);
                }
            });
        });
    });

    // Action for clicking the AP mode button
    $('#ap-mode-button').on('click', function(evt) {
        enterAPMode();
        evt.preventDefault();
        fabmo.showModal({message:"Your tool is now back in AP mode."});
    })


});
