import { children } from './parser.js';
import { ConversionError } from './errors.js';

const raw = (node, source) => source.slice(node.from, node.to);
const named = node => children(node).filter(child => !child.type.isAnonymous);
const exprNames = new Set(['BinaryExpression', 'UnaryExpression', 'MemberExpression', 'CallExpression', 'Number', 'String', 'Boolean', 'None', 'VariableName', 'ArrayExpression', 'TupleExpression', 'DictionaryExpression', 'FormatString', 'LambdaExpression']);

function expression(node, source) {
  const cs = children(node), ns = named(node), text = raw(node, source);
  switch (node.name) {
    case 'VariableName': case 'Number': case 'String': return text;
    case 'Boolean': return text === 'True' ? 'true' : 'false';
    case 'None': return 'null';
    case 'ArrayExpression': case 'TupleExpression': return `[${ns.filter(c => exprNames.has(c.name)).map(c => expression(c, source)).join(', ')}]`;
    case 'DictionaryExpression': {
      const entries = [];
      const values = ns.filter(c => exprNames.has(c.name));
      for (let i = 0; i + 1 < values.length; i += 2) entries.push(`${expression(values[i], source)}: ${expression(values[i + 1], source)}`);
      return `{ ${entries.join(', ')} }`;
    }
    case 'FormatString': {
      let value = text.replace(/^f(["'])/, '').replace(/["']$/, '');
      for (const replacement of cs.filter(c => c.name === 'FormatReplacement')) {
        const valueNode = named(replacement).find(c => exprNames.has(c.name));
        value = value.replace(raw(replacement, source), `\${${expression(valueNode, source)}}`);
      }
      return `\`${value.replaceAll('`', '\\`')}\``;
    }
    case 'BinaryExpression': {
      const left = cs[0], operator = cs[1], right = cs[2], token = raw(operator, source);
      if (token === 'in' || token === 'not in') {
        const target = expression(right, source), value = expression(left, source);
        const contains = `__pyContains(${target}, ${value})`;
        return token === 'not in' ? `!(${contains})` : contains;
      }
      if (token === '//') return `Math.floor(${expression(left, source)} / ${expression(right, source)})`;
      const mapped = { and: '&&', or: '||', '==': '===', '!=': '!==', '<>': '!==', is: '===', 'is not': '!==' }[token] ?? token;
      // Python chained comparisons must evaluate the middle operand only once. Restrict the
      // translation to side-effect-free syntax and reject call chains rather than miscompile.
      if (left.name === 'BinaryExpression' && ['<', '<=', '>', '>=', '==', '!='].includes(raw(children(left)[1], source))) {
        if (children(left).some(c => c.name === 'CallExpression')) throw new ConversionError('chained comparisons containing calls are not supported', source, node.from);
        const inner = children(left);
        return `(${expression(inner[0], source)} ${raw(inner[1], source)} ${expression(inner[2], source)} && ${expression(inner[2], source)} ${mapped} ${expression(right, source)})`;
      }
      return `${expression(left, source)} ${mapped} ${expression(right, source)}`;
    }
    case 'UnaryExpression': {
      const op = raw(cs[0], source);
      return `${op === 'not' ? '!' : op}${op === 'not' ? '(' : ''}${expression(cs[1], source)}${op === 'not' ? ')' : ''}`;
    }
    case 'MemberExpression': {
      const base = cs[0], index = cs.slice(1).find(c => exprNames.has(c.name));
      if (cs.some(c => c.name === ':')) throw new ConversionError('slicing is not supported yet', source, node.from, 'unsupported');
      if (!index) throw new ConversionError('invalid index expression', source, node.from, 'syntax');
      return `${expression(base, source)}[${expression(index, source)}]`;
    }
    case 'CallExpression': {
      const callee = ns[0], argList = cs.find(c => c.name === 'ArgList');
      const args = argList ? named(argList).filter(c => exprNames.has(c.name)) : [];
      const name = raw(callee, source), rendered = args.map(a => expression(a, source));
      if (name === 'print') return `console.log(${rendered.join(', ')})`;
      if (name === 'len') return `${rendered[0]}.length`;
      if (name === 'str') return `String(${rendered[0]})`;
      if (name === 'int') return `parseInt(${rendered[0]}, 10)`;
      if (name === 'float') return `Number(${rendered[0]})`;
      if (name === 'type') return `typeof ${rendered[0]}`;
      if (name === 'range') throw new ConversionError('range() is only supported as a for-loop iterable', source, node.from);
      return `${expression(callee, source)}(${rendered.join(', ')})`;
    }
    case 'LambdaExpression': {
      const colon = text.indexOf(':');
      if (!text.startsWith('lambda ') || colon < 0) throw new ConversionError('unsupported lambda form', source, node.from);
      const params = text.slice(7, colon).trim();
      const value = ns.at(-1);
      return `(${params}) => ${expression(value, source)}`;
    }
    default: throw new ConversionError(`${node.name} is not supported yet`, source, node.from);
  }
}

function statement(node, source, scope, level = 0) {
  const pad = '  '.repeat(level), cs = children(node), ns = named(node);
  const body = (bodyNode, bodyScope = scope) => children(bodyNode).filter(c => c.name !== ':').map(c => statement(c, source, bodyScope, level + 1)).join('\n');
  switch (node.name) {
    case 'Comment': return pad + `//${raw(node, source).slice(1)}`;
    case 'AssignStatement': case 'UpdateStatement': {
      const target = ns[0], operator = cs.find(c => c.name === 'AssignOp' || c.name === 'UpdateOp'), value = ns.at(-1);
      const lhs = expression(target, source), rhs = expression(value, source), op = operator ? raw(operator, source) : '=';
      if (op === '=') {
        if (target.name !== 'VariableName') throw new ConversionError('only simple variable assignment is supported', source, target.from);
        const declaration = scope.has(lhs) ? lhs : (scope.add(lhs), `let ${lhs}`);
        return `${pad}${declaration} = ${rhs};`;
      }
      return `${pad}${lhs} ${op} ${rhs};`;
    }
    case 'ExpressionStatement': return `${pad}${expression(ns[0], source)};`;
    case 'ReturnStatement': {
      const value = ns.find(c => c.name !== 'ReturnStatement' && c.name !== 'return' && exprNames.has(c.name));
      return `${pad}return${value ? ` ${expression(value, source)}` : ''};`;
    }
    case 'BreakStatement': return `${pad}break;`;
    case 'ContinueStatement': return `${pad}continue;`;
    case 'FunctionDefinition': {
      const name = ns.find(c => c.name === 'VariableName'), params = cs.find(c => c.name === 'ParamList'), b = cs.find(c => c.name === 'Body');
      const ps = children(params), paramNames = [];
      for (let i = 0; i < ps.length; i++) if (ps[i].name === 'VariableName') {
        const param = raw(ps[i], source); paramNames.push(ps[i + 1]?.name === 'AssignOp' ? `${param}=${expression(ps[i + 2], source)}` : param);
      }
      const localScope = new Set(ps.filter(p => p.name === 'VariableName').map(p => raw(p, source)));
      const functionName = raw(name, source), isAssignment = scope.has(functionName);
      scope.add(functionName);
      return `${pad}${isAssignment ? `${functionName} = ` : 'function '}${isAssignment ? `function ${functionName}` : functionName}(${paramNames.join(', ')}) {\n${body(b, localScope)}\n${pad}}${isAssignment ? ';' : ''}`;
    }
    case 'IfStatement': {
      let out = '', currentCondition = ns.find(c => exprNames.has(c.name)), firstBody = cs.find(c => c.name === 'Body');
      out = `${pad}if (${expression(currentCondition, source)}) {\n${body(firstBody)}\n${pad}}`;
      let seenElse = false;
      for (let i = cs.indexOf(firstBody) + 1; i < cs.length; i++) {
        const c = cs[i];
        if (c.name === 'elif') { currentCondition = cs.slice(i + 1).find(x => exprNames.has(x.name)); continue; }
        if (c.name === 'else') { seenElse = true; continue; }
        if (c.name === 'Body') {
          if (seenElse) out += ` else {\n${body(c)}\n${pad}}`;
          else { out += ` else if (${expression(currentCondition, source)}) {\n${body(c)}\n${pad}}`; currentCondition = undefined; }
        }
      }
      return out;
    }
    case 'WhileStatement': {
      const condition = ns.find(c => exprNames.has(c.name)), b = cs.find(c => c.name === 'Body');
      return `${pad}while (${expression(condition, source)}) {\n${body(b)}\n${pad}}`;
    }
    case 'ForStatement': {
      const inIndex = cs.findIndex(c => c.name === 'in'), bodyNode = cs.find(c => c.name === 'Body');
      const targetNodes = cs.slice(1, inIndex).filter(c => c.name === 'VariableName'), target = targetNodes.map(c => raw(c, source)).join(', ');
      const iter = cs[inIndex + 1];
      if (iter?.name === 'CallExpression' && raw(named(iter)[0], source) === 'range') {
        const al = children(iter).find(c => c.name === 'ArgList'), args = named(al).filter(c => exprNames.has(c.name)).map(c => expression(c, source));
        if (args.length < 1 || args.length > 3) throw new ConversionError('range() expects one to three arguments', source, iter.from);
        const start = args.length > 1 ? args[0] : '0', end = args.length > 1 ? args[1] : args[0], step = args.length === 3 ? args[2] : '1', variable = targetNodes[0] && raw(targetNodes[0], source);
        if (targetNodes.length !== 1) throw new ConversionError('range() requires one loop variable', source, node.from);
        const declaration = scope.has(variable) ? '' : (scope.add(variable), `${pad}let ${variable};\n`);
        return `${declaration}${pad}for (${variable} of __pyRange(${start}, ${end}, ${step})) {\n${body(bodyNode)}\n${pad}}`;
      }
      const bindings = targetNodes.length > 1 ? `[${target}]` : target;
      const declarations = targetNodes.map(t => raw(t, source)).filter(t => !scope.has(t));
      declarations.forEach(t => scope.add(t));
      const declaration = declarations.length ? `${pad}let ${declarations.join(', ')};\n` : '';
      return `${declaration}${pad}for (${bindings} of __pyIter(${expression(iter, source)})) {\n${body(bodyNode)}\n${pad}}`;
    }
    default: throw new ConversionError(`${node.name} is not supported yet`, source, node.from);
  }
}

export function generate(tree, source) {
  const scope = new Set();
  const output = children(tree.parserNode).map(n => statement(n, source, scope)).join('\n').replace(/\n+$/, '') + '\n';
  let helpers = '';
  if (output.includes('__pyContains(')) helpers += 'function __pyContains(container, value) {\n  if (Array.isArray(container) || typeof container === \'string\') return container.includes(value);\n  return container != null && Object.hasOwn(container, value);\n}\n';
  if (output.includes('__pyRange(')) helpers += 'function __pyRange(start, stop, step = 1) {\n  if (step === 0) throw new RangeError("range() arg 3 must not be zero");\n  const values = [];\n  for (let value = start; step > 0 ? value < stop : value > stop; value += step) values.push(value);\n  return values;\n}\n';
  if (output.includes('__pyIter(')) helpers += 'function __pyIter(value) {\n  if (value == null) throw new TypeError("value is not iterable");\n  if (Array.isArray(value) || typeof value === \'string\') return value;\n  if (typeof value === \'object\') return Object.keys(value);\n  throw new TypeError("value is not iterable");\n}\n';
  return helpers + output;
}
