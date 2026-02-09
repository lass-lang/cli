# @lass-lang/cli

Command-line interface for compiling `.lass` files to CSS.

## Installation

```bash
pnpm add -g @lass-lang/cli
```

Or use directly with `npx`:

```bash
npx @lass-lang/cli styles.lass
```

## Usage

```bash
# Compile a file and output to stdout
lass styles.lass

# Compile a file to a specific output file
lass styles.lass dist/styles.css

# Compile all .lass files in a directory
lass src/styles/ --out dist/css/

# Read from stdin
echo ".box { color: blue; }" | lass --stdin

# Show help
lass --help

# Show version
lass --version
```

## Options

| Option | Description |
|--------|-------------|
| `-o, --out <dir>` | Output directory (required for directory input) |
| `--stdin` | Read input from stdin |
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |

## Examples

### Single file compilation

```bash
# Output to stdout
lass button.lass

# Output to file
lass button.lass dist/button.css
```

### Directory compilation

```bash
# Compile all .lass files in src/ to dist/
lass src/ --out dist/

# Preserves directory structure:
# src/components/button.lass -> dist/components/button.css
# src/pages/home.lass        -> dist/pages/home.css
```

### Stdin/stdout pipeline

```bash
# Pipe content directly
echo ".card { padding: 16px; }" | lass --stdin

# Use with other tools
cat styles.lass | lass --stdin > styles.css
```

## Programmatic API

The CLI also exports functions for programmatic use:

```typescript
import { compileFile, compileString, compileDirectory } from '@lass-lang/cli';

// Compile a file
const css = await compileFile('styles.lass');

// Compile a string
const css = await compileString('.box { color: blue; }');

// Compile a directory
await compileDirectory('src/styles', 'dist/css');
```

### API Reference

#### `compileFile(inputPath: string): Promise<string>`

Compiles a single `.lass` file and returns the CSS string.

#### `compileString(source: string, filename?: string): Promise<string>`

Compiles Lass source code from a string. The optional `filename` parameter is used for error messages (defaults to `'stdin.lass'`).

#### `compileDirectory(inputDir: string, outputDir: string): Promise<void>`

Compiles all `.lass` files in a directory recursively, writing corresponding `.css` files to the output directory while preserving the directory structure.

#### `findLassFiles(dir: string): Promise<string[]>`

Recursively finds all `.lass` files in a directory.

## Requirements

- Node.js >= 20.0.0

## License

MIT
