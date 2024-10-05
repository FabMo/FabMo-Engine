/* Example definition of a simple mode that understands a subset of
 * JavaScript:
 */

/* NOTE(th): This file is a modified version of the codemirror simplemode example file.  It is used to define 
  * the syntax highlighting rules for the OpenSBP language.  The original file can be found here: 
  * 1/16/2024 UPDATES ARE STILL A WORK IN PROGRESS FOR NEW HIGHLIGHT FEATURES ... have added more comments to help understand
  * the processing path of the code.  Also added a few more states to handle the new features.  Still need to refine a few things
  * that are not quite right. 
  */

// This version is 5.14.3 (there is a newer version available); in general v5 is still supported though v6 is the latest
// There is a more sophisticated mode available in codemirror.js

/* Updated CodeMirror mode for OpenSBP with proper handling of variables and access paths */

/* Complete CodeMirror mode for OpenSBP with corrections and all necessary elements */

var CodeMirror = require('./codemirror.js');

// Regular expressions for matching various tokens
var CMD_REGEX = /^[A-Z](?:[A-Z]|[0-9]+|C#)\b/i;
var LINENO_REGEX = /^N[0-9]+\b/i;
var LABEL_REGEX = /^[A-Z_][A-Z0-9_]*:/i;
var IDENTIFIER_REGEX = /[A-Z_][A-Z0-9_]*/i;
var WORD_REGEX = /[A-Z_][A-Z0-9_]*/i;
var STRING_REGEX = /^"(?:[^\\"]|\\.)*"/;
var NUMBER_REGEX = /^0x[a-f\d]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i;
var SYS_VAR_REGEX = /^\%\(([ \t]*((&|\$)[A-Z_][A-Z0-9_]*)|[0-9]+[ \t]*)\)/i;
var USR_VAR_REGEX = new RegExp('^&' + IDENTIFIER_REGEX.source + '\\b', 'i');
var PERSIST_VAR_REGEX = new RegExp('^\\$' + IDENTIFIER_REGEX.source + '\\b', 'i');
var BARE_REGEX = /^[IOT]/i;
var COMMENT_REGEX = /^'.*/i;
var OPERATOR_REGEX = /^[+\-*/^!<>=]/i;

function matchExpression(stream, state) {
  if (stream.match(SYS_VAR_REGEX)) {
    state.tokenize = tokenVariableAccess("variable");
    return state.tokenize(stream, state);
  } else if (stream.match(USR_VAR_REGEX)) {
    state.tokenize = tokenVariableAccess("variable-2");
    return state.tokenize(stream, state);
  } else if (stream.match(PERSIST_VAR_REGEX)) {
    state.tokenize = tokenVariableAccess("variable-3");
    return state.tokenize(stream, state);
  } else if (stream.match(NUMBER_REGEX)) {
    return "number";
  } else if (stream.match(STRING_REGEX)) {
    return "string";
  } else if (stream.match(OPERATOR_REGEX)) {
    return "operator";
  } else if (stream.match(/^\{/)) {
    state.tokenize = tokenObjectLiteral;
    return "bracket";
  } else if (stream.match(/^\}/)) {
    return "bracket";
  } else if (stream.match(/^\(/)) {
    return "bracket";
  } else if (stream.match(/^\)/)) {
    return "bracket";
  } else if (stream.match(IDENTIFIER_REGEX)) {
    return "variable"; // For constants or function names
  } else {
    stream.next();
    return "error";
  }
}

function tokenObjectLiteral(stream, state) {
  if (stream.eatSpace()) {
    return null;
  }
  if (stream.match(/^\{/)) {
    return "bracket";
  }
  if (stream.match(/^\}/)) {
    state.tokenize = null; // Exit object literal
    return "bracket";
  }
  if (stream.match(STRING_REGEX) || stream.match(IDENTIFIER_REGEX)) {
    return "property";
  }
  if (stream.match(/^\:/)) {
    return "operator";
  }
  if (stream.match(/^\,/)) {
    return null;
  }
  var match = matchExpression(stream, state);
  if (match) {
    return match;
  }
  stream.next();
  return "error";
}

function tokenVariableAccess(variableType) {
  return function(stream, state) {
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match(/^\./)) {
      return "operator";
    }
    if (stream.match(IDENTIFIER_REGEX)) {
      return "property";
    }
    if (stream.match(/^\[/)) {
      state.bracketNesting = (state.bracketNesting || 0) + 1;
      return "bracket";
    }
    if (stream.match(/^\]/)) {
      state.bracketNesting--;
      if (state.bracketNesting < 0) {
        state.tokenize = null; // Exit variable access
        return "error";
      }
      return "bracket";
    }
    if (state.bracketNesting > 0) {
      // Inside brackets, parse expression
      var match = matchExpression(stream, state);
      if (match) {
        return match;
      }
    } else {
      // No more access path
      state.tokenize = null;
      return variableType;
    }
    stream.next();
    return "error";
  };
}

function matchArgument(stream, state) {
  var match = matchExpression(stream, state);
  if (match) {
    return match;
  }
  if (stream.match(BARE_REGEX)) {
    return "atom";
  }
  stream.next();
  return "error";
}

CodeMirror.defineMode("opensbp", function() {
  return {
    startState: function() {
      return {
        name: "sol",
        tokenize: null,
        bracketNesting: 0
      };
    },
    token: function(stream, state) {
      if (state.tokenize) {
        var result = state.tokenize(stream, state);
        if (!state.tokenize) {
          state.bracketNesting = 0; // Reset bracket nesting when exiting variable access
        }
        return result;
      }
      if (stream.sol()) {
        state.name = "sol";
      }
      if (stream.eatSpace()) {
        return null;
      }
      if (stream.match(COMMENT_REGEX)) {
        stream.skipToEnd();
        return 'comment';
      }

      switch (state.name) {
        case "sol":
          if (stream.match(LABEL_REGEX)) {
            return "label";
          }
          if (stream.match(/^ON\b/i)) {
            state.name = "on";
            return "keyword";
          }
          if (stream.match(USR_VAR_REGEX)) {
            state.tokenize = tokenVariableAccess("variable-2");
            state.name = "assign";
            return "variable-2";
          }
          if (stream.match(PERSIST_VAR_REGEX)) {
            state.tokenize = tokenVariableAccess("variable-3");
            state.name = "assign";
            return "variable-3";
          }
          if (stream.match(/^IF\b/i)) {
            state.name = "test";
            return "keyword";
          }
          if (stream.match(LINENO_REGEX)) {
            state.name = "gcode";
            return "property";
          }
          if (stream.match(CMD_REGEX)) {
            state.name = "args";
            return "cmd";
          }
          if (stream.match(/^PAUSE\b/i)) {
            state.name = "pause";
            return "keyword";
          }
          if (stream.match(/^FAIL\b/i)) {
            state.name = "fail";
            return "keyword";
          }
          if (stream.match(/^GOTO\b|GOSUB\b/i)) {
            state.name = "goto";
            return "keyword";
          }
          if (stream.match(/^RETURN\b|END\b/i)) {
            return "keyword";
          }
          stream.next();
          return "error";

        case "assign":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match('=')) {
            state.name = "expression";
            return "operator";
          }
          stream.next();
          return "error";

        case "expression":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          var match = matchExpression(stream, state);
          if (match) {
            return match;
          }
          stream.next();
          return "error";

        case "test":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(/^THEN\b/i)) {
            state.name = "then";
            return "keyword";
          }
          var match = matchExpression(stream, state);
          if (match) {
            return match;
          }
          stream.next();
          return "error";

        case "then":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(/^GOTO\b|GOSUB\b/i)) {
            state.name = "goto";
            return "keyword";
          }
          if (stream.match(USR_VAR_REGEX)) {
            state.tokenize = tokenVariableAccess("variable-2");
            state.name = "assign";
            return "variable-2";
          }
          if (stream.match(PERSIST_VAR_REGEX)) {
            state.tokenize = tokenVariableAccess("variable-3");
            state.name = "assign";
            return "variable-3";
          }
          if (stream.match(CMD_REGEX)) {
            state.name = "args";
            return "cmd";
          }
          if (stream.match(/^RETURN\b|END\b/i)) {
            state.name = "sol";
            return "keyword";
          }
          stream.next();
          return "error";

        case "goto":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(WORD_REGEX)) {
            state.name = "sol";
            return "property";
          }
          stream.next();
          return "error";

        case "on":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          if (stream.match(/INP(?:UT)?\b/i)) {
            return "keyword";
          }
          if (stream.match(/\d+/)) {
            return "number";
          }
          if (stream.match(/GOTO\b|GOSUB\b/i)) {
            state.name = "goto";
            return "keyword";
          }
          if (stream.match(/,/)) {
            return null;
          }
          stream.next();
          return "error";

        case "args":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          if (stream.match(/,/)) {
            return null;
          }
          var match = matchArgument(stream, state);
          if (match) {
            return match;
          }
          stream.next();
          return "error";

        case "pause":
          if (stream.eatSpace()) {
              return null;
          }
          if (stream.eol()) {
              state.name = "sol";
              return null;
          }
          if (stream.match(NUMBER_REGEX)) {
              return "number";
          }
          if (stream.match(STRING_REGEX)) {
              return "string";
          }
          if (stream.match(OPERATOR_REGEX) && stream.current() === "+") {
              return "operator";
          }
          if (stream.match(USR_VAR_REGEX)) {
              state.tokenize = tokenVariableAccess("variable-2");
              return "variable-2";
          }
          if (stream.match(PERSIST_VAR_REGEX)) {
              state.tokenize = tokenVariableAccess("variable-3");
              return "variable-3";
          }
          if (stream.match(SYS_VAR_REGEX)) {
              state.tokenize = tokenVariableAccess("variable");
              return "variable";
          }
          if (stream.match(/,/)) {
              return "operator";
          }
          stream.next();
          return "error";
                    
        case "fail":
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          var match = matchArgument(stream, state);
          if (match) {
            return match;
          }
          stream.next();
          return "error";

        case "gcode":
          stream.skipToEnd();
          state.name = "sol";
          return null;

        default:
          stream.next();
          return "error";
      }
    }
  };
});

CodeMirror.defineMIME("text/x-opensbp", "opensbp");