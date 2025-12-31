var config = require('../config');
var fs = require('fs');
var path = require('path');
var log = require('../log').logger('routes');

module.exports = function(server) {
    // Serve point cloud XYZ files
    server.get('/pointcloud/:filename', function(req, res, next) {
        var filename = req.params.filename;
        
        // Sanitize filename to prevent directory traversal
        if (filename.indexOf('..') !== -1) {
            return res.status(400).send({error: 'Invalid filename'});
        }

        // Construct full path - point cloud files stored in /opt/fabmo
        var filePath = path.join(config.getDataDir(), filename);

        // Check if file exists and is a .xyz file
        if (!filename.endsWith('.xyz')) {
            return res.status(400).send({error: 'Only XYZ files allowed'});
        }

        fs.readFile(filePath, 'utf8', function(err, data) {
            if (err) {
                log.error('Error reading point cloud file: ' + err);
                return res.status(404).send({error: 'Point cloud file not found'});
            }

            res.setHeader('Content-Type', 'text/plain');
            res.send(data);
            next();
        });
    });
};