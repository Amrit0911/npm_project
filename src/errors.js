export class ConversionError extends SyntaxError {
  constructor(message, source, from = 0, kind = 'unsupported') {
    const before = source.slice(0, from);
    const line = before.split('\n').length;
    const column = from - before.lastIndexOf('\n');
    super(`${kind === 'syntax' ? 'Invalid Python syntax' : 'Unsupported Python syntax'} at line ${line}, column ${column}: ${message}`);
    this.name = 'ConversionError';
    this.line = line;
    this.column = column;
    this.kind = kind;
  }
}
