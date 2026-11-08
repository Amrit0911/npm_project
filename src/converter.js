import { parse } from './parser.js';
import { transform } from './transformer.js';
import { generate } from './generator.js';

export function convert(source) {
  if (typeof source !== 'string') throw new TypeError('convert(source) expects a string');
  const tree = parse(source);
  const ast = transform(tree.topNode);
  return generate(ast, source);
}
