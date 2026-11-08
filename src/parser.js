import { parser } from '@lezer/python';
import { ConversionError } from './errors.js';

export function parse(source) {
  const tree = parser.parse(source);
  let error;
  tree.iterate({ enter(node) { if (node.type.isError && !error) error = node.from; } });
  if (error !== undefined) throw new ConversionError('could not parse this construct', source, error, 'syntax');
  return tree;
}

export function children(node) {
  const result = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}
