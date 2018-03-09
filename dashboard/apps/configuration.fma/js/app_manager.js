module.exports = function apps(fabmo) {
setupAppManager();
var defaultApp = '';
function refreshApps() {
    // Load the list of apps available on the tool
    fabmo.getApps(function(err, apps) {
        if (err) {
            return console.error(err);
        }
        fabmo.getConfig(function(err, data) {
            if (err){
                console.log(err);
            } else {
                defaultApp = data.machine.default_app;
                        $(".app-listing").empty();
        html = [
            '<tr class="app-install-row"><td>',
            '<div class="app-ghost noselect"><span class="app-ghost-icon fa fa-plus"></span></div>',
            '</td>',
            '<td colspan="4" class="app-install-text noselect">Click here to install an app</td>',
            '</tr>'].join('');
            $(".app-listing").prepend(html);

            $.each(apps, function(key, val) {
            
                var appid = 'app_' + val.id;
                var appiconid = 'appicon_' + val.id;
                var checked = "";
                var id = val.id;
                var delete_button = '';
                if (val.icon_display !== 'none') {
                    delete_button = '<div class="delete-button" id="delete_' + appid + '"><img class="svg" src="images/recycling10.svg"></div>';
                }
                if (id === defaultApp){
                    checked = 'checked';
                }
                html = [
                    '<tr><td>',
                    '<input class="defaultRadio" type="radio" name="app" value="'+id+'"'+checked+'>',
                    '</td><td>',
                    '<a id="' + appiconid + '" class="app-icon-link">',
                    '<img src="' + location.origin + '/' + val.icon_url + '" class="app-icon" style="background-color: ' + val.icon_background_color + '" />',
                    '</a>',
                    '</td><td>',
                    '<a id="' + appid + '" class="app-link">',
                    val.name,
                    '</a>',
                    '</td><td>',
                    val.version || '',
                    '</td><td>',
                    val.description || 'No description.',
                    '</td><td></td><td>' + delete_button + '</td></tr>'
                ].join('');
                $(".app-listing").append(html);

                $('#delete_' + appid).click(function() {
                    fabmo.showModal({
                        title : 'Delete app',
                        message : 'Are you sure you want to delete this app?',
                        okText : 'Yes',
                        cancelText : 'No',
                        ok : function() {
                            fabmo.deleteApp(id, function(err, result) {
                                if (err) {
                                    fabmo.notify('error', err);
                                }
                                refreshApps();
                            });
                        },
                        cancel : function() {}
                    })
                });

                $('#' + appid).click(function() {
                    fabmo.launchApp(id);
                });
                $('#' + appiconid).click(function() {
                    fabmo.launchApp(id);
                });


            }); // each
            $('.defaultRadio').on('change', function(){
                newDefault = $(this).val();
                data.machine.default_app = newDefault;
                fabmo.setConfig(data, function(err, data){
                    if (err){
                        console.log(err);
                    }
                });
            });
            $('.app-install-row').click(function(evt) {
                jQuery('#file').trigger('click');
            });
            }
        });


        });
    };
    fabmo.on('change', function(topic) {
        if (topic === 'apps') {
            refreshApps();
        }
    });

    function setupAppManager() {
        refreshApps();
        $('#file').change(function(evt) {
            startBusy();
            fabmo.submitApp($('#file'), {}, function(err, data) {
                stopBusy();
                if (err) {
                    fabmo.notify('error', "Could not install app:</br>" + (err.message || err));
                } else {
                    fabmo.notify('success', data.length + " app" + ((data.length > 1) ? 's' : '') + " installed successfully.");
                }
                refreshApps();
            });
        });

        $('#dropzone').dragster({
            enter: function(devt, evt) {
                $('#dropzone').addClass('hover');
                return false;
            },

            leave: function(devt, evt) {
                $('#dropzone').removeClass('hover');
                return false;
            },
            drop: function(devt, evt) {
                evt.preventDefault();
                try {
                    files = evt.originalEvent.dataTransfer.files;
                    startBusy();
                    fabmo.submitApp(files, {}, function(err, data) {
                      stopBusy();
                        if (err) {
                            fabmo.notify('error', err.message || err);
                        } else {
                            fabmo.notify('success', "App installed successfully.");
                        }
                        refreshApps();
                    });
                } catch (e) {
                    console.error(e);
                } finally {
                    $('#dropzone').removeClass('hover');
                    return false;
                }
            }
        });
    }

function startBusy() {
  $(".app-ghost-icon").removeClass('fa-plus').addClass('fa-cog fa-spin');
}

function stopBusy() {
  $(".app-ghost-icon").removeClass('fa-cog fa-spin').addClass('fa-plus');
}
};

