sbp_parser = require('./sbp_parser')
var log = require('../../log').logger('sbp');
var CMD_SPACE_RE = /(\w\w)([ \t]+)([^\s\t,].*)/i
var CMD_RE = /^\s*(\w\w)(((\s*,\s*)([+-]?[0-9]+(\.[0-9]+)?)?)+)\s*$/i

fastParse = function(statement) {
    var match = statement.match(CMD_SPACE_RE);
    if(match) {
        if(match[1] != 'IF') {
            statement = statement.replace(CMD_SPACE_RE, function(match, cmd, space, rest, offset, string) {
                return cmd + ',' + rest;
            });
        }
    }

    match = statement.match(CMD_RE);
    if(match) {
        if(match[1] === 'IF') {
            return null
        }
        retval = {
            type : 'cmd',
            cmd : match[1],
            args : []
        }
        args = match[2].split(',');
        args.slice(1).forEach(function(arg) {
            if(arg.trim() === '') {
                retval.args.push(undefined);
            } else {
                var n = Number(arg);
                retval.args.push(isNaN(n) ? arg : n);
            }
        });
        return retval;
    }
    return null;
}

parseLine = function(line) {
    line = line.replace(/\r/g,'');
    parts = line.split("'");
    statement = parts[0]
    comment = parts.slice(1,parts.length)
    
    
    // Use parse optimization
    var obj = fastParse(statement) ||  sbp_parser.parse(statement);
    //var obj = sbp_parser.parse(statement);

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
            
            var start = new Date().getTime();
            var obj = parse(data);
            var end = new Date().getTime();
            var time = end - start;

            console.log(JSON.stringify(obj, null, ' '));
            console.log('Parse time: ' + time);

        });
    } else {
        console.log("Usage: node parser.js filename.sbp");
    }
}

if (require.main === module) {
    main();
}

