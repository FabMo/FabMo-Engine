{
   function buildTree(first, rest) {
      if(rest[0]) {
          return {left: first, right: rest[0][3], op: rest[0][1]};
      } else {
          return first;
      }
   }
}

start
   = __ stmt:statement __ {return stmt}

statement
   = (label / single / jump / pause / conditional / assignment / event / open / custom_cut / command / __)

custom_cut
   = [Cc] index:integer
   { return {"type":"custom", "index":index};}

event
   = "ON"i ___ "INPUT"i __ "(" __ sw:integer __ "," __ state:integer __ ")" ___ stmt:(assignment / jump / pause / single / command)
      {return {"type":"event", "sw":sw, "state":state, "stmt":stmt};} 

command 
   = m:mnemonic 
     args:(("," __ (arg:argument) __ ){return arg})* 
     {return {type:"cmd","cmd":m,"args":args};}

single
   = name:("END"i / "RETURN"i) 
     {return {type:name.toLowerCase()}}

pause
   = name:("PAUSE"i) __ expr:expression? {return {"type":"pause", "expr":expr}}

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
   = (float / integer / expression / barestring / "")

mnemonic = code: ([A-Za-z][A-Za-z0-9]) {return code.join('');}

identifier
   = id:([a-zA-Z_]+[A-Za-z0-9_]*) {return id[0].join("");}

label
   = id:identifier ":" {return {type:"label", value:id};}

decimal
  = digits:[0-9]+ { return digits.join(""); }
integer "integer"
  = dec:decimal { return parseInt(dec, 10); }

float "float"
  = f:('-'? decimal '\.' decimal) { return parseFloat(f.join(""));}

barestring
  = s:[^,\n]+ { return s.join("").trim() || undefined; }

quotedstring
  = '"' s:[^\"\n]+ '"' {return s.join("")}

variable
  = (user_variable / system_variable)

user_variable
  = v:("&" identifier) {return v.join("")}

system_variable
  = v:("%" "(" __ integer __ ")") {return v.join("")}

assignment
  = v:variable __ "=" __ e:expression {return {"type": "assign", "var":v, "expr":e}}

comparison
  = lhs:expression __ op:cmp_op __ rhs:expression {return {'left' : lhs, 'right' : rhs, 'op' : op};}

expression
  = first:term rest:(__ add_op __ term)* {
      return buildTree(first, rest);
    }

term
  = first:factor rest:(__ mul_op __ factor)* {
      return buildTree(first, rest);
    }

mul_op = "*" / "/"
add_op = "+" / "-"
cmp_op = "<=" / ">=" / "==" / "<" / ">" / "!=" / "="

factor
  = "(" __ expr:expression __ ")" { return expr; }
  / float
  / integer
  / variable
  / barestring

whitespace
   = [ \t]

__ = whitespace*
___ = whitespace+
