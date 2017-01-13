require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

var tour = document.getElementById('tour-container');

var currentLeft = 0;
var counter = 0;

var content = [
    {
        "image": "images/Handibot.png",
        "header": "Welcome to Fabmo",
        "text": "We are excited to get you up and running with your Handibot",
        "actionText" : "",
        "action": ""
    },
     {
        "image": "images/obama.gif",
        "header": "First Raise Height of the Z-axis",
        "text": "Your Handibot will hit it's Z-Max and make a loud noise. This is normal",
        "actionText" : "Raise Z",
        "action": "fabmo.runSBP('ZZ\nMZ,4');"
    },
     {
        "image": "images/giphy.gif",
        "header": "Remove Protective Foam",
        "text": "There is a cylindrical  piece of foam around the router bit. Please remove this",
        "actionText" : "",
        "action": ""
    },
    {
        "image": "images/obama.gif",
        "header": "Home Your Tool",
        "text": "Next we will set your X, Y, & Z Zero locations. Make sure your area is clear because the tool will start to move.",
        "actionText" : "Set Zeros",
        "action": "fabmo.runSBP('C#,3');"
    },
    {
        "image": "images/giphy.gif",
        "header": "Remeasure Cutting Length",
        "text": "Next we remeasure your cutting bit length. We did this at the factory, but things can move in shipping and it's good to learn how to do. This will ensure that your Z-Zero is correct.",
        "actionText" : "Measure Cutting Length",
        "action": "fabmo.runSBP('C#,2');"
    },
    {
        "image": "images/obama.gif",
        "header": "Run Test File",
        "text": "Finally we are going to run a test cut. We did this cut at the factory so you can compare your cut with our cut. Clicking the button will submit a job and take you to the Job Manager, where you can continue the tour",
        "actionText" : "Submit Test Cut",
        "action": "DoJobFile();"
    },


]

console.log(content.length);
var cardWidth = $(window).width();

$( document ).ready(function() {
    checkCounter();
    if ( counter < content.length -1) {
    setNext(content[counter + 1]);
}

$('.tour-card').css('width', cardWidth);



});

$( window ).resize(function() {
    var cardWidth = $(window).width();
    $('.tour-card').css('width', cardWidth);
});

$('.next').click(function(){
    if (counter != content.length){
    counter++;
        if (counter != content.length){
            setNext(content[counter]);
        }
    } 
    currentLeft = currentLeft - cardWidth;
    console.log(currentLeft);
    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(400).hide(0);

});

$('.prev').click(function(){
    if (counter !=  0){
        counter--;
    }
    currentLeft = currentLeft + cardWidth;
    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(400).hide(0);
});


function setNext(obj){
    console.log(obj)
    var tourItem = document.createElement("li");
    tourItem.setAttribute("id", "");
    tourItem.setAttribute("class", "tour-card");
    tourItem.innerHTML = '<div class="slide-next"></div><div class="image-container"><img  src='+obj.image+'></div><div class="content"><h4>'+obj.header+'</h4><span>'+obj.text+'</span></div>'

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
      console.log("job submitted");
      fabmo.submitJob({
        file: sbp,
        filename: 'test_carve' + '.sbp',
        name: "test_01",
        description: "First File: " + jobPath
      });
    })
}

function checkCounter() {
    if (counter == 0) {
        $('.prev').hide();
    } else if (counter == content.length ) {
         $('.next').hide();

    } else {
        $('.prev').show();
        $('.next').show();
    }
}
