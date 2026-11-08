import { describe, expect, it } from 'vitest';
import { convert } from '../index.js';
import { ConversionError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import { transform } from '../src/transformer.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('convert', () => {
  it('parses Python into a Lezer tree and transforms it into a program tree', () => {
    const parsed = parse('x = 1');
    const ast = transform(parsed.topNode);
    expect(parsed.topNode.name).toBe('Script');
    expect(ast.type).toBe('Program');
    expect(ast.children[0].type).toBe('AssignStatement');
  });

  it('converts the brief example', () => expect(convert('def greet(name):\n    print("Hello", name)\ngreet("Amrit")')).toBe('function greet(name) {\n  console.log("Hello", name);\n}\ngreet("Amrit");\n'));
  it('converts assignments and operators', () => expect(convert('x = 2 + 3\ny = x * 4')).toBe('let x = 2 + 3;\nlet y = x * 4;\n'));
  it('converts conditional blocks', () => expect(convert('if x > 1:\n    print(x)\nelse:\n    print(0)')).toContain('if (x > 1)'));
  it('converts loops and range', () => expect(convert('for i in range(3):\n    print(i)')).toContain('__pyRange(0, 3, 1)'));
  it('converts arrays and membership', () => expect(convert('items = [1, 2]\nif 1 in items:\n    print(items[0])')).toContain('__pyContains(items, 1)'));
  it('converts function defaults and recursion', () => expect(convert('def f(n=1):\n    if n <= 1:\n        return 1\n    return n * f(n - 1)')).toContain('function f(n=1)'));
  it('converts f strings', () => expect(convert('name = "Ada"\nprint(f"Hi {name}")')).toContain('`Hi ${name}`'));
  it('executes f strings and basic lambda expressions', () => {
    const source = 'name = "Ada"\nprint(f"Hi {name}")\nsquare = lambda x: x * x\nprint(square(4))';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['Hi Ada', '16']);
  });
  it('reports invalid and unsupported syntax with locations', () => {
    expect(() => convert('if :')).toThrow(ConversionError);
    expect(() => convert('class A:\n    pass')).toThrow(/line 1, column 1/);
  });
  it('runs generated JavaScript with Node', async () => {
    const js = convert('def greet(name):\n    print("Hello", name)\ngreet("Amrit")');
    const result = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('Hello Amrit');
  });

  it('updates variables without redeclaring them and executes correctly', () => {
    const result = spawnSync(process.execPath, ['-e', convert('x = 1\nx = x + 1\nprint(x)')], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('2');
  });

  it('converts dictionaries and dictionary indexing', () => {
    const js = convert('record = {"name": "Ada", "age": 37}\nprint(record["name"])');
    const result = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' });
    expect(js).toContain('"name": "Ada"');
    expect(result.stdout.trim()).toBe('Ada');
  });

  it('converts dictionary membership with Python key semantics', () => {
    const js = convert('record = {"name": "Ada"}\nprint("name" in record)\nprint("age" in record)');
    const result = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' });
    expect(result.stdout.trim().split('\n')).toEqual(['true', 'false']);
  });

  it('converts elif and else branches and runs each branch correctly', () => {
    const js = convert('x = 2\nif x == 1:\n    print("one")\nelif x == 2:\n    print("two")\nelse:\n    print("other")');
    expect(js).toContain('else if (x === 2)');
    const result = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' });
    expect(result.stdout.trim()).toBe('two');
  });

  it('converts range start, stop, and positive or negative steps', () => {
    const source = 'for i in range(2, 8, 2):\n    print(i)\nfor j in range(3, 0, -1):\n    print(j)';
    const js = convert(source), result = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['2', '4', '6', '3', '2', '1']);
  });

  it('keeps loop variables available after a loop', () => {
    expect(() => convert('for i in range(3):\n    pass')).toThrow(ConversionError);
    expect(() => convert('for i in range(3):\n    break')).not.toThrow();
    const runnable = convert('for i in range(3):\n    print(i)\nprint(i)');
    expect(spawnSync(process.execPath, ['-e', runnable], { encoding: 'utf8' }).stdout.trim().split('\n')).toEqual(['0', '1', '2', '2']);
    expect(runnable).toContain('let i;');
  });

  it('converts while loops with break and continue', () => {
    const source = 'i = 0\nwhile i < 4:\n    i += 1\n    if i == 2:\n        continue\n    print(i)\n    if i == 3:\n        break';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['1', '3']);
  });

  it('converts tuple unpacking in a for loop', () => {
    const source = 'pairs = [[1, 2], [3, 4]]\nfor a, b in pairs:\n    print(a + b)';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['3', '7']);
  });

  it('iterates dictionary keys and list values', () => {
    const source = 'record = {"a": 1, "b": 2}\nfor key in record:\n    print(key)\nitems = [3, 4]\nfor item in items:\n    print(item)';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['a', 'b', '3', '4']);
  });

  it('executes recursive functions and nested conditions', () => {
    const source = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)\nprint(fib(8))';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('21');
  });

  it('converts Python values and common built-ins', () => {
    const source = 'items = [True, None, 2.5]\nprint(items[0], items[1], len(items), str(4), int("5"), float("2.5"))';
    const result = spawnSync(process.execPath, ['-e', convert(source)], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('true null 3 4 5 2.5');
  });

  it('converts comments to valid JavaScript comments', () => {
    const js = convert('# a Python comment\nprint("ok")');
    expect(spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' }).stdout.trim()).toBe('ok');
  });

  it('supports empty returns, local declarations, and repeated local assignment', () => {
    const js = convert('def f():\n    value = 1\n    value = value + 1\n    return\nf()');
    expect(js).toContain('let value = 1;\n  value = value + 1;\n  return;');
    expect(spawnSync(process.execPath, ['-e', js], { encoding: 'utf8' }).status).toBe(0);
  });

  it('rejects slicing with a located conversion error instead of dropping the slice', () => {
    expect(() => convert('items = [1, 2, 3]\npart = items[1:3]')).toThrow(/line 2, column 8: slicing is not supported/);
  });

  it('distinguishes invalid Python from unsupported syntax', () => {
    let invalid, unsupported;
    try { convert('if :'); } catch (error) { invalid = error; }
    try { convert('class A:\n    pass'); } catch (error) { unsupported = error; }
    expect(invalid).toBeInstanceOf(ConversionError);
    expect(invalid.kind).toBe('syntax');
    expect(unsupported).toBeInstanceOf(ConversionError);
    expect(unsupported.kind).toBe('unsupported');
  });

  it('exposes a synchronous CommonJS API', () => {
    const result = spawnSync(process.execPath, ['-e', "const {convert}=require('./dist/index.cjs'); process.stdout.write(convert('print(4)'))"], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('console.log(4);\n');
  });

  it('supports package-name ES module imports', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {convert} from 'py2js-converter'; process.stdout.write(convert('print(5)'))"], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('console.log(5);\n');
  });

  it('keeps the CLI binary mapping valid in package metadata', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.bin['py2js-converter']).toBe('bin/py2js.js');
    expect((await readFile(new URL('../bin/py2js.js', import.meta.url), 'utf8')).startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('CLI writes the default and custom output paths and reports help/version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'py2js-'));
    try {
      const input = join(dir, 'input.py');
      const custom = join(dir, 'custom.js');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(input, 'print("cli")');
      const cli = join(process.cwd(), 'bin/py2js.js');
      expect(spawnSync(process.execPath, [cli, input], { encoding: 'utf8' }).status).toBe(0);
      expect(await readFile(join(dir, 'input.js'), 'utf8')).toBe('console.log("cli");\n');
      expect(spawnSync(process.execPath, [cli, input, '-o', custom], { encoding: 'utf8' }).status).toBe(0);
      expect(await readFile(custom, 'utf8')).toBe('console.log("cli");\n');
      expect(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).stdout).toContain('Usage:');
      expect(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim()).toBe('1.0.0');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
