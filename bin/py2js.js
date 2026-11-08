#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { convert } from '../index.js';
import pkg from '../package.json' with { type: 'json' };

const args = process.argv.slice(2);
const help = `py2js-converter ${pkg.version}\nUsage: py2js-converter <input.py> [-o output.js]\n       py2js-converter --help | --version`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
if (args.includes('--version') || args.includes('-v')) { console.log(pkg.version); process.exit(0); }
const input = args.find(a => !a.startsWith('-'));
const oi = args.findIndex(a => a === '-o' || a === '--output');
if (!input || (oi >= 0 && !args[oi + 1])) { console.error(help); process.exit(2); }
try {
  const inPath = resolve(input);
  const outPath = resolve(oi >= 0 ? args[oi + 1] : `${dirname(input)}/${basename(input, extname(input))}.js`);
  await writeFile(outPath, convert(await readFile(inPath, 'utf8')));
  console.log(`Wrote ${outPath}`);
} catch (error) { console.error(error.message); process.exit(1); }
