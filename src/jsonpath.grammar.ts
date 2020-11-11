// Generated automatically by nearley, version 2.19.7
// http://github.com/Hardmath123/nearley
// Bypasses TS6133. Allow declared but unused functions.
// @ts-ignore
function id(d: any[]): any {
  return d[0];
}

// Bypasses TS6133. Allow declared but unused functions.
// @ts-ignore
function nth(n) {
  return function (d) {
    return d[n];
  };
}

// Bypasses TS6133. Allow declared but unused functions.
// @ts-ignore
function $(o) {
  return function (d) {
    var ret = {};
    Object.keys(o).forEach(function (k) {
      ret[k] = d[o[k]];
    });
    return ret;
  };
}

interface NearleyToken {
  value: any;
  [key: string]: any;
}

interface NearleyLexer {
  reset: (chunk: string, info: any) => void;
  next: () => NearleyToken | undefined;
  save: () => any;
  formatError: (token: NearleyToken) => string;
  has: (tokenType: string) => boolean;
}

interface NearleyRule {
  name: string;
  symbols: NearleySymbol[];
  postprocess?: (d: any[], loc?: number, reject?: {}) => any;
}

type NearleySymbol =
  | string
  | { literal: any }
  | { test: (token: any) => boolean };

interface Grammar {
  Lexer: NearleyLexer | undefined;
  ParserRules: NearleyRule[];
  ParserStart: string;
}

const grammar: Grammar = {
  Lexer: undefined,
  ParserRules: [
    { name: '_$ebnf$1', symbols: [] },
    {
      name: '_$ebnf$1',
      symbols: ['_$ebnf$1', 'wschar'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: '_',
      symbols: ['_$ebnf$1'],
      postprocess: function (d) {
        return null;
      },
    },
    { name: '__$ebnf$1', symbols: ['wschar'] },
    {
      name: '__$ebnf$1',
      symbols: ['__$ebnf$1', 'wschar'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: '__',
      symbols: ['__$ebnf$1'],
      postprocess: function (d) {
        return null;
      },
    },
    { name: 'wschar', symbols: [/[ \t\n\v\f]/], postprocess: id },
    { name: 'unsigned_int$ebnf$1', symbols: [/[0-9]/] },
    {
      name: 'unsigned_int$ebnf$1',
      symbols: ['unsigned_int$ebnf$1', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'unsigned_int',
      symbols: ['unsigned_int$ebnf$1'],
      postprocess: function (d) {
        return parseInt(d[0].join(''));
      },
    },
    { name: 'int$ebnf$1$subexpression$1', symbols: [{ literal: '-' }] },
    { name: 'int$ebnf$1$subexpression$1', symbols: [{ literal: '+' }] },
    {
      name: 'int$ebnf$1',
      symbols: ['int$ebnf$1$subexpression$1'],
      postprocess: id,
    },
    { name: 'int$ebnf$1', symbols: [], postprocess: () => null },
    { name: 'int$ebnf$2', symbols: [/[0-9]/] },
    {
      name: 'int$ebnf$2',
      symbols: ['int$ebnf$2', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'int',
      symbols: ['int$ebnf$1', 'int$ebnf$2'],
      postprocess: function (d) {
        if (d[0]) {
          return parseInt(d[0][0] + d[1].join(''));
        } else {
          return parseInt(d[1].join(''));
        }
      },
    },
    { name: 'unsigned_decimal$ebnf$1', symbols: [/[0-9]/] },
    {
      name: 'unsigned_decimal$ebnf$1',
      symbols: ['unsigned_decimal$ebnf$1', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'unsigned_decimal$ebnf$2$subexpression$1$ebnf$1',
      symbols: [/[0-9]/],
    },
    {
      name: 'unsigned_decimal$ebnf$2$subexpression$1$ebnf$1',
      symbols: ['unsigned_decimal$ebnf$2$subexpression$1$ebnf$1', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'unsigned_decimal$ebnf$2$subexpression$1',
      symbols: [
        { literal: '.' },
        'unsigned_decimal$ebnf$2$subexpression$1$ebnf$1',
      ],
    },
    {
      name: 'unsigned_decimal$ebnf$2',
      symbols: ['unsigned_decimal$ebnf$2$subexpression$1'],
      postprocess: id,
    },
    { name: 'unsigned_decimal$ebnf$2', symbols: [], postprocess: () => null },
    {
      name: 'unsigned_decimal',
      symbols: ['unsigned_decimal$ebnf$1', 'unsigned_decimal$ebnf$2'],
      postprocess: function (d) {
        return parseFloat(d[0].join('') + (d[1] ? '.' + d[1][1].join('') : ''));
      },
    },
    { name: 'decimal$ebnf$1', symbols: [{ literal: '-' }], postprocess: id },
    { name: 'decimal$ebnf$1', symbols: [], postprocess: () => null },
    { name: 'decimal$ebnf$2', symbols: [/[0-9]/] },
    {
      name: 'decimal$ebnf$2',
      symbols: ['decimal$ebnf$2', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: 'decimal$ebnf$3$subexpression$1$ebnf$1', symbols: [/[0-9]/] },
    {
      name: 'decimal$ebnf$3$subexpression$1$ebnf$1',
      symbols: ['decimal$ebnf$3$subexpression$1$ebnf$1', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'decimal$ebnf$3$subexpression$1',
      symbols: [{ literal: '.' }, 'decimal$ebnf$3$subexpression$1$ebnf$1'],
    },
    {
      name: 'decimal$ebnf$3',
      symbols: ['decimal$ebnf$3$subexpression$1'],
      postprocess: id,
    },
    { name: 'decimal$ebnf$3', symbols: [], postprocess: () => null },
    {
      name: 'decimal',
      symbols: ['decimal$ebnf$1', 'decimal$ebnf$2', 'decimal$ebnf$3'],
      postprocess: function (d) {
        return parseFloat(
          (d[0] || '') + d[1].join('') + (d[2] ? '.' + d[2][1].join('') : '')
        );
      },
    },
    {
      name: 'percentage',
      symbols: ['decimal', { literal: '%' }],
      postprocess: function (d) {
        return d[0] / 100;
      },
    },
    { name: 'jsonfloat$ebnf$1', symbols: [{ literal: '-' }], postprocess: id },
    { name: 'jsonfloat$ebnf$1', symbols: [], postprocess: () => null },
    { name: 'jsonfloat$ebnf$2', symbols: [/[0-9]/] },
    {
      name: 'jsonfloat$ebnf$2',
      symbols: ['jsonfloat$ebnf$2', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: 'jsonfloat$ebnf$3$subexpression$1$ebnf$1', symbols: [/[0-9]/] },
    {
      name: 'jsonfloat$ebnf$3$subexpression$1$ebnf$1',
      symbols: ['jsonfloat$ebnf$3$subexpression$1$ebnf$1', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'jsonfloat$ebnf$3$subexpression$1',
      symbols: [{ literal: '.' }, 'jsonfloat$ebnf$3$subexpression$1$ebnf$1'],
    },
    {
      name: 'jsonfloat$ebnf$3',
      symbols: ['jsonfloat$ebnf$3$subexpression$1'],
      postprocess: id,
    },
    { name: 'jsonfloat$ebnf$3', symbols: [], postprocess: () => null },
    {
      name: 'jsonfloat$ebnf$4$subexpression$1$ebnf$1',
      symbols: [/[+-]/],
      postprocess: id,
    },
    {
      name: 'jsonfloat$ebnf$4$subexpression$1$ebnf$1',
      symbols: [],
      postprocess: () => null,
    },
    { name: 'jsonfloat$ebnf$4$subexpression$1$ebnf$2', symbols: [/[0-9]/] },
    {
      name: 'jsonfloat$ebnf$4$subexpression$1$ebnf$2',
      symbols: ['jsonfloat$ebnf$4$subexpression$1$ebnf$2', /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'jsonfloat$ebnf$4$subexpression$1',
      symbols: [
        /[eE]/,
        'jsonfloat$ebnf$4$subexpression$1$ebnf$1',
        'jsonfloat$ebnf$4$subexpression$1$ebnf$2',
      ],
    },
    {
      name: 'jsonfloat$ebnf$4',
      symbols: ['jsonfloat$ebnf$4$subexpression$1'],
      postprocess: id,
    },
    { name: 'jsonfloat$ebnf$4', symbols: [], postprocess: () => null },
    {
      name: 'jsonfloat',
      symbols: [
        'jsonfloat$ebnf$1',
        'jsonfloat$ebnf$2',
        'jsonfloat$ebnf$3',
        'jsonfloat$ebnf$4',
      ],
      postprocess: function (d) {
        return parseFloat(
          (d[0] || '') +
            d[1].join('') +
            (d[2] ? '.' + d[2][1].join('') : '') +
            (d[3] ? 'e' + (d[3][1] || '+') + d[3][2].join('') : '')
        );
      },
    },
    { name: 'dqstring$ebnf$1', symbols: [] },
    {
      name: 'dqstring$ebnf$1',
      symbols: ['dqstring$ebnf$1', 'dstrchar'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'dqstring',
      symbols: [{ literal: '"' }, 'dqstring$ebnf$1', { literal: '"' }],
      postprocess: function (d) {
        return d[1].join('');
      },
    },
    { name: 'sqstring$ebnf$1', symbols: [] },
    {
      name: 'sqstring$ebnf$1',
      symbols: ['sqstring$ebnf$1', 'sstrchar'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'sqstring',
      symbols: [{ literal: "'" }, 'sqstring$ebnf$1', { literal: "'" }],
      postprocess: function (d) {
        return d[1].join('');
      },
    },
    { name: 'btstring$ebnf$1', symbols: [] },
    {
      name: 'btstring$ebnf$1',
      symbols: ['btstring$ebnf$1', /[^`]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'btstring',
      symbols: [{ literal: '`' }, 'btstring$ebnf$1', { literal: '`' }],
      postprocess: function (d) {
        return d[1].join('');
      },
    },
    { name: 'dstrchar', symbols: [/[^\\"\n]/], postprocess: id },
    {
      name: 'dstrchar',
      symbols: [{ literal: '\\' }, 'strescape'],
      postprocess: function (d) {
        return JSON.parse('"' + d.join('') + '"');
      },
    },
    { name: 'sstrchar', symbols: [/[^\\'\n]/], postprocess: id },
    {
      name: 'sstrchar',
      symbols: [{ literal: '\\' }, 'strescape'],
      postprocess: function (d) {
        return JSON.parse('"' + d.join('') + '"');
      },
    },
    {
      name: 'sstrchar$string$1',
      symbols: [{ literal: '\\' }, { literal: "'" }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'sstrchar',
      symbols: ['sstrchar$string$1'],
      postprocess: function (d) {
        return "'";
      },
    },
    { name: 'strescape', symbols: [/["\\/bfnrt]/], postprocess: id },
    {
      name: 'strescape',
      symbols: [
        { literal: 'u' },
        /[a-fA-F0-9]/,
        /[a-fA-F0-9]/,
        /[a-fA-F0-9]/,
        /[a-fA-F0-9]/,
      ],
      postprocess: function (d) {
        return d.join('');
      },
    },
    { name: 'Path$ebnf$1$subexpression$1', symbols: ['_', { literal: '$' }] },
    {
      name: 'Path$ebnf$1',
      symbols: ['Path$ebnf$1$subexpression$1'],
      postprocess: id,
    },
    { name: 'Path$ebnf$1', symbols: [], postprocess: () => null },
    { name: 'Path$ebnf$2', symbols: [] },
    { name: 'Path$ebnf$2$subexpression$1', symbols: ['_', 'Segment'] },
    {
      name: 'Path$ebnf$2',
      symbols: ['Path$ebnf$2', 'Path$ebnf$2$subexpression$1'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'Path',
      symbols: ['Path$ebnf$1', 'Path$ebnf$2', '_'],
      postprocess: ([, segments]) => segments.map((x) => x[1]),
    },
    { name: 'Segment', symbols: ['Wildcard'], postprocess: id },
    {
      name: 'Segment',
      symbols: [{ literal: '.' }, 'Identifier'],
      postprocess: ([, id]) => ['key', id],
    },
    { name: 'Segment', symbols: ['Subscript'], postprocess: id },
    { name: 'Segment', symbols: ['RecursiveDescent'], postprocess: id },
    { name: 'FirstSegment', symbols: ['Wildcard'], postprocess: id },
    {
      name: 'FirstSegment',
      symbols: ['Identifier'],
      postprocess: ([id]) => ['key', id],
    },
    { name: 'FirstSegment', symbols: ['Subscript'], postprocess: id },
    {
      name: 'RecursiveDescent$string$1',
      symbols: [{ literal: '.' }, { literal: '.' }],
      postprocess: (d) => d.join(''),
    },
    { name: 'RecursiveDescent$ebnf$1', symbols: [] },
    {
      name: 'RecursiveDescent$ebnf$1$subexpression$1',
      symbols: ['_', 'Segment'],
    },
    {
      name: 'RecursiveDescent$ebnf$1',
      symbols: [
        'RecursiveDescent$ebnf$1',
        'RecursiveDescent$ebnf$1$subexpression$1',
      ],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'RecursiveDescent',
      symbols: [
        'RecursiveDescent$string$1',
        'FirstSegment',
        'RecursiveDescent$ebnf$1',
      ],
      postprocess: ([, first, rest]) => [
        'recursive',
        first,
        ...rest.map((x) => x[1]),
      ],
    },
    {
      name: 'Subscript',
      symbols: [{ literal: '[' }, 'SubscriptContent', { literal: ']' }],
      postprocess: nth(1),
    },
    { name: 'SubscriptContent$ebnf$1', symbols: [] },
    {
      name: 'SubscriptContent$ebnf$1$subexpression$1',
      symbols: [{ literal: ',' }, 'KeyOrIndex'],
    },
    {
      name: 'SubscriptContent$ebnf$1',
      symbols: [
        'SubscriptContent$ebnf$1',
        'SubscriptContent$ebnf$1$subexpression$1',
      ],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'SubscriptContent',
      symbols: ['KeyOrIndex', 'SubscriptContent$ebnf$1'],
      postprocess: ([first, rest]) =>
        rest.length ? ['multi', first, ...rest.map((x) => x[1])] : first,
    },
    { name: 'SubscriptContent', symbols: ['Slice'], postprocess: id },
    { name: 'SubscriptContent', symbols: ['Filter'], postprocess: id },
    { name: 'Slice$ebnf$1', symbols: ['Index'], postprocess: id },
    { name: 'Slice$ebnf$1', symbols: [], postprocess: () => null },
    { name: 'Slice$ebnf$2', symbols: ['Index'], postprocess: id },
    { name: 'Slice$ebnf$2', symbols: [], postprocess: () => null },
    {
      name: 'Slice$ebnf$3$subexpression$1',
      symbols: ['_', { literal: ':' }, 'Index'],
    },
    {
      name: 'Slice$ebnf$3',
      symbols: ['Slice$ebnf$3$subexpression$1'],
      postprocess: id,
    },
    { name: 'Slice$ebnf$3', symbols: [], postprocess: () => null },
    {
      name: 'Slice',
      symbols: [
        'Slice$ebnf$1',
        '_',
        { literal: ':' },
        'Slice$ebnf$2',
        'Slice$ebnf$3',
        '_',
      ],
      postprocess: ([from, , to, step]) => ['slice', from, to, step && step[2]],
    },
    {
      name: 'Filter$string$1',
      symbols: [{ literal: '?' }, { literal: '(' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Filter',
      symbols: ['_', 'Filter$string$1', 'Expression', { literal: ')' }, '_'],
      postprocess: ([, , expr]) => ['filter', expr],
    },
    {
      name: 'Index',
      symbols: ['_', 'int', '_'],
      postprocess: ([, n]) => ['index', n],
    },
    {
      name: 'Index',
      symbols: ['_', { literal: '(' }, 'Expression', { literal: ')' }, '_'],
      postprocess: ([, , expr, ,]) => ['expression', expr],
    },
    {
      name: 'KeyOrIndex',
      symbols: ['_', 'QuotedString', '_'],
      postprocess: ([, id]) => ['key', id],
    },
    { name: 'KeyOrIndex', symbols: ['Index'], postprocess: id },
    { name: 'Identifier$ebnf$1', symbols: [] },
    {
      name: 'Identifier$ebnf$1',
      symbols: ['Identifier$ebnf$1', /[a-zA-Z0-9_-]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'Identifier',
      symbols: [/[a-zA-Z_]/, 'Identifier$ebnf$1'],
      postprocess: ([start, rest]) => rest.reduce((x, y) => x + y, start),
    },
    { name: 'QuotedString', symbols: ['dqstring'], postprocess: id },
    { name: 'QuotedString', symbols: ['sqstring'], postprocess: id },
    {
      name: 'Wildcard',
      symbols: [{ literal: '*' }],
      postprocess: () => ['wildcard'],
    },
    { name: 'Expression', symbols: ['Conditional'], postprocess: id },
    {
      name: 'Conditional',
      symbols: [
        'Or',
        { literal: '?' },
        'Conditional',
        { literal: ':' },
        'Conditional',
      ],
      postprocess: ([i, , t, , e]) => ['if', i, t, e],
    },
    { name: 'Conditional', symbols: ['Or'], postprocess: id },
    {
      name: 'Or$string$1',
      symbols: [{ literal: '|' }, { literal: '|' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Or',
      symbols: ['And', 'Or$string$1', 'Or'],
      postprocess: ([l, , r]) => ['||', l, r],
    },
    { name: 'Or', symbols: ['And'], postprocess: id },
    {
      name: 'And$string$1',
      symbols: [{ literal: '&' }, { literal: '&' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'And',
      symbols: ['Comparison', 'And$string$1', 'And'],
      postprocess: ([l, , r]) => ['&&', l, r],
    },
    { name: 'And', symbols: ['Comparison'], postprocess: id },
    { name: 'Comparison$subexpression$1', symbols: [{ literal: '<' }] },
    {
      name: 'Comparison$subexpression$1$string$1',
      symbols: [{ literal: '<' }, { literal: '=' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Comparison$subexpression$1',
      symbols: ['Comparison$subexpression$1$string$1'],
    },
    {
      name: 'Comparison$subexpression$1$string$2',
      symbols: [{ literal: '=' }, { literal: '=' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Comparison$subexpression$1',
      symbols: ['Comparison$subexpression$1$string$2'],
    },
    { name: 'Comparison$subexpression$1', symbols: [{ literal: '=' }] },
    {
      name: 'Comparison$subexpression$1$string$3',
      symbols: [{ literal: '!' }, { literal: '=' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Comparison$subexpression$1',
      symbols: ['Comparison$subexpression$1$string$3'],
    },
    {
      name: 'Comparison$subexpression$1$string$4',
      symbols: [{ literal: '>' }, { literal: '=' }],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Comparison$subexpression$1',
      symbols: ['Comparison$subexpression$1$string$4'],
    },
    { name: 'Comparison$subexpression$1', symbols: [{ literal: '>' }] },
    {
      name: 'Comparison',
      symbols: ['Sum', 'Comparison$subexpression$1', 'Sum'],
      postprocess: ([l, [op], r]) => [op, l, r],
    },
    { name: 'Comparison', symbols: ['Sum'], postprocess: id },
    { name: 'Sum$subexpression$1', symbols: [{ literal: '+' }] },
    { name: 'Sum$subexpression$1', symbols: [{ literal: '-' }] },
    {
      name: 'Sum',
      symbols: ['Sum', 'Sum$subexpression$1', 'Product'],
      postprocess: ([l, [op], r]) => [op, l, r],
    },
    { name: 'Sum', symbols: ['Product'], postprocess: id },
    { name: 'Product$subexpression$1', symbols: [{ literal: '*' }] },
    { name: 'Product$subexpression$1', symbols: [{ literal: '/' }] },
    { name: 'Product$subexpression$1', symbols: [{ literal: '%' }] },
    {
      name: 'Product',
      symbols: ['Product', 'Product$subexpression$1', 'Negation'],
      postprocess: ([l, [op], r]) => [op, l, r],
    },
    { name: 'Product', symbols: ['Negation'], postprocess: id },
    {
      name: 'Negation',
      symbols: ['_', { literal: '-' }, 'Not'],
      postprocess: ([, , x]) => ['neg', x],
    },
    { name: 'Negation', symbols: ['Not'], postprocess: id },
    {
      name: 'Not',
      symbols: ['_', { literal: '!' }, 'Not'],
      postprocess: ([, , x]) => ['!', x],
    },
    { name: 'Not', symbols: ['ExprSubscript'], postprocess: id },
    { name: 'ExprSubscript$ebnf$1', symbols: [] },
    {
      name: 'ExprSubscript$ebnf$1',
      symbols: ['ExprSubscript$ebnf$1', 'ExprSuffix'],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'ExprSubscript',
      symbols: ['Atom', 'ExprSubscript$ebnf$1'],
      postprocess: ([root, suffixes]) =>
        suffixes.reduce((into, suffix) => ['subscript', into, suffix], root),
    },
    {
      name: 'ExprSuffix',
      symbols: [{ literal: '.' }, '_', 'Identifier', '_'],
      postprocess: ([, , id]) => ['literal', id],
    },
    {
      name: 'ExprSuffix',
      symbols: [{ literal: '[' }, 'Expression', { literal: ']' }, '_'],
      postprocess: ([, expr, ,]) => expr,
    },
    {
      name: 'Atom$subexpression$1',
      symbols: [{ literal: '(' }, 'Expression', { literal: ')' }],
      postprocess: nth(1),
    },
    { name: 'Atom$subexpression$1', symbols: ['Call'], postprocess: id },
    { name: 'Atom$subexpression$1', symbols: ['Literal'], postprocess: id },
    { name: 'Atom$subexpression$1', symbols: ['Variable'], postprocess: id },
    { name: 'Atom$subexpression$1', symbols: ['Self'], postprocess: id },
    {
      name: 'Atom',
      symbols: ['_', 'Atom$subexpression$1', '_'],
      postprocess: nth(1),
    },
    { name: 'Call$ebnf$1$subexpression$1$ebnf$1', symbols: [] },
    {
      name: 'Call$ebnf$1$subexpression$1$ebnf$1$subexpression$1',
      symbols: [{ literal: ',' }, 'Expression'],
    },
    {
      name: 'Call$ebnf$1$subexpression$1$ebnf$1',
      symbols: [
        'Call$ebnf$1$subexpression$1$ebnf$1',
        'Call$ebnf$1$subexpression$1$ebnf$1$subexpression$1',
      ],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: 'Call$ebnf$1$subexpression$1',
      symbols: ['Expression', 'Call$ebnf$1$subexpression$1$ebnf$1'],
    },
    {
      name: 'Call$ebnf$1',
      symbols: ['Call$ebnf$1$subexpression$1'],
      postprocess: id,
    },
    { name: 'Call$ebnf$1', symbols: [], postprocess: () => null },
    {
      name: 'Call',
      symbols: [
        'Identifier',
        '_',
        { literal: '(' },
        'Call$ebnf$1',
        { literal: ')' },
      ],
      postprocess: ([name, , , args]) =>
        args
          ? ['call', name, args[0], ...args[1].map((x) => x[1])]
          : ['call', name],
    },
    {
      name: 'Variable',
      symbols: [{ literal: '$' }, 'Identifier'],
      postprocess: ([, id]) => ['variable', id],
    },
    {
      name: 'Literal',
      symbols: ['decimal'],
      postprocess: ([x]) => ['literal', x],
    },
    {
      name: 'Literal',
      symbols: ['QuotedString'],
      postprocess: ([x]) => ['literal', x],
    },
    {
      name: 'Literal$string$1',
      symbols: [
        { literal: 't' },
        { literal: 'r' },
        { literal: 'u' },
        { literal: 'e' },
      ],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Literal',
      symbols: ['Literal$string$1'],
      postprocess: () => ['literal', true],
    },
    {
      name: 'Literal$string$2',
      symbols: [
        { literal: 'f' },
        { literal: 'a' },
        { literal: 'l' },
        { literal: 's' },
        { literal: 'e' },
      ],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Literal',
      symbols: ['Literal$string$2'],
      postprocess: () => ['literal', false],
    },
    {
      name: 'Literal$string$3',
      symbols: [
        { literal: 'n' },
        { literal: 'u' },
        { literal: 'l' },
        { literal: 'l' },
      ],
      postprocess: (d) => d.join(''),
    },
    {
      name: 'Literal',
      symbols: ['Literal$string$3'],
      postprocess: () => ['literal', null],
    },
    { name: 'Self', symbols: [{ literal: '@' }], postprocess: () => ['self'] },
  ],
  ParserStart: 'Path',
};

export default grammar;
