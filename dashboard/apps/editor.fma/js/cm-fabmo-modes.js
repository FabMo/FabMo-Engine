/* Example definition of a simple mode that understands a subset of
 * JavaScript:
 */

/* NOTE(th): This file is a modified version of the codemirror simplemode example file.  It is used to define 
  * the syntax highlighting rules for the OpenSBP language.  The original file can be found here: 
  * 1/16/2024 UPDATES ARE STILL A WORK IN PROGRESS FOT NEW HIGHLIGHT FEATURES ... have added more comments to help understand
  * the processing path of the code.  Also added a few more states to handle the new features.  Still need to refine a few things
  * that are quite right. 
  */

var CodeMirror = require('./codemirror.js');

CodeMirror.defineSimpleMode("gcode", {
  // The start state contains the rules that are intially used
  start: [                                               //start state > CHECK GCODE first
    {regex: /\([^\)]*\)/i, token: "comment"},            //anything in parens is a comment
    {regex: /[GM]\d+/i, token: "keyword"},               //any G or M command is a keyword
    // You can match multiple tokens at once. Note that the captured
    // groups must span the whole string in this case
    {regex: /([A-FH-LN-Z])([+\-]?[0-9]+(?:\.[0-9]+)?)/i, //match a letter followed by a number 
     token: ["variable", "number"]},                     //the letter is a variable, the number is a number
    {regex: /\?.*/, token: "comment"},                   //anything after a ? is a comment
    {regex: /[^\w\s]/, token: "error"}                   //anything else is an error
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

// Set up some basic checks for OpenSBP syntax
var CMD_REGEX = /^[A-Z](?:[A-Z]|[0-9]+|C\#)\b/i        //match a command
var LINENO_REGEX = /^N[0-9]+\b/i                       //match a line number
var LABEL_REGEX = /^[A-Z_][A-Z0-9_]*\:/i               //match a label
var WORD_REGEX = /^[A-Z_][A-Z0-9_]*/i                  //match a word (label or variable)
var STRING_REGEX = /^"(?:[^\\]|\\.)*?"/                //match a string
var NUMBER_REGEX = /^0x[a-f\d]+|[-+]?(?:\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/i
                                                       //match a number
var SYS_VAR_REGEX = /^\%\(([ \t]*((&|\$)[A-Z_][A-Z0-9_]*)|[0-9]+[ \t]*)\)/i;
                                                       //match a system variable (with or without a value) 
var USR_VAR_REGEX = /^\&[A-Z_][A-Z0-9_]*/i             //match a user variable (with or without a value)
var PERSIST_VAR_REGEX = /^\$[A-Z_][A-Z0-9_]*/i         //match a persistent variable (with or without a value) 
var BARE_REGEX = /^[IOT]/i                             //match a bare word (I, O, or T; inside outside or true?)  
var COMMENT_REGEX = /^'.*/i                            //match an opensbp comment (starts with a single quote)
var OPERATOR_REGEX = /^[\+\-\*\/\^\!\(\)\=\>\<|\=\:]/i //match an operator (math, logic, or assignment) 

// Checks for match of the contents of next part of the stream  
function matchExpression(stream) {
  if(stream.match(SYS_VAR_REGEX)) {
    return "variable"; // Return token for a match
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

// Checks for a match of the next 'argument' in the stream (comma separated)
function matchArgument(stream) {
  var match = matchExpression(stream);
  if(match) { return match; }                         // If we match an expression from above, return it immediately 
  if(stream.match(BARE_REGEX)) { return "atom"; }     // If we match a bare word, return it immediately (I, O, or T) 
  return null;   
}

// CHECKING CURRENT EDITOR TEXT STARTS HERE 

CodeMirror.defineMode("opensbp", function() {
  return {
    startState: function() {
      return {
        name : "sol",                                 // Start off in the start of line state
      }
    },

    token: function(stream, state) {                  // Tokenize the stream based on the current state of the editor 
      if(stream.sol()) {                              // If we're at the start of a line, reset the state
        state.name = "sol";
      }
      if(stream.eatSpace()) {                         // If we're eating space, return null
        return null;
      }
      if(stream.eat("'")) {                           // If we're eating a comment, skip to the end of the line
        stream.skipToEnd();
        return 'comment';
      }

      switch(state.name) {                            // Otherwise, tokenize based on the CURRENT state of the editor 

        case "sol":                                   // START OF LINE STATE ======== (most common) 
          if(stream.eatSpace()) {                     // Eat space
            return null;  
          }
          if(stream.match(COMMENT_REGEX)) {           // If we match a comment, skip to the end of the line and return the token 
            return "comment";
          }
          if(stream.match("ON")) {                    // If we match ON from "ON INPUT", change to the ON state and return the token 
            state.name = "on";
            return "keyword";
          } 
          // LHS of an assignment (note that a system variable can not be assigned)
          // if(stream.match(SYS_VAR_REGEX)) {
          //   state.name = "property";
          //   return "systemvar";
          // } 
          if(stream.match(USR_VAR_REGEX)) {           // If we match a [user variable], change to the ASSIGN state and return the token 
            state.name = "assign";
            return "variable-2";
          } 
          if(stream.match(PERSIST_VAR_REGEX)) {       // If we match a [persistent variable], change to the ASSIGN state and return the token 
            state.name = "assign";
            return "variable-3";
          } 
          if(stream.match(LABEL_REGEX)) {             // If we match a [label] return the token 
            return "property";
          }
          if(stream.match(/^IF/i)) {                  // If we match an [if statement], change to the TEST state and return the token
            state.name = "test";
            return "keyword"
          }
          if(stream.match(LINENO_REGEX)) {            // If we match a [line number], change to the GCODE state and return the token
          	state.name = "gcode";
          	return "property";
          }
          if(stream.match(CMD_REGEX)) {               // If we match a [two-letter command], change to the ARGS state and return the token
            state.name = "args";    
            return "cmd";
          } 
          if(stream.match(/^PAUSE\s*/i)) {            // If we match a [pause command], change to the ARGS state and return the token
            state.name = "args";
            return "keyword"
          }
          if(stream.match(/^FAIL/i)) {               // If we match a [fail command], change to the FAIL state and return the token
            state.name = "fail";
            return "keyword"
          }
          if(stream.match(/^GOTO|GOSUB/i)) {         // If we match a [goto command], change to the GOTO state and return the token
            state.name = "goto";
            return "keyword"
          }
          if(stream.match(/^RETURN|END/i)) {         // If we match a [return or end command], change to the SINGLE state and return the token
            state.name = "single";
            return "keyword";
          }
          stream.skipToEnd();                        // If we get here a [no match] , so just skip a character 
          break;

        case "single":                               // SINGLE STATE ======== (return or end)  
          break;

        case "args":                                 // ARGS STATE ======== (arguments to a command)
          if(stream.eat(',')) {
            return null
          }
          if (stream.match(SYS_VAR_REGEX)) {         // If we match a [system variable], change to the SYSTEM VARIABLE state and return the token
            state.name = "sysvariable";
            return "variable";
          }
          var match = matchArgument(stream);         // Check for a match of the next argument in the stream
          if(match) { return match; }                // If we match an argument, return it immediately to influence stream state
          break;

        case "assign":                               // ASSIGN STATE ======== (assignment to a variable) 
          var match = matchExpression(stream);
          if(match) { return match;}
          stream.skipToEnd();
          return 'error';
           
        case "sysvariable":                          // SYSTEM VARIABLE STATE ======== (system variable assignment)
          //consume any number of spaces before the closing parenthesis
          if (stream.peek() === ')') { 
            stream.next(); // Consume the closing parenthesis
            state.name = "sol";
            return "operator";
          }
                  
        case "test":                                 // TEST STATE ======== (handle if statement)
          var match = matchExpression(stream);
          if(match) { return match;}
          if(stream.match(/^THEN/i)) {
            state.name = "then"; // Change to a new state to handle post-THEN syntax
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

        case "then":                                 // THEN STATE ======== (handle the action statement)
          if(stream.match(/^RETURN|END/i)) {
            state.name = "single";
            return "keyword";
          }
          if(stream.match(/^FAIL/i)) {
            state.name = "fail";
            return "keyword";
          }
          if(stream.match(/^PAUSE/i)) {
            state.name = "pause";
            return "keyword";
          }
          if(stream.match(SYS_VAR_REGEX) || stream.match(USR_VAR_REGEX) || stream.match(PERSIST_VAR_REGEX)) {
            state.name = "assign";
            return stream.match(SYS_VAR_REGEX) ? "variable" : stream.match(USR_VAR_REGEX) ? "variable-2" : "variable-3";
          }
          if(stream.match(CMD_REGEX)) {
            state.name = "args";
            return "cmd";
          }
          if(stream.match(/^GOTO|GOSUB/i)) {
            state.name = "goto"
            return "keyword";
          }        
          if(stream.match(LABEL_REGEX)) {
            return "property";
          }
          break;

        case "goto":                                 // GOTO STATE ======== 
          if(stream.match(WORD_REGEX)) {
            state.name = "sol"                       // Change to a new state to handle post-THEN syntax
            return "property"            
          }                
          break;

        case "on":                                   // ON STATE ========
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

        case "pause":                                // PAUSE STATE ========
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

        case "gcode":
        	stream.skipToEnd();
        	return null;

        default:
          console.error("Unknown state: ", state)
  
      }


      stream.next();                                  // If we get here, we didn't match anything, so just skip a character and return an error 
      return "error";

    }
  }
});
CodeMirror.defineMIME("text/x-opensbp","opensbp")

