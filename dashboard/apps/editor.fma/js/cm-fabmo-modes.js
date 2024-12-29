/* 
 * Complete CodeMirror mode for OpenSBP with comprehensive handling of syntax elements
 * Handles variable assignments, object literals, PAUSE and DIALOG statements with options,
 * IF statements, comments, strings, numbers, and operators.
 * 
 * Version: 5.14.3
 */

var CodeMirror = require('./codemirror.js');

// Regular expressions for matching various tokens
var OPERATOR_REGEX = /^(<=|>=|==|!=|<|>|\+|\-|\*|\/|\^|!|=|:=)/i;
var CMD_REGEX = /^[A-Z](?:[A-Z0-9]+|C#)\b/i;
var LINENO_REGEX = /^N[0-9]+\b/i;
var LABEL_REGEX = /^[A-Z_][A-Z0-9_]*:/i;
//var IDENTIFIER_REGEX = /[A-Z_][A-Z0-9_]*/i;
var IDENTIFIER_REGEX = /[A-Z_][A-Z0-9_]*(\[[^\]]*\]|(\.[A-Z_][A-Z0-9_]*)*)*/i;
var WORD_REGEX = /[A-Z_][A-Z0-9_]*/i;
var STRING_REGEX = /^"(?:[^\\"]|\\.)*"/;
var NUMBER_REGEX = /^0x[a-f\d]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i;
var SYS_VAR_REGEX = /^\%\(([ \t]*((\$|&)[A-Z_][A-Z0-9_]*|[0-9]+)([ \t]*)\))[ \t]*/i;
var USR_VAR_REGEX = new RegExp('^&' + IDENTIFIER_REGEX.source + '\\b\\s*', 'i');
var PERSIST_VAR_REGEX = new RegExp('^\\$' + IDENTIFIER_REGEX.source + '\\b\\s*', 'i');
var BARE_REGEX = /^[IOT]/i;
var COMMENT_REGEX = /^'.*/i;

// Tokenizer for variable access paths (e.g., &var3[1].z)

// function tokenVariableAccess(variableType) {
//   return function(stream, state) {
//       if (stream.eatSpace()) {
//           return null; // Always allow and ignore spaces
//       }

//       // Match array indices and properties with dot notation
//       if (stream.match(/^\[/)) {
//           state.subState = 'array';
//           return "bracket";
//       } else if (stream.match(/^\./)) {
//           state.subState = 'property';
//           return "operator";
//       } else if (state.subState === 'array' && stream.match(/^\d+/)) {
//           if (stream.peek() === ']') {
//               stream.next(); // Consume the closing bracket
//               state.subState = ''; // Reset subState
//               return "number"; // Highlight the index number
//           }
//       } else if (state.subState === 'property' && stream.match(/^[A-Z_][A-Z0-9_]*/i)) {
//           state.subState = ''; // Reset subState
//           return "property"; // Highlight the property name
//       }

//       // Match variable names initially
//       if (stream.match(variableType === 'variable-2' ? USR_VAR_REGEX : PERSIST_VAR_REGEX)) {
//           return variableType; // Highlight the variable
//       }

//       // If no valid continuation, clear the tokenizer and allow default handling
//       state.tokenize = null;
//       stream.next(); // Move the stream forward to avoid getting stuck
//       return "error"; // Highlight unexpected characters as errors
//   };
// }

// function tokenVariableAccess(variableType) {
//   return function(stream, state) {
//       if (stream.eatSpace()) {
//           return null;
//       }

//       if (stream.match(/^\[/)) {
//           return "bracket"; // Highlight array opening bracket
//       }

//       if (stream.match(/^\]/)) {
//           return "bracket"; // Highlight array closing bracket
//       }

//       if (stream.match(/^\./)) {
//           return "operator"; // Highlight dot for property access
//       }

//       if (stream.match(/[A-Z_][A-Z0-9_]*/i)) {
//           return "property"; // Highlight property name
//       }

//       // After processing a property or bracket, check if there are more properties or array indexes
//       if (variableType === "variable-2" && stream.match(USR_VAR_REGEX)) {
//           return "variable-2";  // User variable
//       } else if (variableType === "variable-3" && stream.match(PERSIST_VAR_REGEX)) {
//           return "variable-3";  // Persistent variable
//       }

//       // Return the type of variable (user or persistent)
//       state.tokenize = null;
//       return variableType;
//   };
// }

function tokenVariableAccess(variableType) {
  return function(stream, state) {
      if (stream.eatSpace()) {
          return null;
      }

      if (stream.match(/^\./)) {
          return "operator"; // Highlight '.'
      }

      if (stream.match(IDENTIFIER_REGEX)) {
          return "property"; // Highlight property name after '.'
      }

      if (stream.match(/^\[/)) {
          state.bracketNesting = (state.bracketNesting || 0) + 1;
          return "bracket"; // Highlight '['
      }

      if (stream.match(/^\]/)) {
          state.bracketNesting--;
          if (state.bracketNesting < 0) {
              state.tokenize = null; // Exit variable access
              return "error";
          }
          return "bracket"; // Highlight ']'
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

// Tokenizer for object literals (e.g., {x: 1, y:2})
function tokenObjectLiteral(stream, state) {
  if (stream.eatSpace()) {
    return null;
  }

  if (stream.match(/^\{/)) {
    return "bracket"; // Highlight '{'
  }

  if (stream.match(/^\}/)) {
    state.tokenize = null; // Exit object literal
    return "bracket"; // Highlight '}'
  }

  if (stream.match(STRING_REGEX) || stream.match(IDENTIFIER_REGEX)) {
    return "property"; // Highlight property names
  }

  if (stream.match(/^\:/)) {
    return "operator"; // Highlight ':'
  }

  if (stream.match(/^,/)) {
    return "operator"; // Highlight ','
  }

  var match = matchExpression(stream, state);
  if (match) {
    return match;
  }

  stream.next();
  return "error";
}

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
      return "number"; // Highlight numbers
  } else if (stream.match(STRING_REGEX)) {
      return "string"; // Highlight strings
  } else if (stream.match(OPERATOR_REGEX)) {
      return "operator"; // Highlight operators
  } else if (stream.match(/^\{/)) {
      state.tokenize = tokenObjectLiteral;
      return "bracket"; // Highlight '{'
  } else if (stream.match(/^\}/)) {
      return "bracket"; // Highlight '}'
  } else if (stream.match(/^\(/)) {
      return "bracket"; // Highlight '('
  } else if (stream.match(/^\)/)) {
      return "bracket"; // Highlight ')'
  } else if (stream.match(IDENTIFIER_REGEX)) {
      return "variable"; // Highlight variables or function names
  } else {
      stream.next();
      return "error"; // Highlight unknown tokens as errors
  }
}

// Function to match arguments in commands
function matchArgument(stream, state) {
  var match = matchExpression(stream, state);
  if (match) {
    return match;
  }
  if (stream.match(BARE_REGEX)) {
    return "atom"; // Highlight atoms (I, O, T)
  }
  stream.next();
  return "error"; // Highlight unknown tokens as errors
}

// Function to handle PAUSE and DIALOG statement options
function tokenPauseDialogOptions(stream, state) {
  if (stream.eatSpace()) {
    return null;
  }

  // Match option names like MESSAGE=, OKTEXT=, etc.
  if (stream.match(/^[A-Z]+\=/i)) {
    return "keyword"; // Highlight option names
  }

  // Match string values in options
  if (stream.match(/^"/)) {
    while (!stream.eol()) {
      if (stream.match(/^[^"\\]+/)) {
        return "string";
      }
      if (stream.match(/\\./)) {
        return "string"; // Handle escaped characters
      }
      if (stream.match(/^"/)) {
        return "string";
      }
      break;
    }
  }

  // Match TRUE/FALSE values
  if (stream.match(/^(TRUE|FALSE)\b/i)) {
    return "atom"; // Highlight TRUE/FALSE
  }

  // Match variables in options
  if (stream.match(IDENTIFIER_REGEX)) {
    return "variable"; // Highlight variable values
  }

  // Match comma separators
  if (stream.match(/,/)) {
    return "operator"; // Highlight ','
  }

  // Match concatenation operator '+'
  if (stream.match(OPERATOR_REGEX) && stream.current() === "+") {
    return "operator"; // Highlight '+'
  }

  // Match variables in concatenation
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

  stream.next();
  return "error"; // Highlight unknown tokens as errors
}

// Define the CodeMirror mode
CodeMirror.defineMode("opensbp", function() {
  return {
    startState: function() {
      return {
        name: "sol",             // Start of line state
        tokenize: null,         // Current tokenizer function
        bracketNesting: 0       // Track nesting in brackets
      };
    },
    token: function(stream, state) {
      // Delegate to current tokenizer if set
      if (state.tokenize) {
        var result = state.tokenize(stream, state);
        if (!state.tokenize) {
          state.bracketNesting = 0; // Reset bracket nesting when exiting tokenizer
        }
        return result;
      }

      // Handle start of a new line
      if (stream.sol()) {
        state.name = "sol";
      }

      // Consume and ignore whitespace
      if (stream.eatSpace()) {
        return null;
      }

      // Handle comments
      if (stream.match(COMMENT_REGEX)) {
        stream.skipToEnd();
        return 'comment';
      }

      switch (state.name) {
        case "sol":
          // Match labels
          if (stream.match(LABEL_REGEX)) {
            return "label"; // Highlight labels with colon
          }

          // Match commands
          if (stream.match(/^ON\b/i)) {
            state.name = "on";
            return "keyword";
          }

          // Match variable assignments
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

          // Match IF statements
          if (stream.match(/^IF\b/i)) {
            state.name = "test";
            return "keyword";
          }

          // Match line numbers or G-code
          if (stream.match(LINENO_REGEX)) {
            state.name = "gcode";
            return "property";
          }

          // Match other commands
          if (stream.match(CMD_REGEX)) {
            state.name = "args";
            return "cmd";
          }

          // Match PAUSE statements
          if (stream.match(/^PAUSE\b/i)) {
            state.name = "pause";
            return "keyword";
          }

          // Match DIALOG statements
          if (stream.match(/^DIALOG\b/i)) {
            state.name = "dialog";
            return "keyword";
          }

          // Match FAIL statements
          if (stream.match(/^FAIL\b/i)) {
            state.name = "fail";
            return "keyword";
          }

          // Match GOTO/GOSUB statements
          if (stream.match(/^GOTO\b|GOSUB\b/i)) {
            state.name = "goto";
            return "keyword";
          }

          // Match RETURN/END statements
          if (stream.match(/^RETURN\b|END\b/i)) {
            return "keyword";
          }

          // If no known token matched, highlight as error
          stream.next();
          return "error";

        // Adjust the tokenizer within the assignment or variable handling state
        case "assign":
          // Handle assignment operators
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(/:=/)) {
            state.name = "expression"; // Transition to handling the expression after assignment
            return "operator"; // Correctly highlight ':=' as an operator
          }
          if (stream.match('=')) {
            state.name = "expression";
            return "operator";
          }
          // If no appropriate assignment operator is found, highlight as error
          stream.next();
          return "error";

        // case "assign":
        //   // Handle assignment operator '='
        //   if (stream.eatSpace()) {
        //     return null;
        //   }
        //   if (stream.match('=')) {
        //     state.name = "expression";
        //     return "operator";
        //   }
        //   // If '=' not found, highlight as error
        //   stream.next();
        //   return "error";

        case "expression":
          // Handle expressions after assignment
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          var matchExpr = matchExpression(stream, state);
          if (matchExpr) {
            return matchExpr;
          }
          // If no match, highlight as error
          stream.next();
          return "error";

        case "test":
          // Handle conditions in IF statements
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(/^THEN\b/i)) {
            state.name = "then";
            return "keyword";
          }
          var matchTest = matchExpression(stream, state);
          if (matchTest) {
            return matchTest;
          }
          stream.next();
          return "error";

        case "then":
          // Handle actions after THEN in IF statements
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
          // Handle GOTO/GOSUB targets
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.match(WORD_REGEX)) {
            state.name = "sol";
            return "property"; // Highlight label or variable
          }
          stream.next();
          return "error";

        case "on":
          // Handle ON statements
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
            return "operator";
          }
          stream.next();
          return "error";

        case "args":
          // Handle arguments in commands
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          if (stream.match(/,/)) {
            return "operator"; // Highlight ',' separating arguments
          }
          var matchArgs = matchArgument(stream, state);
          if (matchArgs) {
            return matchArgs;
          }
          stream.next();
          return "error";

        case "pause":
        case "dialog":
          // Handle PAUSE and DIALOG statements with options
          return tokenPauseDialogOptions(stream, state);

        case "fail":
          // Handle FAIL statements
          if (stream.eatSpace()) {
            return null;
          }
          if (stream.eol()) {
            state.name = "sol";
            return null;
          }
          var matchFail = matchArgument(stream, state);
          if (matchFail) {
            return matchFail;
          }
          stream.next();
          return "error";

        case "gcode":
          // Handle G-code lines
          stream.skipToEnd();
          state.name = "sol";
          return null;

        default:
          // Catch-all for any unhandled states
          stream.next();
          return "error";
      }
    }
  };
});

// Define MIME type for OpenSBP
CodeMirror.defineMIME("text/x-opensbp", "opensbp");
