// Events and keypress handlers in the FabMo-Dashboard

/********** Layout Resize Fonctions **********/
resizedoc = function(){
	//L & R = width of left & right menus
	var l=0; var r=0;

	//If medium screen
	if($("body").width()/parseFloat($("body").css("font-size"))>40.063) {
		$("#main").addClass("offcanvas-overlap-right"); //Show Left Menu
		l=parseInt($("#left-menu").css("width"))+1; //Save left menu size
	}
	else {
		//No left & right menus
		$("#main").removeClass("offcanvas-overlap-right");
		$("#main").removeClass("offcanvas-overlap-left");
		$("#widget-links-general").removeClass("colapsed");
		$("#left-menu").removeClass("colapsed");
		l=0;
	}

	//If wide screen and Right menu
	if( ($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width()/parseFloat($("body").css("font-size")))>60.063) {
		r=parseInt($("#right-menu").css("width")+1);
	} else {r=0;}

	//Save & calcul right menu size + 1px of margin
	r=r+l;
	if(l>1) l=l-1;
	
	//Set size attribute on div "Main Section"
	$(".main-section, .app-section").css("width",$("body").width()-r+"px");
	$(".main-section, .app-section").css("margin-left",l+"px");
	$(".main-section").css("height",$("#left-menu").height()+"px");

	//Resize app-icon container, so the icon are centered
	$("#app_menu_container").css(
		"width",
		$(".main-section").width() - ($(".main-section").width() % 132 )
	);
};


colapseMenu = function() {
	//If menu is colapsed, we remove this property
	if($("#widget-links-general").hasClass("colapsed"))	{
		$("#widget-links-general").removeClass("colapsed");
		$("#left-menu").removeClass("colapsed");
	}

	//If menu not colapsed, we colapse it
	else {
		$("#widget-links-general").addClass("colapsed");
		$("#left-menu").addClass("colapsed");
	}

	//As the size of document change, we call this function to ajust main div & app container size
	resizedoc();
};

widgetToolsNetwork = function() {
	//Show and hide the tool on network div (on medium & large screen)
	if ($("#widget-tools-network .tools-other").hasClass("hidden")) {
		$("#widget-tools-network .tools-other").removeClass("hidden");
		$("#widget-tools-network .refresh").removeClass("hidden");
	}
	else {
		$("#widget-tools-network .tools-other").addClass("hidden");
		$("#widget-tools-network .refresh").addClass("hidden");
	}
};

resizedocclick = function(){
	console.log("click");
	//Same function that resizedoc(), but inverse the class on ".main-section", because it has not changed yet after the click on "#left-menu" or #right-menu
	var l=0; var r=0

	if($("body").width()/parseFloat($("body").css("font-size"))>40.063) {
		l=parseInt($("#left-menu").css("width"))+1;
	}	
	else {l=0;}

	if( !($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width()/parseFloat($("body").css("font-size")))>60.063) {
		r=parseInt($("#right-menu").css("width")+1);
	} else {r=0;}

	r=r+l;
	$(".main-section, .app-section").css("width",$("body").width()-r+"px");

	//Resize app-icon container, so the icon are centered
	$("#app_menu_container").css(
		"width",
		$(".main-section").width() - ($(".main-section").width() % 132 )
	);
};


/********** Document Ready Init **********/
$(document).ready( function() {
	//Call fundation for the document, and define a way to open the menus
	$(document).foundation({
      offcanvas : {
        open_method: 'overlap_single', 
      }
    });

	//Sortable app icon (not used now, just for play !) //Disabled
	/*
	var bar = document.getElementById('app_menu_container');
		new Sortable(bar, {
		group: "apps",
		ghostClass: "sortable-ghost",
		animation: 150,
		store: {
		  // Get the order of elements. Called once during initialization. //
		  get: function (sortable) 
{		      var order = localStorage.getItem(sortable.options.group);
		      return order ? order.split('|') : [];
		  },
		  // Save the order of elements. Called every time at the drag end //
		  set: function (sortable) {
		      var order = sortable.toArray();
		      localStorage.setItem(sortable.options.group, order.join('|'));
		  }
		}
	});
	*/

	//Init of the size of the main & app-icon containers
	resizedoc();
	
	/*
	*** Actions Listeners ***
	*/

	//If size of the screen change, we resize the main & app container
	$(window).resize( function() {resizedoc();});

	//Idem if we colapse or un-colapse the right menu
	$("#icon_colapse").click(function() { colapseMenu(); });

	//If we click on the "tool on network" button on the top-bar, they are shown / hidden
	$("#widget-tools-network div").click( function() {widgetToolsNetwork(); });

	//Change classes on status Button -> Maybe not used, or should be implemented in FabMoUI ???????
	$('.fabmo-status').on('statechange',function(e,state){
        var percent = $('.progress').text();
        if( percent!==''){
          $('.progress').html('<span class="meter" style="width:'+percent.toString()+';">');
        }
        if (state === 'running' || state === 'manual' || state === 'homing' || state==='probing')
          $('.state').removeClass('success info default warning danger').addClass('success');
        else if (state === 'paused' || state === 'passthrough' || state === 'limit')
          $('.state').removeClass('success info default warning danger').addClass('warning');
        else if (state === 'Error' || state === 'Disconnected')
          $('.state').removeClass('success info default warning danger').addClass('error');
        else
          $('.state').removeClass('success info default warning danger').addClass('default');
      });

	//Define the positions of the dashboard notifications
	toastr.options["positionClass"] = "toast-bottom-center";
});