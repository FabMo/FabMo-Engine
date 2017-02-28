require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

var tour = document.getElementById('tour-container');

var currentLeft = 0;
var counter = 0;
var cardWidth = $(window).width();

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
        "video": "images/foam1.mp4",
        "header": "First Raise Height of the Z-axis",
        "text": "Your Handibot will hit it's Z-Max and make a loud noise. This is normal. Remove the protective foam circle.",
        "actionText" : "Raise Z",
        "action": function() {fabmo.runSBP('ZZ\nMZ,4')}
    },
    {
         "id": "3",
        "video": "images/cutterlength2.mp4",
        "header": "Remeasure Cutting Length",
        "text": "Next we remeasure your cutting bit length. We did this at the factory, but things can move in shipping and it's good to learn how to do. This will ensure that your Z-Zero is correct. You will also want to do this everytime you change bits.",
        "actionText" : "Measure Cutting Length",
        "action": function() {fabmo.runSBP('C#,2')}
    },
    {
        "id": "4",
        "video": "images/home1.mp4",
        "header": "Home Your Tool",
        "text": "Your X, Y, & Z are already zeroed from the last step, but lest's say you accidentally crashed your tool into your X, Y, or Z. This will cause your tool to loose position. If you haven't changed your bit you can just home it to re-zero your axes. Lets show you what that looks like.",
        "actionText" : "Set Zeros",
        "action": function() {fabmo.runSBP('C#,3')}
    },
    {
        "id": "5",
        "video": "images/testcut.mp4",
        "header": "Run Test File",
        "text": "Finally we are going to run a test cut. We did this cut at the factory so you can compare your cut with our cut too make sure that . Clicking the button will submit a job and take you to the Job Manager, where you can continue the tour",
        "actionText" : "Submit Test Cut",
        "action": function() {DoJobFile()}
    },

]




$( document ).ready(function() {
    
    if ( counter < content.length -1) {
    setNext(content[counter + 1], counter + 1);
    counter++
    checkCounter();
    $('.tour-card').css('width', cardWidth);
    $('.tour-decloration').click(function(){
        fabmo.launchApp('home');
    });
}





});

$( window ).resize(function() {
    var currentItem;
    cardWidth = $(window).width();
    var numItems = $('.tour-card').length;
    var newContainer = numItems*cardWidth;
    $('.tour-card').css('width', cardWidth);
    
    // $('.marker').each(function(){
    //     if (isElementInViewport ($(this))) {
    //         currentItem = parseInt($(this).parent().attr('id'));
    //         console.log(currentItem);
    //     } 
        
    // });

    currentLeft = -((counter-1)*cardWidth);
$('#tour-container').css({'width': newContainer,  'left': currentLeft + 'px'});
});

$('.next').click(function(){
    startVideo();
    if (counter != (content.length - 1)){

     
            setNext(content[counter+1], counter+1);

        counter++;    
} else if(counter === content.length -1 ){
    counter++;    
}
    console.log(cardWidth);
    currentLeft = currentLeft - cardWidth;

    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(400).hide(0);

});

$('.prev').click(function(){
    startVideo();
    if (counter !=  1){
        counter--;
    }
    currentLeft = currentLeft + cardWidth;
    $('#tour-container').css('left', currentLeft + "px");
    checkCounter();
    $('.slide-next').show(0).delay(500).hide(0);
});


function setNext(obj, counter){
    var set = [];
    
    var id = obj.id;
    $('.tour-card').each(function(){
        set.push($(this).attr('id'));
    });
    console.log(set);
    console.log(id);
    if (set.includes(id)){}else{
    var tourItem = document.createElement("li");
    tourItem.setAttribute("id", obj.id);
    tourItem.setAttribute("class", "tour-card");
    if (obj.action && obj.video) {
        tourItem.innerHTML = '<div class="marker"></div><div class="slide-next"></div><div class="image-container"><video loop><source src='+obj.video+' type="video/mp4"></video></div><div class="content"><h4>'+obj.header+'</h4><p>'+obj.text+'</p><div class="card-action" id='+id+'>'+obj.actionText+'</div></div>';
       $(document).on('click', '#'+id , function() {
            obj.action();
        });
    } else {
        tourItem.innerHTML = '<div class="marker"></div><div class="slide-next"></div><div class="image-container"><img  src='+obj.image+'></div><div class="content"><h4>'+obj.header+'</h4><p>'+obj.text+'</p></div>';
    }

    
    tour.appendChild(tourItem);
    $('.tour-card').css('width', cardWidth);
}
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

var visible;
function myFunction(el){
    setTimeout(function(){
       if (isElementInViewport (el)){
           console.log(el);
           el[0].play();
       } else {
           el[0].pause();
           el[0].currentTime = 0;
       }
    }, 600);
}
function startVideo () {
    $('.image-container video').each(function(){
        myFunction($(this));
    });
}


function isElementInViewport (el) {

    //special bonus for those using jQuery
    if (typeof jQuery === "function" && el instanceof jQuery) {
        el = el[0];
    }

    var rect = el.getBoundingClientRect();

    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && /*or $(window).height() */
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) /*or $(window).width() */
    );
}



