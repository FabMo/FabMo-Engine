// Events and keypress handlers in the FabMo-Dashboard

/********** Layout Resize Fonctions **********/
resizedoc = function(){
	var l=0; var r=0;

	if($("body").width()/parseFloat($("body").css("font-size"))>40.063) {
		$("#main").addClass("offcanvas-overlap-right");
		l=parseInt($("#left-menu").css("width"))+1;
	}
	else {
		$("#main").removeClass("offcanvas-overlap-right");
		$("#main").removeClass("offcanvas-overlap-left");
		$("#widget-links-general").removeClass("colapsed");
		$("#left-menu").removeClass("colapsed");
		l=0;
	}

	if( ($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width()/parseFloat($("body").css("font-size")))>60.063) {
		r=parseInt($("#right-menu").css("width")+1);
	} else {r=0;}

	r=r+l;
	if(l>1) l=l-1;
	
	$(".main-section").css("width",$("body").width()-r+"px");
	$(".main-section").css("margin-left",l+"px");
	$(".main-section").css("height",$("#left-menu").height()+"px");
};

resizedocclick = function(){
	var l=0; var r=0;

	if($("body").width()/parseFloat($("body").css("font-size"))>40.063) {
		l=parseInt($("#left-menu").css("width"))+1;
	}	
	else {l=0;}

	if( !($("#main").hasClass("offcanvas-overlap-left")) && ($("body").width()/parseFloat($("body").css("font-size")))>60.063) {
		r=parseInt($("#right-menu").css("width")+1);
	} else {r=0;}

	r=r+l;
	$(".main-section").css("width",$("body").width()-r+"px");
};

colapseMenu = function() {
	if($("#widget-links-general").hasClass("colapsed"))	{
		$("#widget-links-general").removeClass("colapsed");
		$("#left-menu").removeClass("colapsed");
	}

	else {
		$("#widget-links-general").addClass("colapsed");
		$("#left-menu").addClass("colapsed");
	}

	resizedoc();
};


widgetToolsNetwork = function() {
	if ($("#widget-tools-network .tools-other").hasClass("hidden")) {
		$("#widget-tools-network .tools-other").removeClass("hidden");
		$("#widget-tools-network .refresh").removeClass("hidden");
	}
	else {
		$("#widget-tools-network .tools-other").addClass("hidden");
		$("#widget-tools-network .refresh").addClass("hidden");
	}
};


/********** Document Ready Init **********/
$(document).ready( function() {
	$(document).foundation({
      offcanvas : {
        open_method: 'overlap_single', 
      }
    });

	var bar = document.getElementById('app_menu_container');
		new Sortable(bar, {
		group: "apps",
		ghostClass: "sortable-ghost",
		animation: 150,
		store: {
		  /** Get the order of elements. Called once during initialization. **/
		  get: function (sortable) {
		      var order = localStorage.getItem(sortable.options.group);
		      return order ? order.split('|') : [];
		  },
		  /** Save the order of elements. Called every time at the drag end **/
		  set: function (sortable) {
		      var order = sortable.toArray();
		      localStorage.setItem(sortable.options.group, order.join('|'));
		  }
		}
	});
	resizedoc();
	
	$(window).resize( function() {resizedoc();});
	$("#icon_colapse").click(function() { colapseMenu(); });
	$("#widget-tools-network div").click( function() {widgetToolsNetwork(); });

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

	toastr.options["positionClass"] = "toast-bottom-center";
});