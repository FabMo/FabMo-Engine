require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

var tour = document.getElementById('tour-container');

var currentLeft = 0;
var counter = 0;

var content = [
    {
        "id": "1",
        "image": "images/Handibot.png",
        "header": "Welcome to Fabmo",
        "text": "We are excited to get you up and running with your Handibot",
        "actionText" : "",
        "action": ""
 
    },
     {
        "id": "2",
        "image": "images/obama.gif",
        "header": "First Raise Height of the Z-axis",
        "text": "Your Handibot will hit it's Z-Max and make a loud noise. This is normal.",
        "actionText" : "Raise Z",
        "action": function() {fabmo.runSBP('ZZ\nMZ,4')}
    },
     {
        "id": "3",
        "image": "images/giphy.gif",
        "header": "Remove Protective Foam",
        "text": "There is a cylindrical  piece of foam around the router bit. Please remove this",
        "actionText" : "",
        "action": ""
    },
    {
        "id": "4",
        "image": "images/obama.gif",
        "header": "Home Your Tool",
        "text": "Next we will set your X, Y, & Z Zero locations. Make sure your area is clear because the tool will start to move.",
        "actionText" : "Set Zeros",
        "action": function() {fabmo.runSBP('C#,3')}
    },
    {
         "id": "5",
        "image": "images/giphy.gif",
        "header": "Remeasure Cutting Length",
        "text": "Next we remeasure your cutting bit length. We did this at the factory, but things can move in shipping and it's good to learn how to do. This will ensure that your Z-Zero is correct.",
        "actionText" : "Measure Cutting Length",
        "action": function() {fabmo.runSBP('C#,2')}
    },
    {
        "id": "6",
        "image": "images/obama.gif",
        "header": "Run Test File",
        "text": "Finally we are going to run a test cut. We did this cut at the factory so you can compare your cut with our cut. Clicking the button will submit a job and take you to the Job Manager, where you can continue the tour",
        "actionText" : "Submit Test Cut",
        "action": function() {DoJobFile()}
    },


]


var cardWidth = $(window).width();

$( document ).ready(function() {
    
    if ( counter < content.length -1) {
    setNext(content[counter + 1], counter + 1);
    counter++
    checkCounter();
}

$('.tour-card').css('width', cardWidth);



});

$( window ).resize(function() {
    var cardWidth = $(window).width();
    var numItems = $('.tour-card').length;
    console.log(numItems);
    var newContainer = numItems*cardWidth;
    console.log(newContainer);
    console.log(cardWidth);
    $('.tour-card').css('width', cardWidth);
    $('#tour-container').css('width', newContainer);


});

$('.next').click(function(){
    if (counter != (content.length - 1)){

     
            setNext(content[counter+1], counter+1);

        counter++;    
} else if(counter === content.length -1 ){
    counter++;    
}
    
    currentLeft = currentLeft - cardWidth;

    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(400).hide(0);

});

$('.prev').click(function(){
    if (counter !=  1){
        counter--;
    }
    currentLeft = currentLeft + cardWidth;
    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(500).hide(0);
});


function setNext(obj, counter){
    var id = obj.id;
    var tourItem = document.createElement("li");
    tourItem.setAttribute("id", "");
    tourItem.setAttribute("class", "tour-card");
    if (obj.action) {
        tourItem.innerHTML = '<div class="slide-next"></div><div class="image-container"><img  src='+obj.image+'></div><div class="content"><h4>'+obj.header+'</h4><span>'+obj.text+'</span><div class="card-action" id='+id+'>'+obj.actionText+'</div></div>';
       $(document).on('click', '#'+id , function() {
            obj.action();
        });
    } else {
        tourItem.innerHTML = '<div class="slide-next"></div><div class="image-container"><img  src='+obj.image+'></div><div class="content"><h4>'+obj.header+'</h4><span>'+obj.text+'</span></div>';
    }

    
    tour.appendChild(tourItem);
    $('.tour-card').css('width', cardWidth);
    
};

function DoJobFile () {
  var sbp = "";
  var jobPath = 'jobs/test_carve.sbp';
  
  jQuery.get(jobPath, function(data) {
      sbp += data;
    })
    .done(function() {
      jobPath = jobPath.replace('jobs/', '');
      jobPath = jobPath.replace('.sbp', '');
    // sbp += 'end\n';
    // sbp += "'a FabMo load\n";
      fabmo.submitJob({
        file: sbp,
        filename: 'test_carve' + '.sbp',
        name: "test_01",
        description: "First File: " + jobPath
      });
    })
}

function checkCounter() {
    if (counter == 1) {
        $('.prev').hide();
    } else if (counter == content.length ) {
         $('.next').hide();

    } else {
        $('.prev').show();
        $('.next').show();
    }
}
