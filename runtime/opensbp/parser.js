sbp_parser = require('./sbp_parser')
var log = require('../../log').logger('sbp');

parseLine = function(line) {
    line = line.replace(/\r/g,'');
    parts = line.split("'");
    statement = parts[0]
    comment = parts.slice(1,parts.length)
    obj =  sbp_parser.parse(statement)
    if(Array.isArray(obj)) {
    	obj = {"type":"comment", "comment":comment};
    } else {
    	if(comment != '') {obj.comment = comment}
    }
    if(obj.type == 'cmd') {
        obj.cmd = obj.cmd.toUpperCase();
    }
    return obj
}

parse = function(data) {
	output = []
    
    // Parse from a string or an array of strings
    if(Array.isArray(data)) {
        lines = data;
    } else {
        lines = data.split('\n');
    }

    for(i=0; i<lines.length; i++) {
        try {            
            output.push(parseLine(lines[i]))
        } catch(err) {
            if(err.name == 'SyntaxError') {
                log.error("Syntax Error on line " + (i+1))
                log.error("Expected " + JSON.stringify(err.expected) + " but found " + err.found)
                err.line = i+1;
                log.error(err.line)
            } else {
                log.error(err);
            }
            throw err
        }
    }
    return output
}

exports.parse = parse


var main = function(){
    var argv = require('minimist')(process.argv);
    var fs = require('fs');
    var filename = argv['_'][2]
    if(filename) {
        fs.readFile(filename, 'utf8', function(err, data) {
            if(err) {
                return console.log(err);
            } 
            
            console.log(parse(data));                

        });
    } else {
        console.log("Usage: node parser.js filename.sbp");
    }
}

if (require.main === module) {
    main();
}

