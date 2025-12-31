/* DATA BRIDGE COMMANDS
 * These commands provide a lightweight data messaging system between OpenSBP part files
 * and dashboard applications, enabling data acquisition workflows without requiring
 * full file I/O implementation in the OpenSBP runtime.
 */

var log = require("../../../log").logger("sbp");

/**
 * DATA_SEND - Send data from OpenSBP to dashboard applications
 * Non-blocking: execution continues immediately
 */
exports.DATA_SEND = function (args, callback) {
    if (args.length < 1) {
        return callback(new Error("DATA_SEND requires at least a channel name"));
    }

    var channel = args[0];
    var data = args.slice(1);

    var message = {
        channel: channel,
        data: data,
        timestamp: Date.now(),
        source: 'opensbp',
        position: {
            x: this.posx,
            y: this.posy,
            z: this.posz,
            a: this.posa,
            b: this.posb,
            c: this.posc
        },
        line: this.pc + 1
    };

    if (this.machine) {
        this.machine.emit('data_send', message);
        log.debug('DATA_SEND: channel="' + channel + '" data=' + JSON.stringify(data));
    } else {
        log.warn('DATA_SEND called but no machine connection available');
    }

    callback();
};

/**
 * DATA_REQUEST - Send data and wait for dashboard response
 * BLOCKING: pauses OpenSBP execution until response received
 */
exports.DATA_REQUEST = function (args, callback) {
    if (args.length < 1) {
        return callback(new Error("DATA_REQUEST requires at least a channel name"));
    }

    var channel = args[0];
    var data = args.slice(1);
    var runtime = this;
    var requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    var message = {
        requestId: requestId,
        channel: channel,
        data: data,
        timestamp: Date.now(),
        source: 'opensbp',
        position: {
            x: this.posx,
            y: this.posy,
            z: this.posz,
            a: this.posa,
            b: this.posb,
            c: this.posc
        },
        line: this.pc + 1
    };

    var timeout = 30000;
    var timeoutHandle = null;
    var responseReceived = false;

    var responseHandler = function (response) {
        if (response.requestId !== requestId) {
            return;
        }

        responseReceived = true;
        clearTimeout(timeoutHandle);
        runtime.machine.removeListener('data_response', responseHandler);

        var responseValue = response.data;
        if (typeof responseValue === 'string') {
            responseValue = responseValue.toLowerCase();
            if (responseValue === 'yes' || responseValue === 'true' || responseValue === 'ok') {
                responseValue = 1;
            } else if (responseValue === 'no' || responseValue === 'false' || responseValue === 'cancel') {
                responseValue = 0;
            } else {
                var parsed = parseFloat(responseValue);
                responseValue = isNaN(parsed) ? -1 : parsed;
            }
        }

        runtime._dataRequestResponse = responseValue;
        log.debug('DATA_REQUEST response: channel="' + channel + '" value=' + responseValue);
        callback();
    };

    timeoutHandle = setTimeout(function () {
        if (!responseReceived) {
            runtime.machine.removeListener('data_response', responseHandler);
            runtime._dataRequestResponse = -1;
            log.warn('DATA_REQUEST timeout: channel="' + channel + '"');
            callback(new Error('DATA_REQUEST timeout after ' + timeout + 'ms'));
        }
    }, timeout);

    if (this.machine) {
        this.machine.on('data_response', responseHandler);
        this.machine.emit('data_request', message);
        log.debug('DATA_REQUEST: channel="' + channel + '" data=' + JSON.stringify(data) + ' requestId=' + requestId);
    } else {
        clearTimeout(timeoutHandle);
        callback(new Error('DATA_REQUEST called but no machine connection available'));
    }
};