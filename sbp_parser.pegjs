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
   = lines:((__ s:statement '\n'){return s})*

statement
   = comment / label / command / single / jump / assignment / conditional / __

command 
   = m:mnemonic 
     args:(("," arg:argument){return arg})* 
     {return {type:"cmd","cmd":m,"args":args};}

single
   = name:("END" / "RETURN") 
     {return {type:name.toLowerCase()}}

conditional
   = "IF" ___ cmp:comparison ___ "THEN" ___ stmt:(command / assignment / jump) { return {"type":"cond", "cmp":cmp, "stmt":stmt};}

jump
   = cmd:("GOTO" / "GOSUB") ___ 
     lbl:identifier 
     {return {type:cmd.toLowerCase(), label:lbl};}

comment
   = ("REM" / "'") 
     cmt:([^\n]*) 
     {return {type:"comment", text: cmt.join("")}}

argument
   = (float / integer / expression / barestring / "")

mnemonic
   = code:(
    "CA" / "CC" / "CG" / "CP" / "CR" / 
    "FC" / "FE" / "FG" / "FP" / "FS" / 
    "HA" / "HB" / "HC" / "HE" / "HN" / "HQ" / "HR" / "HT" / "HU" / "HW" / 
    "J2" / "J3" / "J4" / "J5" / "JA" / "JB" / "JH" / "JS" / "JX" / "JY" / "JZ" / 
    "M2" / "M3" / "M4" / "M5" / "MA" / "MB" / "MD" / "MH" / "MO" / "MS" / "MX" / "MY" / "MZ" / 
    "RA" / "RI" / "RP" / "RR" / "RS" / "RZ" / 
    "SA" / "SF" / "SI" / "SK" / "SL" / "SM" / "SO" / "SP" / "SR" / "ST" / "SV" / "SW" / 
    "TC" / "TD" / "TF" / "TH" / "TS" / "TT" / "TU" / 
    "UD" / "UL" / "UN" / "UR" / "UU" / "UV" / "UZ" / 
    "VA" / "VB" / "VC" / "VD" / "VI" / "VL" / "VN" / "VO" / "VP" / "VR" / "VS" / "VU" / 
    "Z2" / "Z3" / "Z4" / "Z5" / "ZA" / "ZB" / "ZT" / "ZX" / "ZY" / "ZZ"
) {return code;}

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
  = v:("%" identifier) {return v.join("")}

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
cmp_op = "<=" / ">=" / "==" / "<" / ">" / "!="

factor
  = "(" __ expr:expression __ ")" { return expr; }
  / integer
  / float
  / variable

whitespace
   = [ \t]

__ = whitespace*
___ = whitespace+
