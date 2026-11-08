// Preserve the grammar node for exact source slices while exposing a normalized
// tree shape for later transformation passes.
import { children } from './parser.js';

export function transform(node) {
  return {
    type: node.name === 'Script' ? 'Program' : node.name,
    from: node.from,
    to: node.to,
    parserNode: node,
    children: children(node)
      .filter(n => !['(', ')', '[', ']', '{', '}', ',', ':'].includes(n.name))
      .map(n => transform(n)),
  };
}
