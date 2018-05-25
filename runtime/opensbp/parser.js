var stream = require('stream');
var util = require('util');

var sbp_parser = require('./sbp_parser')
var log = require('../../log').logger('sbp');
var CMD_SPACE_RE = /(\w\w)([ \t]+)([^\s\t,].*)/i
var CMD_RE = /^\s*(\w\w)(((\s*,\s*)([+-]?[0-9]+(\.[0-9]+)?)?)+)\s*$/i
var STUPID_STRING_RE = /(\&[A-Za-z]\w*)\s*=([^\n]*)/i

fastParse = function(statement) {
    var match = statement.match(CMD_RE);
    if(match) {
        if(match[1] === 'IF') {
            return null
        }
        var retval = {
            type : 'cmd',
            cmd : match[1],
            args : []
        }
        var args = match[2].split(',');
        var pargs = args.slice(1);
    for(var i=0; i<pargs.length; i++) {
        var arg = pargs[i]
            if(arg.trim() === '') {
                retval.args.push(undefined);
            } else {
                var n = Number(arg);
                retval.args.push(isNaN(n) ? arg : n);
            }
    }
        return retval;
    }

    var match = statement.match(CMD_SPACE_RE);
    if(match) {
        if(match[1] != 'IF') {
            statement = statement.replace(CMD_SPACE_RE, function(match, cmd, space, rest, offset, string) {
                return cmd + ',' + rest;
            });
        }
    }
    return null;
}

parseLine = function(line) {
    line = line.replace(/\r/g,'');

    // Extract comment
    parts = line.split("'");
    statement = parts[0]
    comment = parts.slice(1,parts.length)

    try {
        // Use parse optimization
        var obj = fastParse(statement)
    if(!obj) {
	//log.warn('Cant fastparse ' + statement)
    	obj = sbp_parser.parse(statement);
    }
        //var obj = sbp_parser.parse(statement);        
    } catch(e) {
        log.error(e)
	var match = statement.match(STUPID_STRING_RE)
        if(match) {
            obj = {type:"assign",var:match[1], expr:match[2]}
        }
    }
    
    if(Array.isArray(obj) || obj === null) {
        obj = {"type":"comment", "comment":comment};
    } else {
        if(comment != '') {obj.comment = comment}
    }
    if(obj.type == 'cmd') {
        obj.cmd = obj.cmd.toUpperCase();
    }

//    console.log(obj)
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

function Parser(options) {
    var options = options || {};
    options.objectMode = true;

  // allow use without new
  if (!(this instanceof Parser)) {
    return new Parser(options);
  }
  this.scrap = ""
  // init Transform
  stream.Transform.call(this, options);
}
util.inherits(Parser, stream.Transform);

Parser.prototype._transform = function(chunk, enc, cb) {
    var str = this.scrap + chunk.toString()
    this.pause();
    try {  
      var start = 0;
      for(var i=0; i<str.length; i++) {
            if(str[i] === '\n') {
                var substr = str.substring(start, i)
                this.push(parseLine(substr));
                start = i+1;
            }
        }
        this.scrap = str.substring(start)
    } catch(e) {
        log.error(e)
    }
    this.resume();
    cb();

}

Parser.prototype._flush = function(done) {
  if (this.scrap) { this.push(parseLine(scrap)); }
  this.scrap = '';
  done();
};



parseStream = function(s, options) {
    var parser = new Parser(options);
    return s.pipe(parser)
}

parseFile = function(filename, callback) {
	var st = fs.createReadStream(filename);
	var obj = []
        return parseStream(st)
            .on('data', function(data) {
                obj.push(data)
            })
            .on('end', function() {
            	callback(null, obj);
	    })
	    .on('error', function(err) {
		callback(err);
	    });
}

var main = function(){
    var argv = require('minimist')(process.argv);
    var fs = require('fs');
    var filename = argv['_'][2]

    if(filename) {
        log.tick();
        fs.readFile(filename, 'utf8', function(err, data) {
            if(err) {
                return console.log(err);
            } 
            
            var obj = parse(data);
            log.tock('parse');
        });
    } else {
        console.log("Usage: node parser.js filename.sbp");
    }
}

var main2 = function() {
    var argv = require('minimist')(process.argv);
    var fs = require('fs');
    var filename = argv['_'][2]
    if(filename) {
        log.tick();
        var fileStream = fs.createReadStream(filename);
        var obj = []
        parseStream(fileStream)
            .on('data', function(data) {
                obj.push(data)
            })
            .on('end', function() {
		console.log(obj.length + ' lines processed.')
		log.tock("parse");
            });
    }
}

if (require.main === module) {
//    main();
    main2();
}

exports.parse = parse
exports.parseFile = parseFile
exports.parseStream = parseStream
