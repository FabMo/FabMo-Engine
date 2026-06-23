module.exports = function apps(fabmo) {
setupAppManager();
var defaultApp = '';

function refreshApps() {
    // Load the list of apps available on the tool
    fabmo.getApps(function(err, apps) {
        if (err) {
            return console.error(err);
        }
        // clear app usage history
        localStorage.setItem("currentapp","");
        localStorage.setItem("backapp","");
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
                    '<td colspan="4" class="app-install-text noselect">'+window.t('config.apps_tab.click_to_install')+'</td>',
                    '</tr>'
                ].join('');
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
                        val.description || window.t('config.apps_tab.no_description'),
                        '</td><td></td><td>' + delete_button + '</td></tr>'
                    ].join('');
                    $(".app-listing").append(html);

                    $('#delete_' + appid).click(function() {
                        fabmo.showModal({
                            title : window.t('config.apps_tab.delete_app_title'),
                            message : window.t('config.apps_tab.delete_app_message'),
                            okText : window.t('config.modal.yes'),
                            cancelText : window.t('config.modal.no'),
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
                        if (id==="macros") {
                            localStorage.setItem("currentapp", "macros")
                        } else {
                            localStorage.setItem("currentapp", "")
                        }
                    });
                    $('#' + appiconid).click(function() {
                        fabmo.launchApp(id);
                        if (id==="macros") {
                            localStorage.setItem("currentapp", "macros")
                        } else {
                            localStorage.setItem("currentapp", "")
                        }
                    });

                }); // each

                $('.defaultRadio').on('change', function(){
                    newDefault = $(this).val();
                    localStorage.setItem('defaultapp',newDefault);
                    data.machine.default_app = newDefault;
                    fabmo.setConfig({machine: {default_app: newDefault}}, function(err, data){
                        if (err){
                            console.log(err);
                        } else {
                            console.log(data);
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
                    fabmo.notify('error', window.t('config.apps_tab.install_failed') + (err.message || err));
                } else {
                    fabmo.notify('success', data.length + " app" + ((data.length > 1) ? 's' : '') + window.t('config.apps_tab.installed_successfully'));
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
                            fabmo.notify('success', window.t('config.apps_tab.install_ok_single'));
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

