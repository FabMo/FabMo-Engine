{
  // Initialization code (if any)
}

start
  = assign:assignment !. { return assign }

assignment
  = v:variable "=" e:expression { return { "type": "assign", "var": v, "expr": e } }

variable
  = "&" name:identifier { return { "type": "user_variable", "name": name } }

identifier
  = [a-zA-Z_][A-Za-z0-9_]* { return text(); }

expression
  = integer

integer
  = [0-9]+ { return parseInt(text(), 10); }
