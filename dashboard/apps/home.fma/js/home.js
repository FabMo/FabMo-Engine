require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');;
var Fabmo = require('../../../static/js/libs/fabmo.js');
var Sortable = require('./Sortable.js');
var fabmo = new Fabmo;
var order = [];
var notApp = [];
var newOrder = [];




setupAppManager();

    



function launch( id ){
    return function(){
        fabmo.launchApp(id);
    }
}

function getOrder () {
    return new Promise (function(resolve, reject){
        fabmo.getAppConfig(function(err, data){
            if (data){
                if (data.appOrder) {
                    order = data.appOrder;
                } 
                resolve(data);
            } else {
                reject(Error(err));
            }
        });
    })

}



function refreshApps() {
    newOrder = [];
    return new Promise (function(resolve, reject){


        getOrder().then(function(){
                    fabmo.getApps(function(err,apps){
        if (apps) {
            var menu = document.getElementById('app_menu_container');
            menu.innerHTML = "";
            var file = document.getElementById('file');
            file.value = "";
            for (var i = 0; i < order.length; i++) {
                var obj = findById(apps, order[i]);
                if (typeof obj != "undefined") {
                    newOrder.push(obj.id);
                }
            };

                for (var i = 0; i < apps.length; i++) {
                    if (apps[i].icon_display !== "none") {
                        if ( ($.inArray(apps[i].id, order)) > -1 ) {
                            
                        } else {
                            newOrder.push(apps[i].id);
                        }
                    }
                }

                for (var i = 0; i < notApp.length; i++) {
                    if ( $.inArray(notApp[i], newOrder) > -1 ) {
                        var ind = newOrder.indexOf(notApp[i]);
                        newOrder.splice(ind,1);
                    }
                }

                var noDupesArr = (function(arr){
                    var m = {}, noDupesArr = []
                    for (var i=0; i<arr.length; i++) {
                      var v = arr[i];
                      if (!m[v]) {
                        noDupesArr.push(v);
                        m[v]=true;
                      }
                    }
                    return noDupesArr;
                })(newOrder);

                for (var i = 0; i < noDupesArr.length; i++) {
                    var obj = findById(apps, noDupesArr[i]);
                    makeListItem(menu, obj);
                }

            
            fabmo.getAppConfig(function(err, data){
                data.appOrder = newOrder;
                fabmo.setAppConfig(data, function(err, data){

                }) 
            });


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
            $('.app_item').on('mousedown touchstart',  function(e) {
                timeoutId = setTimeout(function(){
                    holdfunction(e);
                }, 1500);
            }).on('mouseup mouseleave touchend', function(e) {
                clearTimeout(timeoutId);
            });
            
            
            resolve(apps);
        } else {
            reject(Error(err));
        }
        return order;
    });

        });

    });

}

function makeListItem (menu, obj) {

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
    if (source[i].id === id) {

      return source[i];
    } else if ( i === (source.length - 1) )
        notApp.push(id);
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

                    fabmo.notify('success', data.length + " app" + ((data.length > 1) ? 's' : '') + " installed successfully.");
                    newOrder.push(data[0].info.id);
                    fabmo.getAppConfig(function(err, data){
                        data.appOrder = newOrder;
                        fabmo.setAppConfig(data, function(err, data){
                            if (err) {
                                console.log(err);
                            }else {
                                refreshApps().then(function(apps){
                                    setUpSort();
                                });
                            }
                        }) 
                     });
                    
                }
                
            });

        });

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
       var ind = newOrder.indexOf(id);
               newOrder.splice(ind,1);
       fabmo.deleteApp(id, function(err, data){
           if (err){
               console.log(err);
           } else {
               
               fabmo.getAppConfig(function(err, data){
                   data.appOrder = newOrder;
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