// Only this grammar is accepted. Source text is never executed as JavaScript.
export function dslError(token, message) {
  const error = new Error(`${token.line}行 ${token.column}列: ${message}`);
  error.line = token.line;
  error.column = token.column;
  return error;
}

function tokenize(source) {
  if (source.length > 100_000) throw new Error("DSL は10万文字以内にしてください。");
  const tokens = [];
  let offset = 0, line = 1, column = 1;
  const advance = text => {
    for (const c of text) {
      if (c === "\n") { line++; column = 1; } else column++;
    }
    offset += text.length;
  };
  while (offset < source.length) {
    const rest = source.slice(offset), location = { line, column };
    const skip = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (skip) { advance(skip[0]); continue; }
    const match = /^(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|("(?:[^"\\\r\n]|\\["\\nrt])*")|(\*\*|<=|>=|==|!=|&&|\|\||[{}()[\],;=+*/%?:!<>-]))/.exec(rest);
    if (!match) throw dslError(location, `解釈できない文字です: ${rest[0]}`);
    const value = match[1] ? Number(match[1]) : match[3] ? JSON.parse(match[3]) : match[0];
    if (match[1] && !Number.isFinite(value)) throw dslError(location, "数値が大きすぎます。");
    tokens.push({ ...location, value, kind: match[1] ? "number" : match[2] ? "id" : match[3] ? "string" : "symbol" });
    advance(match[0]);
  }
  tokens.push({ value: "<end>", kind: "end", line, column });
  return tokens;
}

const precedence = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "**": 7 };

export function parseScene(source) {
  const tokens = tokenize(source);
  let index = 0, depth = 0;
  const peek = () => tokens[index];
  const take = value => peek().value === value && ["symbol", "id"].includes(peek().kind)
    ? tokens[index++] : null;
  const expect = value => {
    const token = take(value);
    if (!token) throw dslError(peek(), `「${value}」が必要です。`);
    return token;
  };
  const identifier = () => {
    if (peek().kind !== "id") throw dslError(peek(), "名前が必要です。");
    return tokens[index++];
  };
  function expression(min = 0) {
    if (++depth > 64) throw dslError(peek(), "式の入れ子が深すぎます。");
    const token = peek();
    let node;
    if (take("-") || take("+") || take("!")) node = { type: "unary", token, arg: expression(7) };
    else if (take("(")) { node = expression(); expect(")"); }
    else if (take("[")) {
      const values = [];
      if (!take("]")) {
        do { values.push(expression()); } while (take(","));
        expect("]");
      }
      node = { type: "array", values, token };
    } else if (token.kind === "number" || token.kind === "string") {
      index++; node = { type: "literal", value: token.value, token };
    } else {
      const name = identifier();
      if (take("(")) {
        const args = [];
        if (!take(")")) {
          do { args.push(expression()); } while (take(","));
          expect(")");
        }
        node = { type: "call", name: name.value, args, token };
      } else node = { type: "name", name: name.value, token };
    }
    while (peek().kind === "symbol" && (precedence[peek().value] ?? -1) >= min) {
      const operator = tokens[index++], p = precedence[operator.value];
      node = { type: "binary", token: operator, left: node, right: expression(p + (operator.value === "**" ? 0 : 1)) };
    }
    if (min === 0 && take("?")) {
      const yes = expression(); expect(":");
      node = { type: "conditional", condition: node, yes, no: expression(), token };
    }
    depth--;
    return node;
  }
  function binding() {
    const name = identifier(); expect("=");
    const value = expression(); expect(";");
    return { name: name.value, value, token: name };
  }
  function blockEntry(token) {
    let reference;
    if (peek().kind === "id") reference = identifier();
    if (peek().value === "{" || reference) {
      if (++depth > 16) throw dslError(token, "設定の入れ子が深すぎます。");
      const entry = { block: block(), reference, token }; depth--;
      return entry;
    }
    expect("="); const value = expression(); expect(";");
    return { value, token };
  }
  function block() {
    expect("{");
    const entries = new Map();
    while (!take("}")) {
      const key = identifier();
      if (entries.has(key.value)) throw dslError(key, `「${key.value}」が重複しています。`);
      entries.set(key.value, blockEntry(key));
    }
    return entries;
  }
  const constants = [], sdfs = new Map(), defines = new Map(), objects = [];
  let defaults = { block: new Map() }, lighting = { block: new Map() }, seed, sceneSeen = false, versionSeen = false;
  while (peek().kind !== "end") {
    const token = identifier();
    if (token.value === "version") {
      if (versionSeen) throw dslError(token, "version が重複しています。");
      versionSeen = true;
      if (peek().kind !== "number" || peek().value !== 1) throw dslError(peek(), "対応するversionは1です。");
      index++; expect(";");
    } else if (token.value === "let") constants.push(binding());
    else if (token.value === "define") {
      const name = identifier();
      if (defines.has(name.value)) throw dslError(name, "define名が重複しています。");
      // A definition may extend another definition: define shortFur fur { ... }
      defines.set(name.value, blockEntry(name));
    } else if (token.value === "sdf") {
      const name = identifier();
      if (sdfs.has(name.value)) throw dslError(name, "SDF名が重複しています。");
      expect("(");
      const parameters = [identifier()];
      while (take(",")) parameters.push(identifier());
      expect(")"); expect("{");
      const locals = [];
      while (take("let")) locals.push(binding());
      expect("return"); const result = expression(); expect(";"); expect("}");
      if (parameters.length !== 3) throw dslError(name, "SDFの引数は3つ必要です。");
      sdfs.set(name.value, { token: name, parameters, locals, result });
    } else if (token.value === "scene") {
      if (sceneSeen) throw dslError(token, "scene は1つだけ定義してください。");
      sceneSeen = true; expect("{");
      const fields = new Set(), names = new Set();
      while (!take("}")) {
        const field = identifier();
        if (field.value === "object") {
          const name = identifier();
          if (names.has(name.value)) throw dslError(name, "object名が重複しています。");
          names.add(name.value);
          objects.push({ name: name.value, token: name, entries: block() });
        } else {
          if (fields.has(field.value)) throw dslError(field, "設定が重複しています。");
          fields.add(field.value);
          if (field.value === "defaults") defaults = blockEntry(field);
          else if (field.value === "lighting") lighting = blockEntry(field);
          else if (field.value === "seed") { expect("="); seed = { value: expression(), token: field }; expect(";"); }
          else throw dslError(field, `sceneに「${field.value}」は指定できません。`);
        }
      }
    } else throw dslError(token, `未知の宣言です: ${token.value}`);
  }
  if (!sceneSeen || !objects.length) throw dslError(peek(), "scene にobjectを1つ以上定義してください。");
  return { constants, sdfs, defines, objects, defaults, lighting, seed };
}

const builtins = {
  abs: [Math.abs, 1], sqrt: [Math.sqrt, 1], sin: [Math.sin, 1], cos: [Math.cos, 1], tan: [Math.tan, 1],
  floor: [Math.floor, 1], ceil: [Math.ceil, 1], round: [Math.round, 1], sign: [Math.sign, 1],
  exp: [Math.exp, 1], log: [Math.log, 1], pow: [Math.pow, 2], atan2: [Math.atan2, 2],
  min: [Math.min, 2, Infinity], max: [Math.max, 2, Infinity],
  length: [v => Math.hypot(...v), 1],
  clamp: [(v, a, b) => Math.max(a, Math.min(b, v)), 3],
  mix: [(a, b, t) => a * (1 - t) + b * t, 3],
  sphere: [(x, y, z, r) => Math.hypot(x, y, z) - r, 4],
  torus: [(x, y, z, major, minor) => Math.hypot(Math.hypot(x, z) - major, y) - minor, 5],
  box: [(x, y, z, a, b, c) => {
    const q = [Math.abs(x) - a, Math.abs(y) - b, Math.abs(z) - c];
    return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0);
  }, 6],
  union: [Math.min, 2, Infinity], intersection: [Math.max, 2, Infinity],
  subtract: [(a, b) => Math.max(a, -b), 2],
  smoothUnion: [(a, b, k) => {
    if (!(k > 0)) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  }, 3],
};

// Compile validated expression nodes, never fragments from the original source.
export function compileDefinitions(ast) {
  const constants = new Map([["pi", Math.PI], ["true", true], ["false", false]]);
  const functions = Object.create(null), dependencies = new Map();
  const builtinFunctions = Object.fromEntries(Object.entries(builtins).map(([name, [fn]]) => [name, fn]));
  function code(node, scope, calls, allowSdfs) {
    switch (node.type) {
      case "literal": return JSON.stringify(node.value);
      case "name": {
        if (scope.has(node.name)) return scope.get(node.name);
        if (constants.has(node.name)) return JSON.stringify(constants.get(node.name));
        throw dslError(node.token, `未定義の名前です: ${node.name}`);
      }
      case "array": return `[${node.values.map(v => code(v, scope, calls, allowSdfs)).join(",")}]`;
      case "unary": return `(${node.token.value}${code(node.arg, scope, calls, allowSdfs)})`;
      case "binary": return `(${code(node.left, scope, calls, allowSdfs)} ${node.token.value} ${code(node.right, scope, calls, allowSdfs)})`;
      case "conditional": return `(${code(node.condition, scope, calls, allowSdfs)}?${code(node.yes, scope, calls, allowSdfs)}:${code(node.no, scope, calls, allowSdfs)})`;
      case "call": {
        const builtin = Object.hasOwn(builtins, node.name) ? builtins[node.name] : null;
        if (!builtin && !(allowSdfs && ast.sdfs.has(node.name))) throw dslError(node.token, `未知の関数です: ${node.name}`);
        const min = builtin ? builtin[1] : 3, max = builtin ? builtin[2] ?? min : 3;
        if (node.args.length < min || node.args.length > max) throw dslError(node.token, `${node.name}の引数の数が違います。`);
        if (!builtin) calls.add(node.name);
        return `${builtin ? "b" : "f"}[${JSON.stringify(node.name)}](${node.args.map(v => code(v, scope, calls, allowSdfs)).join(",")})`;
      }
      default: throw dslError(node.token, "不正な式です。");
    }
  }
  const evaluate = node => {
    try {
      const value = new Function("b", `"use strict";return ${code(node, new Map(), new Set(), false)};`)(builtinFunctions);
      const valid = v => typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || typeof v === "string" || Array.isArray(v) && v.every(valid);
      if (!valid(value)) throw new Error("有限の値が必要です。");
      return value;
    } catch (error) {
      if (error.line) throw error;
      throw dslError(node.token, error.message);
    }
  };
  for (const item of ast.constants) {
    if (constants.has(item.name) || ast.sdfs.has(item.name) || Object.hasOwn(builtins, item.name)) throw dslError(item.token, "名前が重複しています。");
    constants.set(item.name, evaluate(item.value));
  }
  for (const [name, sdf] of ast.sdfs) {
    if (constants.has(name) || Object.hasOwn(builtins, name)) throw dslError(sdf.token, "予約済みの名前です。");
    const scope = new Map(), calls = new Set();
    const declare = (token, variable) => {
      if (scope.has(token.value)) throw dslError(token, "引数・変数名が重複しています。");
      scope.set(token.value, variable);
    };
    sdf.parameters.forEach((p, i) => declare(p, `p${i}`));
    const lines = [];
    sdf.locals.forEach((local, i) => {
      const value = code(local.value, scope, calls, true);
      declare(local.token, `v${i}`); lines.push(`const v${i}=${value};`);
    });
    const result = code(sdf.result, scope, calls, true);
    functions[name] = new Function("b", "f", `"use strict";return function(p0,p1,p2){${lines.join("")}return ${result};};`)(builtinFunctions, functions);
    dependencies.set(name, calls);
  }
  const depths = new Map(), active = new Set();
  function visit(name) {
    if (active.has(name)) throw dslError(ast.sdfs.get(name).token, "SDFの再帰呼び出しは使えません。");
    if (active.size >= 32) throw dslError(ast.sdfs.get(name).token, "SDFの呼び出しが深すぎます。");
    if (depths.has(name)) return depths.get(name);
    active.add(name);
    let depth = 1;
    for (const child of dependencies.get(name)) depth = Math.max(depth, visit(child) + 1);
    if (depth > 32) throw dslError(ast.sdfs.get(name).token, "SDFの呼び出しが深すぎます。");
    active.delete(name); depths.set(name, depth);
    return depth;
  }
  for (const name of ast.sdfs.keys()) visit(name);
  return { functions, evaluate };
}
