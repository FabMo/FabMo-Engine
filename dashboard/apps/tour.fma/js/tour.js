require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

var currentLeft = 0;

var content = [
    {"image": 'images'}
]
$( document ).ready(function() {

var cardWidth = $(window).width();
$('.tour-card').css('width', cardWidth);

$('.next').click(function(){
    console.log(cardWidth);
    currentLeft = currentLeft - cardWidth;
    console.log(currentLeft);
    $('.tour-card').css('left', currentLeft + "px");

});

$('.prev').click(function(){
    currentLeft = currentLeft + cardWidth;
    $('.tour-card').css('left', currentLeft + "px");
});

});