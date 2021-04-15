{

   function buildLeftAssocTree(l, r) {
   	if(!l.length) { return r; }
	var last = l.pop();
	return {left:buildLeftAssocTree(l, last[0]), right:r, op : last[1][1]}
   }

   function buildRightAssocTree(l, r) {
      if(!r.length) { return l; }
      	var first = r.shift()	      
      return {left : l, op : first[1], right : buildRightAssocTree(first[3], r)};
   }

}

start
   = __ stmt:statement __ {return stmt}

statement
   = (label / single / fail / jump / pause / conditional / assignment / weak_assignment / event / open / custom_cut / gcode_line / command / __)

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
   = m:mnemonic arg1:((","/whitespace?) __ argument)?
     args:(("," __ (arg:argument) __ ){return arg;})* 
     {
      if(arg1) {
        args.unshift(arg1[2]);
      }
      return {type:"cmd","cmd":m,"args":args};}

single
   = name:("RETURN"i / "END"i) 
     {return {type:name.toLowerCase()}}

fail
  = name:("FAIL"i) __ message:quotedstring? {return {"type" : "fail", "message": message}}

pause
   = name:("PAUSE"i)  __ ","? __  arg:(e:expression {return {expr: e}})? __ ","? __ arg2:(v:variable {return {var: v}})? {
    var arg = arg || {};
    var arg2 = arg2 || {};
    if(arg['expr'] && arg2['var']) {return {'type' : 'pause', 'expr' : arg.expr, 'var': arg2.var}}
    else if(arg['expr']) { return {'type' : 'pause', 'expr' : arg.expr}}
    else {return {'type':'pause'}};
   }

conditional
   = "IF"i ___ cmp:comparison ___ "THEN"i ___ stmt:(jump) { return {"type":"cond", "cmp":cmp, "stmt":stmt};}

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
   = id:([a-zA-Z_]+[A-Za-z0-9_]*) {return id[0].join("") + id[1].join(""); }

label
   = id:identifier ":" {return {type:"label", value:id.toUpperCase()};}

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
  = v:("&" identifier) {return {"type":"user_variable", "expr":v.join("").toUpperCase()}}

persistent_variable
  = v:("$" identifier ) {return {"type":"persistent_variable", "expr":v.join("").toUpperCase()}}

system_variable
  = "%" "(" __ e:expression __ ")" {return {"type":"system_variable", "expr":e}}

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
  / quotedstring
  / barestring

mul_op = "*" / "/"
add_op = "+" / "-"
cmp_op = "<=" / ">=" / "==" / "<" / ">" / "!=" / "=" / "<>"


whitespace
   = [ \t]

__ = whitespace*
___ = whitespace+
