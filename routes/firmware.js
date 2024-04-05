var upload = require("./util").upload;
var exec = require("child_process").exec;
var engine = require("../engine");

var flashFirmWare = function (req, res, next) {
    upload(req, res, next, function (err, upload) {
        log.info("Upload complete");
        log.info("Processing Manual Update");

        var uploads = upload.files;
        if (uploads.length > 1) {
            log.warn(
                "Got an upload of " +
                    uploads.length +
                    " files for a manual update when only one is allowed."
            );
        }
        var filePath = upload.files[0].file.path;
        var fileName = upload.files[0].file.name;
        log.info(filePath);
        log.info(fileName);
        try {
            if (fileName.match(/.*\.bin/i)) {
                engine.stop("firmware", function () {
                    setTimeout(function () {
                        exec(
                            // **todo: this needs to be drawn from config
                            //"stty -F /dev/ttyACM0 1200",
                            "stty -F /dev/fabmo_g2_motion 1200",
                            function (err, result) {
                                if (err) {
                                    throw new Error(
                                        "Error putting to sleep: " + err
                                    );
                                } else {
                                    console.log("success sleep :" + result);
                                    setTimeout(function () {
                                        exec(
                                            "bossac -w -v " + filePath,
                                            function (err, result) {
                                                if (err) {
                                                    throw new Error(
                                                        "Error flashing: " + err
                                                    );
                                                } else {
                                                    console.log(
                                                        "success flash :" +
                                                            result
                                                    );
                                                    exec(
                                                        "bossac -b",
                                                        function (err, result) {
                                                            if (err) {
                                                                throw new Error(
                                                                    "Error setting boot flag: " +
                                                                        err
                                                                );
                                                            } else {
                                                                console.log(
                                                                    "success boot :" +
                                                                        result
                                                                );
                                                                exec(
                                                                    "bossac -R",
                                                                    function (
                                                                        err,
                                                                        // eslint-disable-next-line no-unused-vars
                                                                        result
                                                                    ) {
                                                                        if (
                                                                            err
                                                                        ) {
                                                                            throw new Error(
                                                                                "Error Reseting: " +
                                                                                    err
                                                                            );
                                                                        } else {
                                                                            console.log(
                                                                                "success restarting"
                                                                            );
                                                                            process.exit(
                                                                                1
                                                                            );
                                                                        }
                                                                    }
                                                                );
                                                            }
                                                        }
                                                    );
                                                }
                                            }
                                        );
                                    }, 2000);
                                }
                            }
                        );
                    }, 2000);
                });
            } else {
                throw new Error("Unknown file type for " + filePath);
            }
            res.json({
                status: "success",
                data: {
                    status: "complete",
                },
            });
        } catch (err) {
            res.json({ status: "error", message: err });
        }
    });
};

module.exports = function (server) {
    server.post("/firmware/update", flashFirmWare);
};
