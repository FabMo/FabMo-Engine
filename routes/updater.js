// This file launches the fabmo updater utility that runs ocncurently and seperately to the main fabmo process

var log = require("../log").logger("wifi");
var upload = require("./util").upload;
var exec = require("child_process").exec;

// function redirect(req, res, next) {
//     switch(req.method) {
//         case 'GET':
//             var host = req.headers.host.split(':')[0].trim('/');
//             var path = req.params[0];
//             var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
//             res.redirect(302, url, next);
//             break;

//         case 'POST':
//             var host = req.headers.host.split(':')[0].trim('/');
//             var path = req.params[0];
//             var url = 'http://' + host + ':' + (config.engine.get('server_port') + 1) + '/' + path.replace(/^updater\//, '');
//             var response = {'url' : url};
//             res.json(300, response);
//             break;
//     }
// }

var updateFabmo = function (req, res, next) {
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
        console.log(filePath);
        console.log(fileName);
        // res.json({
        //     status: 'success',
        //     data:{
        //         status: 'complete'
        //     }
        // });
        try {
            if (fileName.match(/.*\.tar/i)) {
                // eslint-disable-next-line no-unused-vars
                exec("docker load < " + filePath, function (err, result) {
                    if (err) {
                        console.log("hey there was an error loading fabmo");
                    } else {
                        console.log(
                            "we loaded the fabmo hopefull watchtower restarts this"
                        );
                    }
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
    server.post("/update/fabmo", updateFabmo);
};
