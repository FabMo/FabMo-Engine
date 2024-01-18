
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;
var CodeMirror = require('./codemirror.js');
require('./simple.js');
require('./cm-fabmo-modes.js');
    var editor;
    var lang="gcode";
    var source=null;
    var source_data=null;
    var job_description=null;
    var job_title=null;
    var job_filename=null;

    function execute() {
      $("#execute-menu").hide();
      var text = editor.getValue();
      switch(lang) {
        case "gcode":
          fabmo.notify('info', 'Executing G-Code program.');
          fabmo.runGCode(text);
        break;
        case "opensbp":
          fabmo.notify('info', 'Executing OpenSBP program.');
          fabmo.runSBP(text);
        break;
      }
    }

    function supports_html5_storage() {
      try {
        return 'localStorage' in window && window['localStorage'] !== null;
      } catch (e) {
        console.warn("HTML5 Local storage unsupported?")
        return false;
      }
    }

    function cycleLanguage(save) {
      if(lang === 'gcode') {
        set_language('opensbp', save);
      } else {
        set_language('gcode', save);
      }
    }

    // 'Click' on the header to cycle the language -- don't think we want this!
    // $('#app-header').click(function(evt) {
    //   cycleLanguage(true);
    // });

    function set_language(language, save) {
      switch(language) {
        case 'opensbp':
          $("#app-header-language").text(" (OpenSBP)");
          $("#lang-gcode").parent().removeClass("active");
          $("#lang-opensbp").parent().addClass("active");
          lang='opensbp';
          editor.setOption("mode", "opensbp");
        break;

        case 'gcode':
          $("#app-header-language").text(" (G-Code)");
          $("#lang-opensbp").parent().removeClass("active");
          $("#lang-gcode").parent().addClass("active");
          lang = 'gcode';
          editor.setOption("mode", "gcode");
          break;
      }
      if(supports_html5_storage() && save) {
        localStorage.fabmo_editor_language = lang;
      }
    }

    function loadFromBrowser() {
      if(supports_html5_storage()) {
        var language = localStorage.fabmo_editor_language || 'gcode';
        set_language(language);
        var content = localStorage.fabmo_editor_content || '';
        if((content !== content) || (content === undefined)) {
          console.warn("No saved content in scratchpad.");
        } else {
            $('#app-content').text("[ editor scratchpad ]");
            $(".exit-button").css("visibility", "hidden");
            editor.setValue(content);
        }
        var pos;
        try {
          pos = JSON.parse(localStorage.fabmo_editor_position);
        } catch(e) {
          console.warn("Couldn't set position: " + e)
          pos = {row:0,col:0};
        }
        // TODO load the cursor and scroll positions here
      }
    }

    function setup() {
      fabmo.getAppArgs(function(err, args) {
        if('job' in args) {
          var url = '/job/' + args.job + '/file';
          $.get(url,function(data, status) {
            $('#app-content').text("[job: ");
              editor.setValue(data, -1);
              //editor.clearSelection();
              source = "job";
              fabmo.getJobInfo(args.job, function(err, info) {
                if(!err) {
                    job_title = info.name || info.file.filename || null;
                    job_description = info.description || null;
                    job_filename = info.file.filename;
                    $('#edit-filename').text(info.name + " ]");
                  if(info.file.filename.endsWith('sbp')) {
                    set_language('opensbp');

                    $('.language-dropdown').hide();

                } else {
                    set_language('gcode');
                  }
                }
              });
          });

        } else if('macro' in args) {
          $('.language-dropdown').hide();
          lang = 'opensbp';
          var url = '/macros/' + args.macro;
          $.get(url,function(response, status) {
            var macro = response.data.macro;
            $('#app-content').text("[macro: #" + args.macro);
            $('#edit-filename').text("{" + macro.name + " } ]");
            editor.setValue(macro.content, -1);
            //editor.clearSelection();
            source = "macro";
            source_data = macro;
            job_description = macro.description;
            job_title = 'macro_' + macro.index + '.sbp';
            set_language('opensbp');
            $('#macro-menu').show();
          });
        } else if('new' in args) {
          editor.setValue(args.content || '', -1);
          editor.clearSelection();
          source = null;
          switch(args.language) {
            case 'sbp':
            case 'opensbp':
              set_language('opensbp');
              break;
            default:
              set_language('gcode');
              break;
          }
        } else {
          loadFromBrowser();
        }
      });
    }

    function save(callback) {
      var callback = callback || function() {};
      switch(source) {
        case undefined:
        case null:
          if(supports_html5_storage()) {
            localStorage.fabmo_editor_content = editor.getValue();
            pos = editor.getCursor();
            localStorage.fabmo_editor_position = JSON.stringify(pos);
          }
          callback();
          break;

        case "macro":
          fabmo.updateMacro(source_data.index, {content: editor.getValue()}, function(err, result) {
            fabmo.notify('info', "Macro '" + source_data.name + "' saved.");
            callback();
          });
          break;

        default:
          callback();
          break;
      }
    }

    $(document).ready(function() {
      $(document).foundation();

      editor = CodeMirror(function(elt) {
        var div = document.getElementById('editor');
        elt.id = 'editor'
        div.parentNode.replaceChild(elt, div);
      }, {
        lineNumbers : true,
        //viewportMargin : Infinity,
        theme: 'fabmo',
        mode: 'text'
      });

      editor.addKeyMap({
          "Cmd-Enter": function(cm) {
            execute();
          },
          "Ctrl-Enter": function(cm) {
            execute();
          },
          "Ctrl-s": function(cm) {
            save();
          },
          "Cmd-s": function(cm) {
            save();
          }
        })

      editor.on('blur', function(cm) {
          if(!source) {
            save();
          }
        });


////## th - experiment on FLOW back re: Sb4 and similar apps

    // get info for setting up exit-back behavior
    let this_App = "editor";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    // do nothing if current (e.g. refreshes and returns)
    if (this_App != current_App) {
        back_App = current_App;
        if (back_App === null || back_App === "") {back_App = default_App};
        current_App = this_App;
        localStorage.setItem("currentapp", current_App);
        localStorage.setItem("backapp", back_App);
    } 

    $(".exit-button").on("click", function(){
        fabmo.launchApp(back_App);
    });
 
    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            fabmo.launchApp(back_App);
        }
    };

    // set focus at the end of 'ready'.

////##

      setup();

      function resize() {
        var h = window.innerHeight;
        var h2 = $('#topbar').height();
        $("#editor").css('height',h-h2);
        $(document).foundation('reflow');
      }

      $(window).resize(function(){
        resize();
      });
      resize();
      $(window).trigger("focus");

    }); // document.ready

    $("#topbar").on("dragstart", function(evt) {
      evt.preventDefault();
    });
    
    $("#submit-immediate").click(function(evt) {
      evt.preventDefault();
      execute();
    });

    $("#submit-job").click(function(evt) {
      evt.preventDefault();
      //submit_job();
      submitJob();
    });

    $("#lang-opensbp").click(function(evt) {
      set_language('opensbp', true);
      evt.preventDefault();
    });

    $("#lang-gcode").click(function(evt) {
      set_language('gcode', true);
      evt.preventDefault();
    });

    $("#macro-save").click(function(evt) {
      save();
      evt.preventDefault();
    });

    $("#macro-save-and-close").click(function(evt) {
      save(function() {
        fabmo.launchApp('macros');
      });
      evt.preventDefault();
    });

    $('.disabled').click(function(evt) {
      return false;
    });

    
    ////## modified to test idea of only using having a file name and showing or not the extension ... as opposed to 2 names
    function submitJob(){
        $('#modal-title').text('Submit Job');
        switch(lang) {
          case 'gcode':
            $('#jobsubmit-name').val(job_filename || 'editor.nc');
            $('#jobsubmit-description').val(job_description || 'G-Code job from the editor');
            $('#jobsubmit-filename').val(job_filename || 'editor.nc');
            break;
          case 'opensbp':
            $('#jobsubmit-name').val(job_filename || 'editor.sbp');
            $('#jobsubmit-description').val(job_description || 'OpenSBP job from the editor');
            $('#jobsubmit-filename').val(job_filename || 'editor.sbp');
            break;
          default:
            fabmo.notify('warn', 'Unknown file format in editor?!');
            break;
        }
        $('#jobsubmit-modal').foundation('reveal', 'open');
        $('#jobsubmit-name').focus();

        $('#jobsubmit-submit').on('click', function( event ) {
          event.preventDefault();
          var name = $('#jobsubmit-name').val();
          var description = $('#jobsubmit-description').val();
          var filename = $('#jobsubmit-name').val();

          var text = editor.getValue();

          fabmo.submitJob({
              file : text,
              filename: filename,
              name : name,    // just letting this float for the moment, make name without ext to be easily available
              description: description
            },
            function(err, result) {
              if(err) {
                if(err.message) {
                  fabmo.notify('error', err.message);
                } else if(err.job) {
                  fabmo.notify('warn', err.job);
                } else {
                  fabmo.notify('error', err);
                }
              } else {
                fabmo.launchApp('job-manager');
              }
            }
          );

          $('#jobsubmit-modal').foundation('reveal', 'close');
          $("#jobsubmit-form").trigger('reset');
        });

        $('#jobsubmit-modal').bind('closed.fndtn.reveal', function (event) {
            $("#jobsubmit-form").off('submit');
        });
    }

    fabmo.on('status', function(status) {
      if(status.state === 'idle') {
        $("#execute-menu").show();
      } else {
        $("#execute-menu").hide();
      }
    });

    $('#jobsubmit-cancel').click(function(evt) {
      evt.preventDefault();
      $('#jobsubmit-modal').foundation('reveal', 'close');
    });
