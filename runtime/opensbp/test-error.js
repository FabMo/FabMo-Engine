// test-error.js
function testErrorCreation(message) {
    var error = new Error(message);
    console.log(error);
}

testErrorCreation("Test message");
