define(function(require) {
    var $ = require('jquery');
    var toastr = require('./libs/toastr.min');
    var colapsed;
    var pinRight;


    // Events and keypress handlers in the FabMo-Dashboard

    /********** Layout Resize Functions **********/

    var openDROPush = function() {
        $('#right-menu').css('right', '0');
        $('#app-client-container').css('padding-right', '218px');
        $('#app_menu_container').css('padding-right', '220px');
        $('#waiting_container').css('padding-right', '220px');
        $('#right-position-container').addClass('dropped');
     }
     var closeDROPush = function() {
        $('#right-menu').css('right', '-222px');
        $('#app-client-container').css('padding-right', '0px');
        $('#app_menu_container').css('padding-right', '0px');
        $('#waiting_container').css('padding-right', '0px');
        $('#right-position-container').removeClass('dropped');
    }
     var openDROover = function() {
        $('#right-menu').css('right', '0');
        $('#right-position-container').addClass('dropped');
    }
     var closeDROover = function() {
        $('#right-menu').css('right', '-222px');
        $('#right-position-container').removeClass('dropped');
    }
     var setRightMenuBehavior = function() {
        if ($('#right-menu').css('right') === '0px') {
            $("#icon_DROin-out").attr("src", "../img/icon_DROout.png");
            $("#dro-tab").attr("title", "Click to open larger Display");
            localStorage.setItem('pinRight', true);
            if ($(window).width() < 900) {
                closeDROover();
            } else {
                closeDROPush();
            }
        } else {
            $("#icon_DROin-out").attr("src", "../img/icon_DROin.png");
            $("#dro-tab").attr("title", "Click to close large Display");
            localStorage.setItem('pinRight', false);
            if ($(window).width() < 900) {
                openDROover();
            } else {
                openDROPush();
            }
        }
    }
    var rightMenuLoad = function() {
        pinRight = localStorage.getItem('pinRight');
        if ($(window).width() > 900 && pinRight == "false") {
            $("#icon_DROin-out").attr("src", "../img/icon_DROin.png");
            $("#dro-tab").attr("title", "Click to close large Display");
            openDROPush();
        } else if ($(window).width() < 900) {
            $('#app-client-container').css('padding-right', '0px');
            $('#app_menu_container').css('padding-right', '0px');
            $('#waiting_container').css('padding-right', '0px');
            $("#icon_DROin-out").attr("src", "../img/icon_DROout.png");
            $("#dro-tab").attr("title", "Click to open larger Display");
        }
    }
    $('.DRO-button').on('click', function(evt) {
        setRightMenuBehavior();
        evt.preventDefault();
    });

    var resizedoc = function() {
        //L & R = width of left & right menus
        var l = 0;
        var r = 0;
        var nav = document.getElementsByClassName('tab-bar')[0];
        //Screen displays based on size
        if(nav.style.display === 'none') {
            $("#left-menu").css({'height' :$(window).height(), 'top' : 0 } );
        } else {
            $("#left-menu").css({'height' :$(window).height() - 56, 'top' : 56 } );
        }

        colapsed = localStorage.getItem('colapsed');

        if ($(window).width() > 640) {
            $("#main").addClass("offcanvas-overlap-right"); //Show Left Menu
            l = parseInt($("#left-menu").css("width")) + 1; //Save left menu size
            if (colapsed === "false" || undefined){
                $("#widget-links-general").removeClass("colapsed"); //Show fulll left hand menu on full screen
                $("#left-menu").removeClass("colapsed"); //Show fulll left hand menu on full screen
                $("#collapse_icon").attr('src', '/img/icon_colapse_r.png');
            }
        } else if ($(window).width()  <= 640) {
            $("#main").addClass("offcanvas-overlap-right"); //Show Left Menu
            $("#widget-links-general").addClass("colapsed"); //Show fulll left hand menu on full screen
            $("#left-menu").addClass("colapsed"); //Show fulll left hand menu on full screen
            $("#collapse_icon").attr('src', '/img/icon_colapse.png');
            l = parseInt($("#left-menu").css("width")) + 1; //Save left menu size
            $('#close_menu').css('display', 'none');
        } else {
            //No left & right menus
            $("#widget-links-general").removeClass("colapsed");
            $("#left-menu").removeClass("colapsed");
            $("#main").removeClass("offcanvas-overlap-right");
            l = 0;
        }
        

        //If wide screen and Right menu
        if (($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width() / parseFloat($("body").css("font-size"))) > 60.063) {
            r = parseInt($("#right-menu").css("width") + 1);
        } else {
            r = 0;
        }

        //Save & calcul right menu size + 1px of margin
        r = r + l;
        if (l > 1) l = l - 1;

        //Set size attribute on div "Main Section"
        $(".main-section, .app-section").css("width", $("body").width() - r + "px");
        $(".main-section, .app-section").css("margin-left", l + "px");
        $(".main-section").css("height", $("#left-menu").height()+ "px");

        //Set size of app container (so footer does not hide content)
        $('.main-section').css('padding-bottom',$('.footBar').css('height'));

        if ($('.axi').is(':focus')){
        } else {
       }
        calcLeftPadding();
    };


    // window.setInterval(function() {
    //     $('.pauseJob').toggleClass('blink');

    // }, 1000);

    var colapseMenu = function() {
        if ($(window).width() > 640){
            colapsed = localStorage.getItem('colapsed');

          if (colapsed  === "true") {
              localStorage.setItem('colapsed', false);
          } else {
              localStorage.setItem('colapsed', true);
          }
        }

        //If menu is colapsed, we remove this property
        if ($("#widget-links-general").hasClass("colapsed")) {
            $("#widget-links-general").removeClass("colapsed");
            $("#left-menu").removeClass("colapsed");
            $("#collapse_icon").attr('src', '/img/icon_colapse_r.png');
            $('.expand-text').hide();
            if ($("body").width() < 640) {
            $('.colapseLeft').show(); // show tinted screen to close menu
            }
        }

        //If menu not colapsed, we colapse it
        else {
            $("#widget-links-general").addClass("colapsed");
            $("#left-menu").addClass("colapsed");
            $(".colapseLeft").hide();
            $("#collapse_icon").attr('src', '/img/icon_colapse.png');
            $(".expand-text").show();
        }
        //Handle collapse of left
        $('.colapseLeft').on('click', function(evt) {
            evt.preventDefault();
            $('.colapseLeft').hide();
            $('#left-menu').addClass("colapsed");
            $('#widget-links-general').addClass("colapsed");
        });

        //As the size of document change, we call this function to ajust main div & app container size
        //resizedoc();
        //If wide screen and Right menu
        calcLeftPadding();
    };

    var calcLeftPadding = function (){///Calculate the width of the left hand menu and adjust main section accordingly
       var l = parseInt($("#left-menu").css("width")); //Save left menu size
        var  r;
        if ($("body").width() / parseFloat($("body").css("font-size")) > 40.063) {
            if (($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width() / parseFloat($("body").css("font-size"))) > 60.063) {
                r = parseInt($("#right-menu").css("width"));
            } else {
                r = 0;
            }

            //Save & calcul right menu size + 1px of margin
            r = r + l;

            //Set size attribute on div "Main Section"
            $(".main-section, .app-section").css("width", $("body").width() - r + "px");
            $(".main-section, .app-section").css("margin-left", l + "px");
            $(".main-section").css("height", $("#left-menu").height() + "px");
        }
    }

    var resizedocclick = function() {
        //Same function that resizedoc(), but inverse the class on ".main-section", because it has not changed yet after the click on "#left-menu" or #right-menu
        var l = 0;
        var r = 0

        if ($("body").width() / parseFloat($("body").css("font-size")) > 40.063) {
            l = parseInt($("#left-menu").css("width")) + 1;
        } else {
            l = 0;
        }

        r = r + l;
        $(".main-section, .app-section").css("width", $("body").width() - r + "px");

        //Resize app-icon container, so the icon are centered
    };

    var slideMenu = function() {
        var startClick = null;
        var endClick = null;

        $("body").on("touchstart", function(event) {
            startClick = event.originalEvent.touches[0].pageX;
        });
    };

//----------------------------------- These two routines are enough to communicate events from dash during running
// Function to handle key events
function handleKeyEvent(key) {
    switch (key) {
        case "+":
            var $spinner = $('.spindle-speed input');
            $spinner.val(parseInt($spinner.val(), 10) + 100);
            $spinner.trigger('change');
            break;
        case "_":
            var $spinner = $('.spindle-speed input');
            $spinner.val(parseInt($spinner.val(), 10) - 100);
            $spinner.trigger('change');
            break
        case ">":
            var $frOverride = $('#override');
            $frOverride.val(parseInt($frOverride.val(), 10) + 5);
            $frOverride.trigger('change');
            break;
        case "<":
            var $frOverride = $('#override');
            $frOverride.val(parseInt($frOverride.val(), 10) - 5);
            $frOverride.trigger('change');
            break;
    }
    console.log('Second Received key: ' + key);
}
// In the main window
window.addEventListener('keyup', function (event) {
    // Handle the keystroke
    console.log('First Received key: ' + event.key);
    handleKeyEvent(event.key);
});
//---------------------------------------------------------------

// Receive parallel events from apps
window.addEventListener('message', function(event) {
    console.log('Received key: ' + event.data.key);
    // Check the origin of the message
    //    if (event.origin !== 'http://example.com') return;
    // Process the event.detail.keys
    handleKeyEvent(event.data.key);
    //console.log('origin >> ' + event.origin);

});

    /********** Document Ready Init **********/
    function docReady () {
        rightMenuLoad();
        resizedoc();
        //If size of the screen change, we resize the main & app container
        $(window).on('resize', function() {
            resizedoc();
        });

        //Prevent draggin left icon links
        $("#left-menu").on("dragstart", function(evt) {
            evt.preventDefault();
          });

        //Idem if we colapse or un-colapse the right menu
        $("#icon_colapse").on('click', function(evt) {
          evt.preventDefault();
            colapseMenu();
        });

        $('#left-slide-button').on('click', function(evt){
            evt.preventDefault();
            if($('#left-slide-button').hasClass('open')){
                $('#left-slide-button').removeClass('open');
                $('.left-slide-menu').css('width', "46px");
            } else {
                $('#left-slide-button').addClass('open');
                $('.left-slide-menu').css('width', "400px");
            }
        });

        //Define the positions of the dashboard notifications
        toastr.options["positionClass"] = "toast-top-center";
        toastr.options.showMethod = 'slideDown';
        toastr.options.hideMethod = 'slideUp';
        toastr.options.preventDuplicates = false;


        //Click & Swipe listener
        slideMenu();

        //Remove redirection on forms submit
        $("button[type='submit']").on('click', function() {
            return false; //Override the action of the button, so the user is not redirected to another page (no data lost)
        });

    
    //handle log out

    };

    $(docReady);

    return {
        'resizedocclick': resizedocclick,
        'resizedoc': resizedoc,
        'colapseMenu': colapseMenu,
        'openDROover': openDROover,
        'closeDROover': closeDROover,
        'openDROPush': openDROPush,
        'closeDROPush': closeDROPush
    }
})
