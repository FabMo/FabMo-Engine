var log = require("../../../log").logger("sbp");
var config = require("../../../config");

/* FILES */

/* ####** probably don't need this */

// Set to table base coordinates
exports.FL = function (args, callback) {
    //     fabmo.submitJob({
    //         file : text,
    //         filename: filename,
    //         name : name,    // just letting this float for the moment, make name without ext to be easily available
    //         description: description
    //       },
    //       function(err, result) {
    //         if(err) {
    //           if(err.message) {
    //             fabmo.notify('error', err.message);
    //           } else if(err.job) {
    //             fabmo.notify('warn', err.job);
    //           } else {
    //             fabmo.notify('error', err);
    //           }
    //         } else {
    //           fabmo.launchApp('job-manager');
    //         }
    //       }
    //     );

    //     $('#jobsubmit-modal').foundation('reveal', 'close');
    //     $("#jobsubmit-form").trigger('reset');
    //   };
    if (this.machine) {
        var toRun = this.lastFilename;
        if (toRun) {
            this._pushFileStack();
            this.runFile(toRun);
        } else {
            throw new Error("Can't run last file; lost?");
        }
    } else {
        callback();
    }
    return true;
};

exports.FR = function (args, callback) {
    this.getJobHistory(args[0], callback);
};
