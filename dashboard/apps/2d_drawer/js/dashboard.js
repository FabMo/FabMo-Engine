var FabMoDashboard = function() {
	this.target = window.parent;
}

FabMoDashboard.prototype.postMessage = function(msg) {
	this.target.postMessage(msg, '*');
}

FabMoDashboard.prototype.showDRO = function() {
	this.postMessage({"showDRO":true});
}

FabMoDashboard.prototype.hideDRO = function() {
	this.postMessage({"showDRO":false});
}

FabMoDashboard.prototype.submitJob = function(data, config) {
	this.postMessage({"job":{'data' : data, 'config' : config || {} }});
}

FabMoDashboard.prototype.getMachine = function(callback) {
	console.log("Getting the machine");
 	window.addEventListener('message', function (e) {
 		callback(null, e.data);
    }.bind(this));
	this.postMessage({"getMachine":true})
}

fabmoDashboard = new FabMoDashboard();