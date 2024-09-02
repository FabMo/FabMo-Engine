//..................................... SEND Message to G2 Stream VIA Manual RUNTIME-Raw
function sendG2message (message) {
    console.log("sending ====> ", message);
    fabmo.manualRunGCode(message)
}
