define(function(require) {
    var $ = require('jquery');
    var toastr = require('./libs/toastr.min');
    var colapsed;



    // Events and keypress handlers in the FabMo-Dashboard

    /********** Layout Resize Functions **********/

    var openDROPush = function() {
        $('#right-menu').css('right', '0');
        $('#app-client-container').css('padding-right', '218px');
        $('#app_menu_container').css('padding-right', '220px');
        $('#waiting_container').css('padding-right', '220px');

    }

    var closeDROPush = function() {
        $('#right-menu').css('right', '-222px');
        $('#app-client-container').css('padding-right', '0px');
        $('#app_menu_container').css('padding-right', '0px');
        $('#waiting_container').css('padding-right', '0px');
    }

    var openDROover = function() {
        $('#right-menu').css('right', '0');
    }

    var closeDROover = function() {
        $('#right-menu').css('right', '-222px');
    }

    var setRightMenuBehavior = function() {
        if ($('#right-menu').css('right') === '0px') {
            if ($(window).width() < 900) {
                closeDROover();
            } else {
                closeDROPush();
            }
        } else {
            if ($(window).width() < 900) {
                openDROover();
            } else {
                openDROPush();
            }
        }
    }
    var rightMenuLoad = function() {
        if ($(window).width() > 900) {
            openDROPush();
        } else if ($(window).width() < 900) {
            $('#app-client-container').css('padding-right', '0px');
            $('#app_menu_container').css('padding-right', '0px');
            $('#waiting_container').css('padding-right', '0px');
        }
    }
    $('.DRO-button').on('click', function(evt) {
        setRightMenuBehavior();
         var el = $(this),
        newone = el.clone(true);
        el.before(newone);
        $("." + el.attr("class") + ":last").remove();
        evt.preventDefault();
    });

    var resizedoc = function() {
        //L & R = width of left & right menus
        var l = 0;
        var r = 0;

        //Screen displays based on size
        colapsed = localStorage.getItem('colapsed');
        console.log(colapsed);
        if ($(window).width() > 640) {
            $("#main").addClass("offcanvas-overlap-right"); //Show Left Menu
            l = parseInt($("#left-menu").css("width")) + 1; //Save left menu size
            if (colapsed === "false" || undefined){
                $("#widget-links-general").removeClass("colapsed"); //Show fulll left hand menu on full screen
                $("#left-menu").removeClass("colapsed"); //Show fulll left hand menu on full screen
                
                
            }
        } else if ($(window).width()  <= 640) {
            $("#main").addClass("offcanvas-overlap-right"); //Show Left Menu
            $("#widget-links-general").addClass("colapsed"); //Show fulll left hand menu on full screen
            $("#left-menu").addClass("colapsed"); //Show fulll left hand menu on full screen
            l = parseInt($("#left-menu").css("width")) + 1; //Save left menu size
            $('#close_menu').css('display', 'none');
        } else {
            //No left & right menus
            $("#widget-links-general").removeClass("colapsed");
            $("#left-menu").removeClass("colapsed");
            $("#main").removeClass("offcanvas-overlap-right");
            $("#main").removeClass("offcanvas-overlap-left");
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
        $(".main-section").css("height", $("#left-menu").height() + 1 + "px");

        //Set size of app container (so footer does not hide content)
        $('.main-section').css('padding-bottom',$('.footBar').css('height'));

        //Resize app-icon container, so the icon are centered
        $("#app_menu_container").css(
            "width",
            $(".main-section").width() - ($(".main-section").width() % 132)
        )
        if ($('.axi').is(':focus')){

        } else {
            rightMenuLoad();
        }

        calcLeftPadding();
    };


    window.setInterval(function() {
        $('.pauseJob').toggleClass('blink');

    }, 1000);

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

            if ($("body").width() < 640) {
                $('.collapseLeft').show(); // show tinted screen to close menu
            }
        }

        //If menu not colapsed, we colapse it
        else {
            $("#widget-links-general").addClass("colapsed");
            $("#left-menu").addClass("colapsed");
            $("#app_menu_container").css("width",
                $(".main-section").width() - ($(".main-section").width() % 132)
            );
            $('.collapseLeft').hide();

        }
        //Handle collapse of left
        $('.collapseLeft').click(function(evt) {
            evt.preventDefault();
            $('.collapseLeft').hide();
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

        if (!($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width() / parseFloat($("body").css("font-size"))) > 60.063) {
            r = parseInt($("#right-menu").css("width") + 1);
        } else {
            r = 0;
        }

        r = r + l;
        $(".main-section, .app-section").css("width", $("body").width() - r + "px");

        //Resize app-icon container, so the icon are centered
        $("#app_menu_container").css(
            "width",
            $(".main-section").width() - ($(".main-section").width() % 132)
        );
    };

    var slideMenu = function() {
        var startClick = null;
        var endClick = null;

        $("body").on("touchstart", function(event) {
            startClick = event.originalEvent.touches[0].pageX;
        });
    };

    
    /********** Disable Menus if in Tour **********/
    
   
    $(window).on('hashchange', function(e){
         checkifTour();
    });

    function checkifTour(){
         var url = window.location.href; 
         var final = url.substr(url.lastIndexOf('/') + 1);
         console.log(final); 
         if (final === 'tour'){
             $('.off-canvas-list, .widget').addClass('blur');
             $('.tour-filter').css('height', '100%');

         } else {
             $('.off-canvas-list, .widget').removeClass('blur');
             $('.tour-filter').css('height', '0');
         }
    }


    /********** Document Ready Init **********/
    $(document).ready(function() {


        rightMenuLoad();
        resizedoc();
        //If size of the screen change, we resize the main & app container
        checkifTour();
        $(window).resize(function() {
            resizedoc();
        });

        //Idem if we colapse or un-colapse the right menu
        $("#icon_colapse").click(function(evt) {
          evt.preventDefault();
            colapseMenu();
        });

        //Define the positions of the dashboard notifications
        toastr.options["positionClass"] = "toast-top-center";
        toastr.options.showMethod = 'slideDown';
        toastr.options.hideMethod = 'slideUp';
        toastr.options.preventDuplicates = true;


        //Click & Swipe listener
        slideMenu();

        //Remove redirection on forms submit
        $("button[type='submit']").click(function() {
            return false; //Override the action of the button, so the user is not redirected to another page (no data lost)
        });


    //handle log out

    });



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
