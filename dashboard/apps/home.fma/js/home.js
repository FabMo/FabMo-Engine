require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');;
var Fabmo = require('../../../static/js/libs/fabmo.js');
var Sortable = require('./Sortable.js');
var fabmo = new Fabmo;
var order = [];

setupAppManager();



  function launch( id ){
        return function(){
          fabmo.launchApp(id);
        }
  }
function refreshApps() {


return new Promise (function(resolve, reject){

   

    fabmo.getAppConfig( function(err, data){
        if (data.appOrder) {
            return order = data.appOrder;
        } 
    });
    fabmo.getApps(function(err,apps){
    if (apps) {
        console.log(apps);
    var menu = document.getElementById('app_menu_container');
    menu.innerHTML = "";
    var file = document.getElementById('file');
    file.value = "";
   console.log(order);
   
   if(order.length === (apps.length - 9)){
       
       console.log(order.length);
       for (i = 0; i < order.length; i++) {
           var obj = findById(apps, order[i]);
           console.log(obj);
           makeListItem(menu, obj);
       };
    
   } else {
       order = [];
       for (i = 0; i < apps.length; i++) {
        
      if (apps[i].icon_display !== "none") {
         order.push(apps[i].id);
         makeListItem(menu, apps[i]);
        

      }
    };
    fabmo.getAppConfig(function(err, data){
        data.appOrder = order;
        fabmo.setAppConfig(data, function(err, data){

        }) 
    });
    console.log(order);
       
   }

    
    var listItem = document.createElement("ul");
    listItem.setAttribute("id", "add");
    listItem.setAttribute("class", "app_add");
    menu.appendChild(listItem);
    var id = document.getElementById("add");
    id.innerHTML = "<div class='font-container'><span class='fa fa-plus'></span></div>";
    $('#add').click(function(evt) {
        $('#file').trigger('click');
    });
    var timeoutId = 0;
    $('.app_item').on('mousedown', function(e) {
        timeoutId = setTimeout(function(){
            holdfunction(e);
        }, 1500);
    }).on('mouseup mouseleave', function(e) {
        clearTimeout(timeoutId);
    });
    
    
    resolve(apps);
    } else {
        reject(Error(err));
    }
});
});
}

function makeListItem (menu, obj) {
    console.log(obj);
     var listItem = document.createElement("li");
        listItem.setAttribute("id", obj.id);
        listItem.setAttribute("class", "app_item");
        listItem.setAttribute("data-id", obj.id);
        menu.appendChild(listItem);
        var id = document.getElementById(obj.id);
        var path = obj.icon_url;
        id.innerHTML = '<img src=/'+path+'><div class="deleteApp"><div>x</div></div><div class="appname">'+obj.name+'</div>';
        $('#'+obj.id).click(launch(obj.id));
        $('#'+obj.id).css('background-color',obj.icon_background_color);
}

function findById(source, id) {
  for (var i = 0; i < source.length; i++) {
    if (source[i].id == id) {
      return source[i];
    }
  }
}

    function setupAppManager() {
        refreshApps().then(function(apps){
            setUpSort();
        });
        $('#file').change(function(evt) {
            startBusy();
            fabmo.submitApp($('#file'), {}, function(err, data) {
                stopBusy();
                if (err) {
                    fabmo.notify('error', "Could not install app:</br>" + (err.message || err));
                } else {
                    console.log(data);
                    fabmo.notify('success', data.length + " app" + ((data.length > 1) ? 's' : '') + " installed successfully.");
                    order.push(data[0].info.id);
                    fabmo.getAppConfig(function(err, data){
                        data.appOrder = order;
                        fabmo.setAppConfig(data, function(err, data){
                            if (err) {
                                console.log(err);
                            }else {
                                setupAppManager();
                            }
                        }) 
                     });
                    
                }
                
            });
            startBusy();
        });

        // $('#dropzone').dragster({
        //     enter: function(devt, evt) {
        //         $('#dropzone').addClass('hover');
        //         return false;
        //     },

        //     leave: function(devt, evt) {
        //         $('#dropzone').removeClass('hover');
        //         return false;
        //     },
        //     drop: function(devt, evt) {
        //         evt.preventDefault();
        //         try {
        //             files = evt.originalEvent.dataTransfer.files;
        //             startBusy();
        //             fabmo.submitApp(files, {}, function(err, data) {
        //               stopBusy();
        //                 if (err) {
        //                     fabmo.notify('error', err.message || err);
        //                 } else {
        //                     fabmo.notify('success', "App installed successfully.");
        //                 }
        //                 refreshApps();
        //             });
        //         } catch (e) {
        //             console.error(e);
        //         } finally {
        //             $('#dropzone').removeClass('hover');
        //             return false;
        //         }
        //     }
        // });
    }
function setUpSort(){

    var el = document.getElementById('app_menu_container');
    var sortable = Sortable.create(el, {
        ghostClass: 'ghost',
        chosenClass: 'chosen',
        dataIdAttr: 'data-id',
        clickDelay: 0,
        touchDelay: 100,
        animation: 150,
        onEnd: function (evt) {
            var order = sortable.toArray();
            fabmo.getAppConfig(function(err, data){
                data.appOrder = order;
                fabmo.setAppConfig(data, function(err, data){
            }); 
        });

        },

    });
}

var downTimer = null;

var timeoutId = 0;

function holdfunction (e) {
   var id = e.delegateTarget.id;
   $('.filter').show();
   $( "#"+id).unbind( "click" );
   $('.app_item:not("#'+id+'")').addClass('blur');

   $('.app_add').addClass('blur');
   $('#'+id+' .deleteApp').show();
   $('#'+id).css('z-index', '1001');
   $('.filter').on('click', function(){
       $('.filter').hide();
       $('#'+id+' .deleteApp').hide();
       $('#'+id).css('z-index', '1');
       $('#'+id).click(launch(id));
       $('.app_add').removeClass('blur');
       $('.app_item').removeClass('blur');
   });
   $('.deleteApp').click(function(){
       fabmo.deleteApp(id, function(err, data){
           if (err){
               console.log(err);
           } else {
               var ind = order.indexOf(id);

               order.splice(ind,1);
               fabmo.getAppConfig(function(err, data){
                   data.appOrder = order;
                   fabmo.setAppConfig(data, function(err, data){
                       if (err){
                           console.log(err)
                       } else {
                            $('#'+id).remove();
                            $('.filter').hide();
                            $('.app_add').removeClass('blur');
                            $('.app_item').removeClass('blur');
                       }
                   });
               });
           }
       });
   })
}


function getsetFabmoCongif (){

}


function startBusy() {
  $("#add span").removeClass('fa-plus').addClass('fa-cog fa-spin');
}

function stopBusy() {
  $("#add span").removeClass('fa-cog fa-spin').addClass('fa-plus');
}

function setupDropTarget() {
  $('#tabpending').dragster({
    enter: function(devt, evt) {
      $('#tabpending').addClass('hover');
      return false;
    },

    leave: function(devt, evt) {
      $('#tabpending').removeClass('hover');
      return false;
    },
    drop: function(devt, evt) {
      evt.preventDefault();
      try {
        file = evt.originalEvent.dataTransfer.files;
        if(file.length > 0) {
          fabmo.submitJob(file, {}, function(err, data) {
            if (err) {
              fabmo.notify('error', err);
            }
            updateQueue();
          });
        }
      } finally {
        $('#tabpending').removeClass('hover');
        return false;
      }
    }
  });
}

