
function refreshWifiTable(callback){
	callback = callback || function() {};
	fabmo.getWifiNetworks(function(err, networks) {
		if(err) {callback(err);}
		addWifiEntries(network_entries);
		callback(null, network_entries);
	});
}

function addWifiEntries(network_entries, callback) {
	callback = callback || function() {};
	var table = document.getElementById('wifi_table');
	network_entries.forEach(function(entry) {
		var row = table.insertRow(table.rows.length);
		var ssid = row.insertCell(0);
		var security = row.insertCell(1);
		var strength = row.insertCell(2);

		ssid.innerHTML = entry.ssid
		security.innerHTML = entry.security.join(',');
		strength.innerHTML = '';
	});
}

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

function requestPassword(ssid, callback){
    $('#modal-title').text('Enter the passphrase for ' + ssid);
    $('#passwd-modal').foundation('reveal', 'open');
    $( '#passwd-form' ).one('submit', function( event ) {
      event.preventDefault();
      callback($('input:first').val());
      $('#passwd-modal').foundation('reveal', 'close');
      $("#passwd-form").trigger('reset'); 
    });

    $('#passwd-modal').bind('closed.fndtn.reveal', function (event) {
        $("#passwd-form").off('submit');            
    });
}

function enterAPMode(callback) {
    confirm({
        title : "Enter AP Mode?",
        description : "You will lose contact with the dashboard and need to reconnect in Access Point Mode",
        ok_message : "Yes",
        cancel_message : "No",
        ok : function() {
            console.info("Going into access point mode...")
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