require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
const { info } = require('toastr');
var fabmo = new Fabmo;

var networks = {};
var network_history = {};
var CUrssid = '';

// Get networks from the tool, and add entries to the table
function refreshWifiTable(callback){
	callback = callback || function() {};
	fabmo.getWifiNetworks(function(err, networks) {
		if(err) {return callback(err);}
		addWifiEntries(networks);
		callback(null, networks);
	});
}

function addWifiEntries(network_entries, callback) {
	callback = callback || function() {};
	var table = document.getElementById('wifi_table');
	network_entries.forEach(function(entry) {
        if(entry.ssid in networks) {
            return;
        }
        networks[entry.ssid] = entry;

        var rawStrength = entry.signalLevel;
        var strengthNumber;

        if(rawStrength > -45) { 
            strengthNumber = 4;
        } else if(rawStrength <= -45 && rawStrength > -55) {
            strengthNumber = 3;
        } else if(rawStrength <= -55 && rawStrength > -65) {
            strengthNumber = 2;
        } else if(rawStrength <= -65 && rawStrength > -75) {
            strengthNumber = 1;
        } else {
            strengthNumber = 0;
        }

        // Add to table only if strength is above threshold, strengthNumber
        if (strengthNumber > 1) {
            var row = table.insertRow(table.rows.length);
            var ssid = row.insertCell(0);
            ssid.className = 'ssid noselect';
            var security = row.insertCell(1);
            security.className = 'security noselect';
            var strength = row.insertCell(2);
            strength.className = 'wifi' + strengthNumber;

            var ssidText = entry.ssid || '<Hidden SSID>';
            var securityText = entry.flags ? entry.flags : '';

            ssid.innerHTML = ssidText;
            security.innerHTML = securityText;
        }
   });
}

// Get history from the tool, and add entries to the table
function refreshHistoryTable(callback){
    callback = callback || function() {};
    fabmo.getWifiNetworkHistory(function(err, networks) {
        console.log(networks);
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

// Add history entries (retrieved from the tool) to the HTML table in the UI, hack the wifi ssid
function addHistoryEntries(history_entries, callback) {
    callback = callback || function() {};
    var table = document.getElementById('history_table');
    Object.keys(history_entries).forEach(function (entry) {
        var row = table.insertRow(table.rows.length);
        var interface = row.insertCell(0);
        interface.className = 'interface not-implemented noselect'
        var ipaddress = row.insertCell(1);
        ipaddress.className = 'ipaddress'
        var intinfo = row.insertCell(2);
        intinfo.className = 'intinfo'

        var interfaceText = entry || '';
        var ipAddressText = history_entries[entry] || '';
        var intInfoText = '';
        if (interfaceText === 'eth0') {
            intInfoText = 'Ethernet: LAN or direct PC connection';
        } else if (interfaceText === 'uap0') {
            intInfoText = 'Access Point (AP)';
        } else if (interfaceText === 'wlan0') {
            // if there is a comma in the history_entries[entry] string, return the right hand portion
            if (history_entries[entry].includes(',')) {
                ipAddressText = history_entries[entry].split(',')[0];
                intInfoText = 'Wireless: ' + history_entries[entry].split(',')[1];
            } else {
                intInfoText = 'Wireless: ' + "unknown";
            }
        } else {
            intInfoText = 'Unknown';
        }

        interface.innerHTML = interfaceText;
        ipaddress.innerHTML = ipAddressText;
        intinfo.innerHTML = intInfoText;
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
let passphrase = '';
function requestPassword(ssid, callback){
    $('#passwd-modal').foundation('reveal', 'open');
    $('#modal-title').text('Enter the passphrase for:  ' + ssid);
    $('#toggleIcon').removeClass('fa-eye-slash');
    $('#toggleIcon').addClass('fa-eye');
    passphrase = '';
    $('#passphraseInput').val('');
    let isPassphraseVisible = false;
    
    document.getElementById('passphraseInput').addEventListener('input', function(event) {
        const input = event.target;
        const lastChar = input.value.slice(-1);
        const operation = input.value.length >= passphrase.length ? 'add' : 'remove';
    
        if (operation === 'add' && lastChar !== '•') {
            passphrase += lastChar;
            input.value = '•'.repeat(passphrase.length);
        } else if (operation === 'remove') {
            passphrase = passphrase.slice(0, -1);
        }
    });
    
    document.getElementById('toggleIcon').addEventListener('click', togglePassphraseVisibility);
    function togglePassphraseVisibility() {
        var passphraseInput = document.getElementById('passphraseInput');
        var toggleIcon = document.getElementById('toggleIcon');

        isPassphraseVisible = !isPassphraseVisible;
        if (isPassphraseVisible) {
            passphraseInput.value = passphrase; // Show the actual passphrase
            toggleIcon.classList.remove('fa-eye');
            toggleIcon.classList.add('fa-eye-slash');
        } else {
            passphraseInput.value = '•'.repeat(passphrase.length); // Mask the passphrase
            toggleIcon.classList.remove('fa-eye-slash');
            toggleIcon.classList.add('fa-eye');
        }
    }

    function teardown() {
      $('#passphraseInput').val('');
    }

    function submit() {
        callback(passphrase);
    //    callback($('#passphraseInput').val());
    //  $('#passphraseInput').val('');
      teardown();
      $('#passwd-modal').foundation('reveal', 'close');
//      $("#passwd-form").trigger('reset');         
    }

    $('#btn-connect').one('click', submit);
    // $('#txt-password').one('click', function() {console.log("only once!")});
//    $('#txt-password').one('focus', function() {$('#txt-password').attr('type', 'password'); $('#txt-password').attr('name', ssid)});

    $('#passwd-modal').bind('closed.fndtn.reveal', function (event) {
      teardown();
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

    refreshHistoryTable(function(err, data) {
        if(err){
            fabmo.notify('error',"failed to retrieve interface history. Network management may not be available on your tool.");
            return;
        }
        setInterval(refreshWifiTable, 5000);
    });

    // Action for clicking the SSID
    $('tbody').on('click', 'td.ssid', function () {
        var name = $(this).text();
        requestPassword(name, function(passwd){
            fabmo.showModal({
                title: 'Trying to connect to network ' + name,
                message: '<i class="fa fa-circle-o-notch fa-spin" style="font-size:40px;color:#313366" aria-hidden="true"></i>',
                noButton : true
            });
            fabmo.connectToWifi(name, passwd,function(err,data){
                if(err) {
                    console.log(err);
                    fabmo.showModal({message:err});
                } else {
                    console.log(data);
                    CUrssid = data.ssid;
                    fabmo.showModal({message:"Successfully connected! Please go find me on network: " + data.ssid+ " at " + data.ip});
                    refreshApps();
                    refreshHistoryTable();
                    // full refresh of this page to get the new ip address to display
                    location.reload();
                }
            });
        });
    });

    // If we get a click on td.security then click td.ssid to trigger the same action
    $('tbody').on('click', 'td.security', function () {
        $(this).prev().click();
    });

    $('.not-implemented').on('click', function() {
        fabmo.showModal({message:"Feature coming soon."});
    });

    // Display generic browser info message for buttons not yet functional
    $('tbody').on('click', 'td.not-implemented', function() {
        fabmo.showModal({message:"Feature coming soon."});
    });

    // Action for clicking the AP mode button
    // $('#ap-mode-button').on('click', function(evt) {
    //     enterAPMode();
    //     evt.preventDefault();
    //     fabmo.showModal({message:"Your tool is now back in AP mode."});
    // })


});
