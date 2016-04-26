/* Example definition of a simple mode that understands a subset of
 * JavaScript:
 */

CodeMirror.defineSimpleMode("gcode", {
  // The start state contains the rules that are intially used
  start: [
    {regex: /[GM]\d+/i, token: "keyword"},
    // You can match multiple tokens at once. Note that the captured
    // groups must span the whole string in this case
    {regex: /([A-FH-LN-Z])([+\-]?[0-9]+(?:\.[0-9]+)?)/i,
     token: ["variable", "number"]},
    {regex: /\?.*/, token: "comment"},
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

var CMD_REGEX = /^[A-Z](?:[A-Z]|[0-9]+|\#)\b/i
var LABEL_REGEX = /^[A-Z_][A-Z0-9_]*\:/i
var WORD_REGEX = /^[A-Z_][A-Z0-9_]*/i
var STRING_REGEX = /^"(?:[^\\]|\\.)*?"/
var NUMBER_REGEX = /^0x[a-f\d]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i

CodeMirror.defineMode("opensbp", function() {
  return {
    startState: function() {
      return {
        name : "sol"
      }
    },

    token: function(stream, state) {
      if(stream.eol()) {
            console.log("END OF ARGS")
            state.name = "sol";
            stream.next();
            return null;          
      }

      switch(state.name) {
        case "sol":
          console.log("sol")
          if(stream.eatSpace()) {
            return null;
          }

          if(stream.match(CMD_REGEX)) {
            state.name = "args";
            return "keyword";
          } 

          if(stream.match(LABEL_REGEX)) {
            state.name = null;
            return "variable";
          }

          if(stream.match("PAUSE")) {
            state.name = "pause";
            return "keyword"
          }

          if(stream.match(/^GOTO|GOSUB/)) {
            state.name = "goto";
            return "keyword"
          }

          stream.skipToEnd();
//          if(!stream.eol()) {
//            stream.skipToEnd();
//          }            
        break;

        case "args":

          if(stream.eat(',') || stream.eatSpace()) {
            return null
          }
          
          if(stream.match(NUMBER_REGEX)) {
            console.log("number");
            return "number";
          }

          if(stream.match(STRING_REGEX)) {
            console.log("string");
            return "string";
          }      

        break;

        case "goto":
          if(stream.eatSpace()) { return null; }
          if(stream.match(WORD_REGEX)) {
            return "variable";
          }                
        break;

        default:
          console.log("onoes")
        break;
      }

     /* 
      if(!stream.eol()) {
        console.log("skipping to end")
        console.log(stream)
        stream.skipToEnd();
      }*/

//      stream.next();
      console.log("setting the state name back to sol")
        state.name = "sol";
        return null;

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
