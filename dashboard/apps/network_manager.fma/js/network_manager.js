require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
const { info } = require('toastr');
require('./i18n.js');   // installs window.t / window.i18nReady / window.i18nApply
var fabmo = new Fabmo;

var networks = {};
var wifi_state = false;
var network_history = {};

// Get networks from the tool, and add entries to the table
function refreshWifiTable(callback){
    callback = callback || function() {};
    // Check if wifi is ON
    // Check wifi by correctly calling fabmo.isWifiOn() and not by checking the button state
    // This is because the button state may not be in sync with the actual wifi state
    fabmo.isWifiOn(function(err, wifion) {
        if(err) {
            //fabmo.notify('error',"Failed to retrieve data from tool."); // too annoying a report
            return callback(err);
        }
        if(wifion) {
            wifi_state = true;
            $('#wifi-mode-button').html('<strong>' + window.t("network_manager.header.wifi_label") + '</strong><strong style="color: #ffe217;">&nbsp;&nbsp;&nbsp;' + window.t("network_manager.status.on") + '</strong> |<span style="color: lightgray; opacity: 0.5;"> ' + window.t("network_manager.status.off") + '</span>');
                fabmo.getWifiNetworks(function(err, networks) {
                if(err) {
                    fabmo.notify('error', window.t("network_manager.notify.error_retrieve_network_info"));
                    return callback(err);
                }
                addWifiEntries(networks);
                callback(null, networks);
            });
        } else {
            networks = {};
            wifi_state = false;
            $('#wifi-mode-button').html('<strong>' + window.t("network_manager.header.wifi_label") + '</strong>&nbsp;&nbsp;&nbsp;<span style="color: lightgray; opacity: 0.5;">' + window.t("network_manager.status.on_lower") + '</span> |<strong style="color: #ffe217;">&nbsp;' + window.t("network_manager.status.off_upper") + '</strong');
            callback(null, {});
        }
        refreshHistoryTable();
    });
}

// Manage the network table entries and signal strength
function addWifiEntries(network_entries, callback) {
	callback = callback || function() {};
	var table = document.getElementById('wifi_table');
	network_entries.forEach(function(entry) {
        if(entry.ssid in networks) {
            return;
        }
        networks[entry.ssid] = entry;
        // Now parsing the signal strength from nmcli which is in % on a 0-100(strongest) scale: converting to 1-4
        var rawStrength = entry.signalLevel;
        var strengthNumber = 0;
        if(rawStrength < 20) { 
            strengthNumber = 0;
        } else if(rawStrength > 20 && rawStrength < 45) {
            strengthNumber = 1;
        } else if(rawStrength > 45 && rawStrength < 65) {
            strengthNumber = 2;
        } else if(rawStrength > 65 && rawStrength < 90) {
            strengthNumber = 3;
        } else if(rawStrength > 90) {
            strengthNumber = 4;
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
            var ssidText = entry.ssid || window.t("network_manager.wifi.hidden_ssid");
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
        // console.log(networks);
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
    var $table = $('#history_table');
    // Clear existing table rows, except for the header if it exists
    $table.find('tr:gt(0)').remove(); // Assuming the first row is a header
    $('#ap-mode-button').removeClass('active'); // clear the AP mode flag by default
    Object.keys(history_entries).forEach(function(entry) {
        var $row = $('<tr></tr>');
        var interfaceText = entry || '';
        var ipAddressText = history_entries[entry] || '';
        var intInfoText = '';

        if (interfaceText === 'eth0') {
            intInfoText = window.t("network_manager.interfaces.info_ethernet");
        }
        if (interfaceText === 'wlan0_ap') {
            intInfoText = window.t("network_manager.interfaces.info_ap_active");
            $('#ap-mode-button').addClass('active');
            $('#ap-mode-button').html('<strong>' + window.t("network_manager.header.ap_mode_label") + '</strong><strong style="color: #ffe217;">&nbsp;&nbsp;&nbsp;' + window.t("network_manager.status.enabled") + '</strong> |<span style="color: lightgray; opacity: 0.5;"> ' + window.t("network_manager.status.disabled") + '</span>');
        } else {
            $('#ap-mode-button').removeClass('active');
            $('#ap-mode-button').html('<strong>' + window.t("network_manager.header.ap_mode_label") + '</strong>&nbsp;&nbsp;&nbsp;<span style="color: lightgray; opacity: 0.5;">' + window.t("network_manager.status.enabled_lower") + '</span> |<strong style="color: #ffe217;">&nbsp;' + window.t("network_manager.status.disabled_upper") + '</strong');
        }
        if (interfaceText === 'wlan0') {
            $('#wifi-mode-button').addClass('active');
            if (history_entries[entry].includes(',')) {
                ipAddressText = history_entries[entry].split(',')[0];
                intInfoText = window.t("network_manager.interfaces.info_wifi_network_prefix") + history_entries[entry].split(',')[1];
            } else {
                intInfoText = window.t("network_manager.interfaces.info_wifi_unknown");
            }
        }
        $row.append($('<td></td>').addClass('interface con-int noselect').html(interfaceText));
        $row.append($('<td></td>').addClass('ipaddress').html(ipAddressText).css("cursor", "default"));
        $row.append($('<td></td>').addClass('intinfo').html(intInfoText).css("cursor", "default"));
        $table.append($row);
    });

    callback(null); // Callback with no error
}

// Show the confirmation dialog
function confirm(options) {
    options.ok = options.ok || function () {};
    options.cancel = options.cancel || function () {};

    $('#confirm-modal-title').text(options.title || '');
    $('#confirm-modal-description').html(options.description || '');

    // Check if only the cancel button should be displayed
    if (options.cancelOnly) {
        $('#confirm-modal-ok').hide(); // Hide the OK button
        $('#confirm-modal-cancel').text(options.cancel_message || window.t("network_manager.dialog.cancel")).show();
    } else {
        $('#confirm-modal-ok').text(options.ok_message || window.t("network_manager.dialog.ok")).show();
        $('#confirm-modal-cancel').text(options.cancel_message || window.t("network_manager.dialog.cancel")).show();
    }

    $('#confirm-modal-ok').one('click', function (evt) {
        $('#confirm-modal').foundation('reveal', 'close');
        $('#confirm-modal-cancel').off('click');
        options.ok();
    });

    $('#confirm-modal-cancel').one('click', function (evt) {
        $('#confirm-modal').foundation('reveal', 'close');
        $('#confirm-modal-ok').off('click');
        options.cancel();
    });

    $('#confirm-modal').foundation('reveal', 'open');
}

// Prompt for a password with a modal dialog on adding a Wifi
let passphrase = '';
function requestPassword(ssid, callback){
    $('#passwd-modal').foundation('reveal', 'open');
    $('#modal-title').text(window.t("network_manager.dialog.enter_passphrase_for") + ssid);
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
      teardown();
      $('#passwd-modal').foundation('reveal', 'close');
    }
    $('#btn-connect').one('click', submit);
    $('#passwd-modal').bind('closed.fndtn.reveal', function (event) {
      teardown();
    });
}



$(document).ready(function() {

    //Foundation Init
    $(document).foundation();

    // Check for new networks initially, and then every 5 seconds
    refreshWifiTable(function(err, data) {
        if(err){
            fabmo.notify('error', window.t("network_manager.notify.error_retrieve_network_info"));
            return;
        }
        setInterval(refreshWifiTable, 5000);
    });

    // Action for clicking the Wifi SSID to establish a connection
    $('tbody').on('click', 'td.ssid', function () {
        var name = $(this).text();
        requestPassword(name, function(passwd){
            fabmo.showModal({
                title: window.t("network_manager.notify.trying_to_connect", {name: name}),
                message: '<i class="fa fa-circle-o-notch fa-spin" style="font-size:40px;color:#313366" aria-hidden="true"></i>',
                noButton : true
            });
            fabmo.connectToWifi(name, passwd,function(err,data){
                if(err) {
                    console.log(err);
                    fabmo.showModal({message:err});
                } else {
                    console.log(data);
                    // Remove everything up to and including the first ":" and then trim the result for the variable "address" 
                    var address = data.ip.replace(/.*:/, "").trim();
                    fabmo.hideModal();
                    confirm({
                        title : window.t("network_manager.dialog.connect_success_title"),
                        description : window.t("network_manager.dialog.connect_success_description", {name: name, address: address}),
                        ok_message : window.t("network_manager.dialog.ok_upper"),
                        ok : function() {
                            setTimeout(function() {
                                console.log('Refreshing tables and iframe');
                                refreshHistoryTable();
                                //window.parent.postMessage("refresh-iframes");
                            }, 3000); 
                        }
                    });
        

                }
            });
        });
    });

    // If we get a click on td.security then click td.ssid to trigger the same action
    $('tbody').on('click', 'td.security', function () {
        $(this).prev().click();
    });

    $('.not-implemented').on('click', function() {
        fabmo.showModal({message:window.t("network_manager.notify.feature_coming_soon")});
    });

    // Display message for clicks on Interface Entries
    $('tbody').on('click', 'td.con-int', function(evt) {
        var name = evt.target.textContent;
        if (name === 'eth0') {
            confirm({
                title : "",
                description : window.t("network_manager.dialog.remove_ethernet_description"),
                cancel_message : window.t("network_manager.dialog.close"),
                cancelOnly : true,
                cancel : function() {
                	// No action required.
                }
            });

            //fabmo.showModal({message:"To remove a LAN or PC interface; disconnect the Ethernet cable from your tool. Always allow 10 seconds before reconnecting another cable."});
        } else if (name === 'wlan0') {
            // Retrieve the SSID from the third column in the same row; pretty ugly but it works
            var ssid = $(evt.target).closest('tr').find('td').eq(2).text();
            ssid = ssid.replace(window.t("network_manager.interfaces.info_wifi_network_prefix"), "").trim();
            confirm({
                title : window.t("network_manager.dialog.disconnect_wifi_title"),
                description : "",
                ok_message : window.t("network_manager.dialog.ok_upper"),
                cancel_message : window.t("network_manager.dialog.cancel"),
                ok : function() {
                    fabmo.disconnectFromWifi(ssid, function(err, data) {
                        if(err) {
                            fabmo.notify('error', err);
                        }
                        setTimeout(function() {
                            console.log('Refreshing tables and iframe');
                            refreshHistoryTable();
                            //window.parent.postMessage("refresh-iframes");
                        },5000); // wait 5 sec
                    });
                }, 
                cancel : function() {
                	// No action required.
                }
            });
        } else if (name === 'wlan0_ap') {
            $('#ap-mode-button').trigger('click');  // use AP mode toggle
        }
    });

    // Pick up closing of the modal message
    $('fabmo.modalOkay').on('click', function () {
        refreshHistoryTable();
        window.parent.postMessage("refresh-iframes");  // needed?
    });

    // Toggle Action for clicking the AP mode button
    $('#ap-mode-button').on('click', function(evt) {
        console.log("-got click on AP");
        if ($('#ap-mode-button').hasClass('active')) {
            confirm({
                title : window.t("network_manager.dialog.turn_off_ap_title"),
                description : "",
                ok_message : window.t("network_manager.dialog.ok_upper"),
                cancel_message : window.t("network_manager.dialog.cancel"),
                ok : function() {
                    fabmo.disableWifiHotspot(function(err, data) {
                        if(err) {
                            fabmo.notify('error', err);
                        }
                        // wait 1 seconds then refresh history and wifi table
                        setTimeout(function() {
                            refreshWifiTable();
                            window.parent.postMessage("refresh-iframes");
                        }, 1000);
                    });
                }, 
                cancel : function() {
                	// No action required.
                }
            });
        } else {
            confirm({
                title : window.t("network_manager.dialog.start_ap_title"),
                description : "",
                ok_message : window.t("network_manager.dialog.ok_upper"),
                cancel_message : window.t("network_manager.dialog.cancel"),
                ok : function() {
                    fabmo.enableWifiHotspot(function(err, data) {
                        if(err) {
                            fabmo.notify('error', err);
                        }
                        // wait 1 seconds then refresh history and wifi table
                        setTimeout(function() {
                            refreshWifiTable();
                            window.parent.postMessage("refresh-iframes");
                        }, 1000);
                    });
                }, 
                cancel : function() {
                	// No action required.
                }
            });
        }
    })

    // Toggle Action for clicking the Wifi mode button
    $('#wifi-mode-button').on('click', function(evt) {
        console.log("-got click on wifi");
        if (wifi_state) { // Wifi is ON
            confirm({
                title : window.t("network_manager.dialog.turn_off_wifi_title"),
                description : window.t("network_manager.dialog.turn_off_wifi_warning"),
                ok_message : window.t("network_manager.dialog.ok_upper"),
                cancel_message : window.t("network_manager.dialog.cancel"),
                ok : function() {
                    fabmo.disableWifi(function(err, data) {
                        if(err) {
                            fabmo.notify('error', err);
                        }
                        setTimeout(function() {
                            refreshHistoryTable();
                            refreshWifiTable();
                            window.parent.postMessage("refresh-iframes");
                        }, 5000); // wait 5 sec
                    });
                }, 
                cancel : function() {
                	// No action required.
                }
            });
        } else {
            confirm({
                title : window.t("network_manager.dialog.turn_on_wifi_title"),
                description : "",
                ok_message : window.t("network_manager.dialog.ok_upper"),
                cancel_message : window.t("network_manager.dialog.cancel"),
                ok : function() {
                    fabmo.enableWifi(function(err, data) {
                        if(err) {
                            fabmo.notify('error', err);
                        }
                        // wait 3 seconds then refresh history and wifi table
                        setTimeout(function() {
                            refreshHistoryTable();
                            window.parent.postMessage("refresh-iframes");
                        }, 3000);
                    });
                }, 
                cancel : function() {
                	// No action required.
                }
            });
        }
    })
})
