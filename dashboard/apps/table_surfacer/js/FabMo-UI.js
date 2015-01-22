function FabMoUI() {

};

FabMoUI.prototype.update_status = function(status) {
	if(status.posx != undefined) {
		$('.fabmo-posx').text(status.posx.toFixed(3));
	}
	if(status.posy != undefined) {
		$('.fabmo-posy').text(status.posy.toFixed(3));
	}
	if(status.posz != undefined) {
		$('.fabmo-posz').text(status.posz.toFixed(3));
	}
	if(status.state != undefined) {
		$('.fabmo-state').text(status.state);
	}

}

var FABMOUI = new FabMoUI();
