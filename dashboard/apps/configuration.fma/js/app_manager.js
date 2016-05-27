var fabmo = new FabMoDashboard();

function refreshApps() {
  // Load the list of apps available on the tool
  fabmo.getApps(function(err, apps) {
    apps.reverse();
    if (err) {
      return console.error(err);
    }
    $(".app-listing").empty();

    html = [
    '<tr class="app-install-row"><td>',
    '<div class="app-ghost noselect"><span class="fa fa-plus"></span></div>',
    '</td>',
    '<td colspan="4" class="app-install-text noselect">Click here to install an app</td>',
    '</tr>'].join('');
     $(".app-listing").append(html);

    $.each(apps, function(key, val) {
      var appid = 'app_' + val.id;
      var appiconid = 'appicon_' + val.id;
      var id = val.id;
      var delete_button = '';
      if (val.icon_display !== 'none') {
        delete_button = '<div class="delete-button" id="delete_' + appid + '"><img class="svg" src="images/recycling10.svg"></div>';
      }
      html = [
        '<tr><td>',
        '<a id="' + appiconid + '" class="app-icon-link">',
        '<img src="' + location.origin + '/' + val.icon_url + '" class="app-icon" style="background-color: ' + val.icon_background_color + '" />',
        '</a>',
        '</td><td>',
        '<a id="' + appid + '" class="app-link">',
        val.name,
        '</a>',
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
      $('.app-install-row').click(function(evt) {
    jQuery('#file').trigger('click');
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
    fabmo.submitApp($('#file'), {}, function(err, data) {
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
        fabmo.submitApp(files, {}, function(err, data) {
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
