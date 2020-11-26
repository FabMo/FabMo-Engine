/* Example definition of a simple mode that understands a subset of
 * JavaScript:
 */
var CodeMirror = require('./codemirror.js');

CodeMirror.defineSimpleMode("gcode", {
  // The start state contains the rules that are intially used
  start: [
    {regex: /\([^\)]*\)/i, token: "comment"},
    {regex: /[GM]\d+/i, token: "keyword"},
    // You can match multiple tokens at once. Note that the captured
    // groups must span the whole string in this case
    {regex: /([A-FH-LN-Z])([+\-]?[0-9]+(?:\.[0-9]+)?)/i,
     token: ["variable", "number"]},
    {regex: /\?.*/, token: "comment"},
    {regex: /[^\w\s]/, token: "error"}
  ],
  // The meta property contains global information about the mode. It
  // can contain properties like lineComment, which are supported by
  // all modes, and also directives like dontIndentStates, which are
  // specific to simple modes.
  meta: {
    dontIndentStates: ["comment"],
    lineComment: "?"
  }
});

var CMD_REGEX = /^[A-Z](?:[A-Z]|[0-9]+|C\#)\b/i
var LINENO_REGEX = /^N[0-9]+\b/i
var LABEL_REGEX = /^[A-Z_][A-Z0-9_]*\:/i
var WORD_REGEX = /^[A-Z_][A-Z0-9_]*/i
var STRING_REGEX = /^"(?:[^\\]|\\.)*?"/
var NUMBER_REGEX = /^0x[a-f\d]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i
var SYS_VAR_REGEX = /^\%\([ \t]*[0-9]+[ \t]*\)/i
var USR_VAR_REGEX = /^\&[A-Z_][A-Z0-9_]*/i
var PERSIST_VAR_REGEX = /^\$[A-Z_][A-Z0-9_]*/i

var BARE_REGEX = /^[IOT]/i
var COMMENT_REGEX = /^'.*/i
var OPERATOR_REGEX = /^[\+\-\*\/\^\!\(\)\=\>\<|\=\:]/i

function matchExpression(stream) {
  if(stream.match(SYS_VAR_REGEX)) {
    return "variable";
  }
  if(stream.match(USR_VAR_REGEX)) {
    return "variable-2";
  }
  if(stream.match(PERSIST_VAR_REGEX)) {
    return "variable-3";
  } 
  if(stream.match(NUMBER_REGEX)) {
    return "number";
  }
  if(stream.match(STRING_REGEX)) {
    return "string";
  }
  if(stream.match(OPERATOR_REGEX)) {
    return "operator";
  }
  return null;
}

function matchArgument(stream) {
  var match = matchExpression(stream);
  if(match) { return match; }
  if(stream.match(BARE_REGEX)) { return "atom"; }
  return null;
}

CodeMirror.defineMode("opensbp", function() {
  return {
    startState: function() {
      return {
        name : "sol",
      }
    },

    token: function(stream, state) {
      if(stream.sol()) {
        state.name = "sol";
      }

      if(stream.eatSpace()) {
        return null;
      }
      if(stream.eat("'")) {
        stream.skipToEnd();
        return 'comment';
      }
      switch(state.name) {
        case "sol":
          if(stream.eatSpace()) {
            return null;
          }

          // Line Comment
          if(stream.match(COMMENT_REGEX)) {
            return "comment";
          }

          // ON INPUT statement
          if(stream.match("ON")) {
            state.name = "on";
            return "keyword";
          } 

          // LHS of an assignment
          if(stream.match(SYS_VAR_REGEX)) {
            state.name = "assign";
            return "variable";
          } 

          if(stream.match(USR_VAR_REGEX)) {
            state.name = "assign";
            return "variable-2";
          } 

          if(stream.match(PERSIST_VAR_REGEX)) {
            state.name = "assign";
            return "variable-3";
          } 

          // Label (for GOTOs)
          if(stream.match(LABEL_REGEX)) {
            return "property";
          }

          if(stream.match(/^IF/i)) {
            state.name = "test";
            return "keyword"
          }

          if(stream.match(LINENO_REGEX)) {
          	state.name = "gcode";
          	return "property";
          }
          // Command mnemonic
          if(stream.match(CMD_REGEX)) {
            state.name = "args";
            return "keyword";
          } 

          // Pause command
          if(stream.match(/^PAUSE\s*/i)) {
            state.name = "args";
            return "keyword"
          }

          // Pause command
          if(stream.match(/^FAIL/i)) {
            state.name = "fail";
            return "keyword"
          }

          // Goto commands
          if(stream.match(/^GOTO|GOSUB/i)) {
            state.name = "goto";
            return "keyword"
          }

          // Singles
          if(stream.match(/^RETURN|END/i)) {
            state.name = "single";
            return "keyword";
          }
          //
          stream.skipToEnd();
        break;

        case "single":

        break;

        case "args":
          if(stream.eat(',')) {
            return null
          }
          var match = matchArgument(stream);
          if(match) { return match; }

        break;

        case "assign":
          var match = matchExpression(stream);
          if(match) { return match;}
          stream.skipToEnd();
          return 'string';

        break;

        case "test":
          var match = matchExpression(stream);
          if(match) { return match;}
          if(stream.match(/^THEN/i)) {
            return "keyword";
          }        
          if(stream.match(/^GOTO|GOSUB/i)) {
            state.name = "goto"
            return "keyword";
          }        
          if(stream.match(LABEL_REGEX)) {
            return "property";
          }
        break;

        case "goto":
          if(stream.match(WORD_REGEX)) {
            state.name = "sol"
            return "property"            
          }                
        break;

        case "on":
          if(stream.eat(',')) {
            return null;
          }          
          if(stream.match(/INP(?:UT)?/i)) {
            return "keyword";
          }   
          if(stream.match(/(?:GOTO)|(?:GOSUB)/i)) {
            state.name = "goto"
            return "keyword";
          }   
          if(stream.match(/\(|\)/)) {
            return "operator";
          }
          if(stream.match(/\d+/)) {
            return "number";
          }
          break;

        case "pause":
          if(stream.eatSpace()) {
            return null;
          }

          var match = matchExpression(stream);
          if(match) { return match; }
          
          break;

        case "fail":
          if(stream.eatSpace()) {
            return null;
          }

          var match = matchExpression(stream);
          if(match) { return match; }
          
          break;

        default:
          console.error("Unknown state: ", state)
        break;

        case "gcode":
        	stream.skipToEnd();
        	return null;
        break;
      }

      stream.next();
      return "error";

    }
  }
});
CodeMirror.defineMIME("text/x-opensbp","opensbp")

/*

CodeMirror.defineSimpleMode("opensbp", {
  // The start state contains the rules that are intially used
  start: [
    {regex: /\s*[A-Z](?:[A-Z]|[0-9]+|\#)\b/i, token: "keyword", next:"args", sol: true},
    {regex: /PAUSE/i, token: "keyword", next:"args"},

    // You can match multiple tokens at once. Note that the captured
    // groups must span the whole string in this case
    //{regex: /([A-FH-LN-Z])([+\-]?[0-9]+(?:\.[0-9]+)?)/i,
    // token: ["variable", "number"]},
    {regex: /\'., token: "comment"},
  ],

  args: [
    {regex: /,/i, token: "operator"},
    {regex: /"(?:[^\\]|\\.)*?"/, token: "string"},
    {regex: /[+\-]?[0-9]+(?:\.[0-9]+)?/i, token: "number"},
    {regex: /[^\t ,]/, next: "start"}
  ],
  // The meta property contains global information about the mode. It
  // can contain properties like lineComment, which are supported by
  // all modes, and also directives like dontIndentStates, which are
  // specific to simple modes.
  meta: {
    dontIndentStates: ["comment"],
    lineComment: "'"
  }
});*/
