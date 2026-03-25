/**
 * Unit tests for @lass-lang/cli internal functions
 *
 * These tests directly test internal functions for better coverage,
 * complementing the integration tests in cli.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseArgs,
  findLassFiles,
  compileDirectory,
  compileFile,
  compileString,
  VERSION,
  HELP,
  type ParsedArgs,
} from '../src/index.js';

describe('parseArgs', () => {
  it('should return defaults for empty args', () => {
    const result = parseArgs(['node', 'lass']);

    expect(result).toEqual({
      help: false,
      version: false,
      stdin: false,
      outDir: null,
      inputs: [],
    });
  });

  it('should parse --help flag', () => {
    const result = parseArgs(['node', 'lass', '--help']);

    expect(result.help).toBe(true);
  });

  it('should parse -h flag', () => {
    const result = parseArgs(['node', 'lass', '-h']);

    expect(result.help).toBe(true);
  });

  it('should parse --version flag', () => {
    const result = parseArgs(['node', 'lass', '--version']);

    expect(result.version).toBe(true);
  });

  it('should parse -v flag', () => {
    const result = parseArgs(['node', 'lass', '-v']);

    expect(result.version).toBe(true);
  });

  it('should parse --stdin flag', () => {
    const result = parseArgs(['node', 'lass', '--stdin']);

    expect(result.stdin).toBe(true);
  });

  it('should parse --out with value', () => {
    const result = parseArgs(['node', 'lass', '--out', 'dist']);

    expect(result.outDir).toBe('dist');
  });

  it('should parse -o with value', () => {
    const result = parseArgs(['node', 'lass', '-o', 'dist']);

    expect(result.outDir).toBe('dist');
  });

  it('should handle --out without value', () => {
    const result = parseArgs(['node', 'lass', '--out']);

    expect(result.outDir).toBe(null);
  });

  it('should collect positional inputs', () => {
    const result = parseArgs(['node', 'lass', 'input.lass', 'output.css']);

    expect(result.inputs).toEqual(['input.lass', 'output.css']);
  });

  it('should handle mixed flags and inputs', () => {
    const result = parseArgs([
      'node',
      'lass',
      'input.lass',
      '--out',
      'dist',
      'extra.lass',
    ]);

    expect(result.outDir).toBe('dist');
    expect(result.inputs).toEqual(['input.lass', 'extra.lass']);
  });

  it('should handle all flags together', () => {
    const result = parseArgs([
      'node',
      'lass',
      '-h',
      '-v',
      '--stdin',
      '-o',
      'out',
      'file.lass',
    ]);

    expect(result.help).toBe(true);
    expect(result.version).toBe(true);
    expect(result.stdin).toBe(true);
    expect(result.outDir).toBe('out');
    expect(result.inputs).toEqual(['file.lass']);
  });

  it('should exit on unknown option', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['node', 'lass', '--unknown'])).toThrow(
      'process.exit called'
    );
    expect(mockError).toHaveBeenCalledWith('Unknown option: --unknown');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should exit on unknown short option', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['node', 'lass', '-x'])).toThrow(
      'process.exit called'
    );
    expect(mockError).toHaveBeenCalledWith('Unknown option: -x');

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe('findLassFiles', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lass-unit-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should find .lass files in flat directory', async () => {
    await writeFile(join(testDir, 'a.lass'), '.a {}');
    await writeFile(join(testDir, 'b.lass'), '.b {}');
    await writeFile(join(testDir, 'c.css'), '.c {}'); // Should be ignored

    const files = await findLassFiles(testDir);

    expect(files).toHaveLength(2);
    expect(files).toContain(join(testDir, 'a.lass'));
    expect(files).toContain(join(testDir, 'b.lass'));
  });

  it('should find .lass files in nested directories', async () => {
    await mkdir(join(testDir, 'nested', 'deep'), { recursive: true });
    await writeFile(join(testDir, 'root.lass'), '.root {}');
    await writeFile(join(testDir, 'nested', 'mid.lass'), '.mid {}');
    await writeFile(join(testDir, 'nested', 'deep', 'deep.lass'), '.deep {}');

    const files = await findLassFiles(testDir);

    expect(files).toHaveLength(3);
    expect(files).toContain(join(testDir, 'root.lass'));
    expect(files).toContain(join(testDir, 'nested', 'mid.lass'));
    expect(files).toContain(join(testDir, 'nested', 'deep', 'deep.lass'));
  });

  it('should return empty array for empty directory', async () => {
    const files = await findLassFiles(testDir);

    expect(files).toEqual([]);
  });

  it('should return empty array for directory with no .lass files', async () => {
    await writeFile(join(testDir, 'style.css'), '.style {}');
    await writeFile(join(testDir, 'script.js'), 'console.log()');

    const files = await findLassFiles(testDir);

    expect(files).toEqual([]);
  });

  it('should handle directories with only subdirectories', async () => {
    await mkdir(join(testDir, 'empty1'));
    await mkdir(join(testDir, 'empty2'));
    await mkdir(join(testDir, 'withFile'));
    await writeFile(join(testDir, 'withFile', 'style.lass'), '.style {}');

    const files = await findLassFiles(testDir);

    expect(files).toHaveLength(1);
    expect(files).toContain(join(testDir, 'withFile', 'style.lass'));
  });
});

describe('compileDirectory', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lass-compile-dir-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should compile all .lass files to output directory', async () => {
    const srcDir = join(testDir, 'src');
    const outDir = join(testDir, 'dist');
    await mkdir(srcDir);

    await writeFile(join(srcDir, 'a.lass'), '.a { color: red; }');
    await writeFile(join(srcDir, 'b.lass'), '.b { color: blue; }');

    await compileDirectory(srcDir, outDir);

    const { readFile } = await import('node:fs/promises');
    const cssA = await readFile(join(outDir, 'a.css'), 'utf-8');
    const cssB = await readFile(join(outDir, 'b.css'), 'utf-8');

    expect(cssA).toBe('.a { color: red; }');
    expect(cssB).toBe('.b { color: blue; }');
  });

  it('should preserve nested directory structure', async () => {
    const srcDir = join(testDir, 'src');
    const outDir = join(testDir, 'dist');
    await mkdir(join(srcDir, 'components'), { recursive: true });

    await writeFile(join(srcDir, 'main.lass'), '.main { color: red; }');
    await writeFile(
      join(srcDir, 'components', 'btn.lass'),
      '.btn { color: blue; }'
    );

    await compileDirectory(srcDir, outDir);

    const { readFile } = await import('node:fs/promises');
    const mainCss = await readFile(join(outDir, 'main.css'), 'utf-8');
    const btnCss = await readFile(join(outDir, 'components', 'btn.css'), 'utf-8');

    expect(mainCss).toBe('.main { color: red; }');
    expect(btnCss).toBe('.btn { color: blue; }');
  });

  it('should exit with error for empty directory', async () => {
    const srcDir = join(testDir, 'empty');
    const outDir = join(testDir, 'dist');
    await mkdir(srcDir);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(compileDirectory(srcDir, outDir)).rejects.toThrow(
      'process.exit called'
    );
    expect(mockError).toHaveBeenCalledWith(`No .lass files found in ${srcDir}`);
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('should exit with error for compilation failure', async () => {
    const srcDir = join(testDir, 'src');
    const outDir = join(testDir, 'dist');
    await mkdir(srcDir);

    // Invalid lass syntax that will fail to compile
    await writeFile(join(srcDir, 'bad.lass'), '{{ undefined_var }}');

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(compileDirectory(srcDir, outDir)).rejects.toThrow(
      'process.exit called'
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe('compileFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lass-compile-file-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should compile simple CSS-only file', async () => {
    const inputFile = join(testDir, 'style.lass');
    await writeFile(inputFile, '.box { color: blue; }');

    const css = await compileFile(inputFile);

    expect(css).toBe('.box { color: blue; }');
  });

  it('should compile file with preamble expressions', async () => {
    const inputFile = join(testDir, 'style.lass');
    await writeFile(
      inputFile,
      `---
const color = "red"
---
.box { color: {{ color }}; }`
    );

    const css = await compileFile(inputFile);

    expect(css).toBe('.box { color: red; }');
  });

  it('should compile file with complex preamble', async () => {
    const inputFile = join(testDir, 'style.lass');
    await writeFile(
      inputFile,
      `---
const spacing = (n) => \`\${n * 4}px\`
const colors = { primary: '#3b82f6' }
---
.box {
  padding: {{ spacing(2) }};
  color: {{ colors.primary }};
}`
    );

    const css = await compileFile(inputFile);

    expect(css).toContain('padding: 8px');
    expect(css).toContain('color: #3b82f6');
  });

  it('should throw for non-existent file', async () => {
    await expect(compileFile(join(testDir, 'nonexistent.lass'))).rejects.toThrow();
  });
});

describe('compileString', () => {
  it('should compile simple CSS string', async () => {
    const css = await compileString('.box { color: blue; }');

    expect(css).toBe('.box { color: blue; }');
  });

  it('should compile string with preamble', async () => {
    const css = await compileString(`---
const x = 42
---
.box { width: {{ x }}px; }`);

    expect(css).toBe('.box { width: 42px; }');
  });

  it('should compile string with custom filename', async () => {
    const css = await compileString('.test { color: red; }', 'custom.lass');

    expect(css).toBe('.test { color: red; }');
  });

  it('should handle multiline CSS', async () => {
    const css = await compileString(`.a { color: red; }
.b { color: blue; }
.c { color: green; }`);

    expect(css).toContain('.a { color: red; }');
    expect(css).toContain('.b { color: blue; }');
    expect(css).toContain('.c { color: green; }');
  });

  it('should handle array operations in preamble', async () => {
    const css = await compileString(`---
const colors = ['red', 'blue', 'green']
---
.first { color: {{ colors[0] }}; }
.last { color: {{ colors[colors.length - 1] }}; }`);

    expect(css).toContain('.first { color: red; }');
    expect(css).toContain('.last { color: green; }');
  });
});

describe('VERSION constant', () => {
  it('should be a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should match package.json version', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

    expect(VERSION).toBe(pkg.version);
  });
});

describe('HELP constant', () => {
  it('should contain usage information', () => {
    expect(HELP).toContain('lass - Compile .lass files to CSS');
    expect(HELP).toContain('Usage:');
  });

  it('should document all flags', () => {
    expect(HELP).toContain('--help');
    expect(HELP).toContain('--version');
    expect(HELP).toContain('--stdin');
    expect(HELP).toContain('--out');
    expect(HELP).toContain('-h');
    expect(HELP).toContain('-v');
    expect(HELP).toContain('-o');
  });

  it('should include examples', () => {
    expect(HELP).toContain('Examples:');
  });
});
