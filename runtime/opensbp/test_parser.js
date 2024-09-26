const parser = require("./sbp_parser");

// Test inputs
const testInputs = ["&var=2", "$tools[1].x = 100", "$config.settings.speed = 500", "$unknown[5]"];

// Function to test parsing of inputs
function testParser(inputs) {
    inputs.forEach((input) => {
        try {
            const result = parser.parse(input);
            console.log(`Input: ${input}`);
            console.log("Parsed Output:", JSON.stringify(result, null, 2));
        } catch (e) {
            console.error(`Error parsing input "${input}":`, e.message);
            console.error("Expected:", e.expected);
            console.error("Found:", e.found);
            console.error("Location:", e.location);
        }
        console.log("------------------------------------");
    });
}

// Run the test
testParser(testInputs);