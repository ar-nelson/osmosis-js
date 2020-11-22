@preprocessor typescript
@builtin "whitespace.ne"
@builtin "number.ne"
@builtin "string.ne"
@builtin "postprocessors.ne"

Path -> (_ "$"):? (_ Segment):* (_ RecursiveDescent):? _ {%
  ([,segments,recursive,]) => [
    ...segments.map(x => x[1]),
    ...recursive ? [recursive[1]] : []
  ]
%}

Segment ->
    Wildcard {% id %}
  | "." Identifier {% ([,id]) => ["key", id] %}
  | Subscript {% id %}

FirstSegment ->
    Wildcard {% id %}
  | Identifier {% ([id]) => ["key", id] %}
  | Subscript {% id %}

RecursiveDescent ->
  ".." FirstSegment (_ Segment):* {%
    ([,first,rest]) => ["recursive", first, ...rest.map(x => x[1])]
  %}

Subscript -> "[" SubscriptContent "]" {% nth(1) %}

SubscriptContent ->
    KeyOrIndex ("," KeyOrIndex):* {%
      ([first, rest]) =>
        rest.length
          ? ["multi", first, ...rest.map(x => x[1])]
          : first
    %}
  | Slice {% id %}
  | Filter {% id %}

Slice -> Index:? _ ":" Index:? (_ ":" Index):? _ {%
    ([from,,,to,step,]) => ["slice", from, to, step && step[2]]
  %}

Filter -> _ "?(" Expression ")" _ {% ([,,expr,]) => ["filter", expr] %}

Index ->
    _ int _ {% ([,n,]) => ["index", n] %}
  | _ "(" Expression ")" _ {% ([,,expr,,]) => ["expression", expr] %}

KeyOrIndex ->
    _ QuotedString _ {% ([,id,]) => ["key", id] %}
  | Index {% id %}

Identifier -> [a-zA-Z_] [a-zA-Z0-9_-]:* {%
    ([start, rest]) => rest.reduce((x, y) => x + y, start)
  %}

QuotedString -> dqstring {% id %} | sqstring {% id %}

Wildcard -> "*" {% () => ["wildcard"] %}

Expression -> Conditional {% id %}

Conditional ->
    Or "?" Conditional ":" Conditional {% ([i,,t,,e]) => ["if", i, t, e] %}
  | Or {% id %}

Or ->
    And "||" Or {% ([l,,r]) => ["||", l, r] %}
  | And {% id %}

And ->
    Comparison "&&" And  {% ([l,,r]) => ["&&", l, r] %}
  | Comparison {% id %}

Comparison ->
    Sum ("<"|"<="|"=="|"="|"!="|">="|">") Sum {%
      ([l,[op],r]) => [op === "=" ? "==" : op, l, r]
    %}
  | Sum {% id %}

Sum ->
    Sum ("+"|"-") Product {% ([l,[op],r]) => [op, l, r] %}
  | Product {% id %}

Product ->
    Product ("*"|"/"|"%") Negation {% ([l,[op],r]) => [op, l, r] %}
  | Negation {% id %}

Negation ->
    _ "-" Not {% ([,,x]) => ["neg", x] %}
  | Not {% id %}

Not ->
    _ "!" Not {% ([,,x]) => ["!", x] %}
  | ExprSubscript {% id %}

ExprSubscript ->
  Atom ExprSuffix:* {%
    ([root, suffixes]) =>
      suffixes.reduce(
        (into, suffix) =>
          suffix ? ["subscript", into, suffix] : ["length", into],
        root
      )
  %}

ExprSuffix ->
    "." _ Identifier _ {% ([,,id,]) => id !== "length" && ["literal", id] %}
  | "[" Expression "]" _ {% ([,expr,,]) => expr %}

Atom -> _ (
      "(" Expression ")" {% nth(1) %}
    | Call {% id %}
    | Literal {% id %}
    | Variable {% id %}
    | Self {% id %}
  ) _ {% nth(1) %}

Call -> Identifier _ "(" (Expression ("," Expression):*):? ")" {%
    ([name,,,args,]) =>
      args
        ? ["call", name, args[0], ...args[1].map(x => x[1])]
        : ["call", name]
  %}

Variable -> "$" Identifier {% ([,id]) => ["variable", id] %}

Literal ->
    decimal {% ([x]) => ["literal", x] %}
  | QuotedString {% ([x]) => ["literal", x] %}
  | "true" {% () => ["literal", true] %}
  | "false" {% () => ["literal", false] %}
  | "null" {% () => ["literal", null] %}

Self -> "@" {% () => ["self"] %}
