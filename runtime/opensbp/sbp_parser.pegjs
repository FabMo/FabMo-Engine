{
   function buildTree(first, rest) {
      if(rest[0]) {
          var l = first;
          var r = buildTree(rest[0][3], rest.slice(1));
          return {left : l, right : r, op : rest[0][1]};
          //return {left: l, right: rest[0][3], op: rest[0][1]};
      } else {
          return first;
      }
   }
}

start
   = __ stmt:statement __ {return stmt}

statement
   = (label / single / end / jump / pause / conditional / assignment / weak_assignment / event / open / custom_cut / command / __)

custom_cut
   = [Cc] index:integer __ ","?
   { return {"type":"custom", "index":index};}

event
   = "ON"i ___ "INP"i("UT"i)? __ "(" __ sw:integer __ "," __ state:integer __ ")" ___ stmt:(assignment / jump / pause / single / command)
      {return {"type":"event", "sw":sw, "state":state, "stmt":stmt};} 

command 
   = m:mnemonic arg1:((","/whitespace?) __ argument)?
     args:(("," __ (arg:argument) __ ){return arg;})* 
     {
      if(arg1) {
        args.unshift(arg1[2]);
      }
      return {type:"cmd","cmd":m,"args":args};}

single
   = name:("RETURN"i) 
     {return {type:name.toLowerCase()}}

end
  = name:("END"i) __ message:quotedstring? {return {"type" : "end", "message": message}}

pause
   = name:("PAUSE"i)  __ ","? __  arg:(e:expression {return {expr: e}})? {
    var arg = arg || {};
    if(arg['expr']) { return {'type' : 'pause', 'expr' : arg.expr}}
    else {return {'type':'pause'}};
   }

conditional
   = "IF" ___ cmp:comparison ___ "THEN" ___ stmt:(jump) { return {"type":"cond", "cmp":cmp, "stmt":stmt};}

open
   = "OPEN"i ___ pth:quotedstring ___ "FOR" ___ mode:("INPUT"i / "OUTPUT"i / "APPEND"i) ___ "AS" ___ "#"num:[1-9] 
       { return {"type":"open", "path":pth, "mode":mode, "num":num} }

jump
   = cmd:("GOTO"i / "GOSUB"i) ___ 
     lbl:identifier 
     {return {type:cmd.toLowerCase(), label:lbl};}

argument
   = (float / integer / expression / barestring / quotedstring / "")

mnemonic = code: ([_A-Za-z][_A-Za-z0-9\#]) {return code.join('').replace('#','_POUND');}

identifier
   = id:([a-zA-Z_]+[A-Za-z0-9_]*) {return id[0].join("") + id[1].join(""); }

label
   = id:identifier ":" {return {type:"label", value:id};}

decimal
  = digits:[0-9]+ { return digits.join(""); }
integer "integer"
  = dec:('-'? decimal) { return parseInt(dec.join(""), 10); }

float "float"
  = f:('-'? decimal? '\.' decimal) { return parseFloat(f.join(""));}

barestring
  = s:[^,\n"]+ { return s.join("").trim() || undefined; }

quotedstring
  = '"' s:[^\"\n]+ '"' {return s.join("")}

variable
  = (user_variable / system_variable / persistent_variable)

user_variable
  = v:("&" identifier) {return v.join("")}

persistent_variable
  = v:("$" identifier ) {return v.join("")}

system_variable
  = v:("%" "(" __ integer __ ")") {return v.join("")}

assignment
  = v:variable __ "=" __ e:expression {return {"type": "assign", "var":v, "expr":e}}

weak_assignment
  = v:variable __ ":=" __ e:expression {return {"type": "weak_assign", "var":v, "expr":e}}

compare
  = lhs:expression __ op:cmp_op __ rhs:expression {return {'left' : lhs, 'right' : rhs, 'op' : op};}

comparison
  = ("(" __ cmp:comparison __ ")" {return cmp;} / compare)

expression
  = first:term rest:(__ add_op __ term)* {
      return buildTree(first, rest);
    }

term
  = first:factor rest:(__ mul_op __ factor)* {
      return buildTree(first, rest);
    }

factor
  = "(" __ expr:expression __ ")" { return expr; }
  / float
  / integer
  / variable
  / quotedstring
  / barestring

mul_op = "*" / "/"
add_op = "+" / "-"
cmp_op = "<=" / ">=" / "==" / "<" / ">" / "!=" / "=" / "<>"


whitespace
   = [ \t]

__ = whitespace*
___ = whitespace+
