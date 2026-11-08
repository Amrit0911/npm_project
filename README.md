# py2js-converter

A small Python-to-JavaScript transpiler for a documented Python subset. It parses source with the Lezer Python grammar, transforms parser nodes, and generates JavaScript. It does not require Python. This is not a full Python implementation.

## Install

```sh
npm install py2js-converter
```

## API

```js
import { convert } from 'py2js-converter';
console.log(convert('print("Hello")'));
```

The CommonJS entry point is also provided (`const { convert } = require(...)`). Conversion is synchronous. `convert(source)` returns JavaScript ending in a newline and throws `ConversionError` for invalid or unsupported constructs. Error objects have `line`, `column`, and `kind` (`syntax` or `unsupported`).

## CLI

```sh
npx py2js-converter input.py
npx py2js-converter input.py --output build/output.js
npx py2js-converter --help
```

By default the output is the input path with a `.js` extension.

## Example

Python:

```python
def greet(name):
    print("Hello", name)

greet("Amrit")
```

JavaScript:

```js
function greet(name) {
  console.log("Hello", name);
}
greet("Amrit");
```

## Supported subset

- Assignments; integers, floats, booleans, `None`, strings, arithmetic, comparisons, `and`/`or`/`not`, comments, `print()`.
- `if`/`elif`/`else`, `while`, `for` over iterables, `range()` with positive step one, `break`, and `continue`.
- Functions, positional parameters, simple defaults, calls, returns, recursion.
- Lists and tuples as arrays, dictionaries as objects, indexing, membership (`in`), list/dictionary iteration, basic `len`, `str`, `int`, `float`, `type`, simple f-string replacements, and basic single-expression lambdas.

## Unsupported or limited

Classes, imports, exceptions, generators, decorators, async, sets, slices, comprehensions, `pass`, `enumerate`, `zip`, keyword-only and variadic parameters, and Python's dynamic scope/type behavior are not supported. Basic `range()` uses an emitted helper and supports positive or negative steps. Python modulo edge cases, dynamic truthiness, and some string/list semantics may differ. The converter reports parser errors and unsupported syntax with source coordinates; review and run generated code before use.

## Development

```sh
npm test
npm run lint
npm pack --dry-run
```

Add grammar-to-output and execution tests when extending the supported subset. Keep parsing, transformation, and generation separate. Contributions should document semantic limitations and include behavior tests.

## Publishing

Set the author placeholder in `package.json`, review the supported subset, then authenticate with npm and run `npm publish --access public`. The package name was not found in the npm registry during project setup; check again immediately before publishing because registry availability can change.

## License

MIT. See [LICENSE](LICENSE).
