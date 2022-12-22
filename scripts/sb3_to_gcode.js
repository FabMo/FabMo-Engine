var SBPRuntime = require("../runtime/opensbp").SBPRuntime;
var config = require("../config");
var fs = require("fs");

var input_file = process.argv[2];
var output_file = process.argv[3];

config.configureOpenSBP(function () {
    config.configureDriver(null, function () {
        var runtime = new SBPRuntime();
        runtime.loadCommands(function (err) {
            if (!err) {
                fs.readFile(input_file, function (err, data) {
                    if (!err) {
                        runtime.on("end", function (data) {
                            fs.writeFile(output_file, data.join("\n"));
                        });
                        runtime.runString(String(data));
                    }
                });
            }
        });
    });
});
