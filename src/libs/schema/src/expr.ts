// Safe arithmetic over entry values for metric `expr` terms (e.g. "reps * weight_kg").
// Whitelist grammar: numbers, parameter keys, + - * /, parentheses. Never evaluated as code.

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: Node; r: Node };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([a-z][a-z0-9_]*)|([+\-*/()]))/y;

/** Parses an expression once; throws on anything outside the grammar. */
export function parseExpr(src: string): Node {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    const before = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) {
      if (src.slice(before).trim() === '') break;
      throw new Error(`Unexpected input at ${before} in "${src}"`);
    }
    tokens.push(m[1] ?? m[2] ?? m[3]!);
  }
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const primary = (): Node => {
    const tok = take();
    if (tok === undefined) throw new Error(`Unexpected end of "${src}"`);
    if (tok === '(') {
      const e = sum();
      if (take() !== ')') throw new Error(`Missing ) in "${src}"`);
      return e;
    }
    if (tok === '-') return { t: 'neg', e: primary() };
    if (/^\d/.test(tok)) return { t: 'num', v: Number(tok) };
    if (/^[a-z]/.test(tok)) return { t: 'var', name: tok };
    throw new Error(`Unexpected "${tok}" in "${src}"`);
  };
  const product = (): Node => {
    let l = primary();
    while (peek() === '*' || peek() === '/') l = { t: 'bin', op: take() as '*' | '/', l, r: primary() };
    return l;
  };
  const sum = (): Node => {
    let l = product();
    while (peek() === '+' || peek() === '-') l = { t: 'bin', op: take() as '+' | '-', l, r: product() };
    return l;
  };
  const tree = sum();
  if (i !== tokens.length) throw new Error(`Trailing input in "${src}"`);
  return tree;
}

export function exprVariables(node: Node, out = new Set<string>()): Set<string> {
  if (node.t === 'var') out.add(node.name);
  else if (node.t === 'neg') exprVariables(node.e, out);
  else if (node.t === 'bin') {
    exprVariables(node.l, out);
    exprVariables(node.r, out);
  }
  return out;
}

/** Evaluates against one entry; any missing/non-numeric variable makes the result undefined. */
export function evalExpr(node: Node, values: Record<string, unknown>): number | undefined {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'var': {
      const v = values[node.name];
      return typeof v === 'number' ? v : undefined;
    }
    case 'neg': {
      const v = evalExpr(node.e, values);
      return v === undefined ? undefined : -v;
    }
    case 'bin': {
      const l = evalExpr(node.l, values);
      const r = evalExpr(node.r, values);
      if (l === undefined || r === undefined) return undefined;
      if (node.op === '+') return l + r;
      if (node.op === '-') return l - r;
      if (node.op === '*') return l * r;
      return r === 0 ? undefined : l / r;
    }
  }
}

export type ExprNode = Node;
