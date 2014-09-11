{
   buildTree = function(first, rest) {
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
   = (label / single / jump / pause / conditional / assignment / command / __)

command 
   = m:mnemonic 
     args:(("," arg:argument){return arg})* 
     {return {type:"cmd","cmd":m,"args":args};}

single
   = name:("END" / "RETURN") 
     {return {type:name.toLowerCase()}}

pause
   = name:("PAUSE") __ expr:expression? {return {"type":"pause", "expr":expr}}

conditional
   = "IF" ___ cmp:comparison ___ "THEN" ___ stmt:(jump) { return {"type":"cond", "cmp":cmp, "stmt":stmt};}

jump
   = cmd:("GOTO" / "GOSUB") ___ 
     lbl:identifier 
     {return {type:cmd.toLowerCase(), label:lbl};}

argument
   = (float / integer / expression / barestring / "")

mnemonic = code: ([A-Za-z][A-Za-z0-9]) {return code.join('');}

identifier
   = id:([a-zA-Z_]+[A-Za-z0-9_]*) {return id[0].join("");}

label
   = id:identifier ":" {return {type:"label", value:id};}

integer "integer"
  = digits:[0-9]+ { return parseInt(digits.join(""), 10); }

float "float"
  = f:('-'? integer '\.' integer) { return parseFloat(f.join(""));}

barestring
  = s:[^,\n]+ {return s.join("");}

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
