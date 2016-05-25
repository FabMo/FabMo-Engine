var bonjour = require('bonjour')();

/*
bonjour.find({},function(service){
	console.log('standard : ');
	console.log(service)
});
*/

bonjour.find({type:'fabmo'},function(service){
	console.log('fabmo : ')
	console.log(service)
});

