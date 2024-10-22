// This is the working PEG for generating the OpenSBP parser
// peg.js 0.7.0 version BEING MIGRATED TO; peggy.js 4.0.3; th started 9/26/24
// -- known issue with __ and ___ potentially not being recognized as whitespace in the way we want; see last lines

{
   function buildLeftAssocTree(l, r) {
      if (!l.length) { return r; }
      var last = l.pop();
      return {left: buildLeftAssocTree(l, last[0]), right: r, op: last[1][1]};
   }

   function buildRightAssocTree(l, r) {
      if (!r.length) { return l; }
      var first = r.shift();
      return {left: l, op: first[1], right: buildRightAssocTree(first[3], r)};
   }

   function assignList(listName, startIdx, endIdx, value) {
      if (typeof window[listName] !== 'undefined') {
          let list = window[listName];
          for (let i = startIdx; i <= endIdx; i++) {
              list[i] = value;
          }
          return { "type": "list_assignment", "list": listName, "start": startIdx, "end": endIdx, "value": value };
      } else {
          throw new Error(`${listName} is not defined`);
      }
   }
}

start
   = __ stmt:statement __ {return stmt}

statement
   = (label / single / fail / jump / pause / dialog / conditional / list_assignment / assignment / weak_assignment / event / open / custom_cut / gcode_line / command / __)

list_assignment
   = list:identifier "[" startIdx:integer ":" endIdx:integer "]" __ "=" __ value:expression
   {
      return assignList(list, startIdx, endIdx, value);
   }

custom_cut
   = [Cc] index:integer __ ","?
   { return {"type":"custom", "index":index};}

gcode_line
   = [N] line:integer gcode:.*
   { return {"type":"gcode", "gcode":gcode.join('').trim()}; }

event
   = "ON"i ___ "INP"i("UT"i)? __ "(" __ sw:integer __ "," __ state:integer __ ")" ___ stmt:(assignment / jump / pause / single / command)
      {return {"type":"event", "sw":sw, "state":state, "stmt":stmt};} 

command 
   = m:mnemonic arg1:(("," / whitespace?) __ argument)?
     args:("," __ arg:argument __ { return arg; })* 
     {
      if (arg1) {
        args.unshift(arg1[2]);
      }
      return { type: "cmd", cmd: m, args: args };
     }

single
   = name:("RETURN"i / "END"i) 
     {return {type:name.toLowerCase()}}

fail
  = name:("FAIL"i) __ message:quotedstring? {return {"type" : "fail", "message": message}}

boolean
   = "TRUE"i { return true; } / "FALSE"i { return false; }

pause_param_name
   = "INPUT"i / "TITLE"i / "OKTEXT"i / "OKFUNC"i / "CANCELTEXT"i / "CANCELFUNC"i / "DETAIL"i / "NOBUTTON"i / "MESSAGE"i / "TIMER"i

pause_param_value
   = boolean
   / variable
   / quotedstring
   / integer
   / barestring

pause_param
   = name:pause_param_name __ "=" __ value:pause_param_value {
        return {name: name.toUpperCase(), value: value};
     }

pause_arg
   = param:pause_param { return { type: 'param', name: param.name, value: param.value }; }
   / variable_expr:variable { return { type: 'var', value: variable_expr }; }
   / expr:expression { return { type: 'expr', value: expr }; }

pause_args
   = first:pause_arg rest:((__ ","? __) pause_arg)* {
        var args = [first].concat(rest.map(function(r) { return r[1]; }));
        var result = {};
        args.forEach(function(arg) {
            if (arg.type === 'expr' && !result.expr) {
                result['expr'] = arg.value;
            } else if (arg.type === 'var' && !result.var) {
                result['var'] = arg.value;
            } else if (arg.type === 'param') {
                if (!result.params) result.params = {};
                result.params[arg.name] = arg.value;
            }
        });
        return result;
   }
 / '' { return {}; }  // No arguments

pause
   = name:("PAUSE"i) __ args:pause_args? {
      var result = {'type':'pause'};
      result['expr'] = null;
      result['var'] = null;
      result['params'] = {};
      if (args) {
          if (args.expr !== undefined) {
              result['expr'] = args.expr;
          }
          if (args.var !== undefined) {
              result['var'] = args.var;
          }
          if (args.params !== undefined) {
              result['params'] = args.params;
          }
      }
      return result;
   }

dialog
   = name:("DIALOG"i) __ args:pause_args? {
      var result = {'type':'dialog'};
      result['expr'] = null;
      result['var'] = null;
      result['params'] = {};
      if (args) {
          if (args.expr !== undefined) {
              result['expr'] = args.expr;
          }
          if (args.var !== undefined) {
              result['var'] = args.var;
          }
          if (args.params !== undefined) {
              result['params'] = args.params;
          }
      }
      return result;
   }

conditional
   = "IF"i ___ cmp:comparison ___ "THEN"i ___ stmt:(jump / single / fail / pause / assignment / command) 
     { return {"type":"cond", "cmp":cmp, "stmt":stmt}; }

string
  = '"' chars:([^"]*) '"' { return chars.join(''); }

number
  = [0-9]+ ("." [0-9]+)?

userVariable
  = '&' name:identifier { return { type: 'user_variable', name: name.toUpperCase(), access: [] }; }

end_of_line
  = ("\n" / "\r\n" / "\r")    

open
   = "OPEN"i ___ pth:quotedstring ___ "FOR"i ___ mode:("INPUT"i / "OUTPUT"i / "APPEND"i) ___ "AS"i ___ "#"num:[1-9] 
       { return {"type":"open", "path":pth, "mode":mode, "num":num} }

jump
   = cmd:("GOTO"i / "GOSUB"i) ___ 
     lbl:identifier 
     {return {type:cmd.toLowerCase(), label:lbl.toUpperCase()};}

argument
   = (expression / float / integer / barestring / quotedstring / "")

mnemonic = code: ([_A-Za-z][_A-Za-z0-9\#]) {return code.join('').replace('#','_POUND');}

identifier
  = first:[a-zA-Z_]+ rest:[A-Za-z0-9_]* { return first.join('') + rest.join(''); }

label
   = id:identifier ":" {return {type:"label", value:id.toUpperCase()};}

decimal "decimal"
  = digits:[0-9]+ { return digits.join(""); }

integer "integer"
  = dec:('-'? decimal) { return parseInt(dec.join(""), 10); }

float "float"
  = f:('-'? decimal? '\.' decimal) { return parseFloat(f.join(""));}

barestring
  = s:[^,\n"]+ { return s.join("").trim() || undefined; }

quotedstring
  = '"' s:[^"\n]* '"' {return s.join("")}

variable
  = (user_variable / system_variable / persistent_variable)

user_variable
  = "&" name:identifier access:property_access* {
      return { "type": "user_variable", "name": name.toUpperCase(), "access": access };
    }

persistent_variable
  = "$" name:identifier access:property_access* {
      return { "type": "persistent_variable", "name": name.toUpperCase(), "access": access };
    }

system_variable
  = "%" "(" __ e:expression __ ")" { return { "type": "system_variable", "expr": e } }

property_access
  = "[" __ e:expression __ "]" {
      return { "type": "index", "value": e };
    }
  / "." propName:identifier {
      return { "type": "property", "name": propName.toUpperCase() };
    }

object_literal
  = "{" __ properties:property_list __ "}" { return properties; }

property_list
  = first:property rest:("," __ property)* {
      let props = {};
      props[first.name] = first.value;
      rest.forEach(p => {
        let prop = p[2]; // Extract the property from the match array
        props[prop.name] = prop.value;
      });
      return props;
    }

property
  = name:identifier __ ":" __ value:expression {
      return { name: name.toUpperCase(), value: value };
    }
    
assignment
  = v:variable __ "=" __ e:expression {return {"type": "assign", "var":v, "expr":e}}

weak_assignment
  = v:variable __ ":=" __ e:expression {return {"type": "weak_assign", "var":v, "expr":e}}

compare
  = lhs:expression __ op:cmp_op __ rhs:expression {return {'left' : lhs, 'right' : rhs, 'op' : op};}

comparison
  = ("(" __ cmp:comparison __ ")" {return cmp;} / compare)

expression
  = e1

invalid
   = !. { throw new Error("Invalid input at position " + location().start.offset); }

e1
  = l:(e2 (__ add_op __ ))* r:e2 {
      return buildLeftAssocTree(l, r);
    }

e2
  = l:factor r:(__ mul_op __ factor)* {
      return buildRightAssocTree(l, r);
    }

factor
  = "(" __ expr:expression __ ")" { return expr; }
  / float
  / integer
  / variable
  / object_literal
  / quotedstring
  / barestring

mul_op = "*" / "/"
add_op = "+" / "-"
cmp_op = "<=" / ">=" / "==" / "<" / ">" / "!=" / "=" / "<>"

whitespace
   = [ \t]

__ = whitespace*
___ = whitespace+
