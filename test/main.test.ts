/**
 * Unit tests for main() function in @lass-lang/cli
 *
 * These tests mock process.argv and other globals to directly test main().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main, HELP, VERSION } from '../src/index.js';

describe('main()', () => {
  let testDir: string;
  let originalArgv: string[];
  let stdoutOutput: string;
  let stderrOutput: string;
  let exitCode: number | undefined;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lass-main-test-'));
    originalArgv = process.argv;
    stdoutOutput = '';
    stderrOutput = '';
    exitCode = undefined;

    // Mock stdout.write
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutOutput += chunk.toString();
      return true;
    });

    // Mock console.log and console.error
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdoutOutput += args.join(' ') + '\n';
    });

    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderrOutput += args.join(' ') + '\n';
    });

    // Mock process.exit
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      exitCode = typeof code === 'number' ? code : 0;
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  describe('--help flag', () => {
    it('should display help and exit 0', async () => {
      process.argv = ['node', 'lass', '--help'];

      await expect(main()).rejects.toThrow('process.exit(0)');

      expect(stdoutOutput).toContain('lass - Compile .lass files to CSS');
      expect(exitCode).toBe(0);
    });

    it('should display help with -h shorthand', async () => {
      process.argv = ['node', 'lass', '-h'];

      await expect(main()).rejects.toThrow('process.exit(0)');

      expect(stdoutOutput).toContain('Usage:');
      expect(exitCode).toBe(0);
    });
  });

  describe('--version flag', () => {
    it('should display version and exit 0', async () => {
      process.argv = ['node', 'lass', '--version'];

      await expect(main()).rejects.toThrow('process.exit(0)');

      expect(stdoutOutput).toContain(VERSION);
      expect(exitCode).toBe(0);
    });

    it('should display version with -v shorthand', async () => {
      process.argv = ['node', 'lass', '-v'];

      await expect(main()).rejects.toThrow('process.exit(0)');

      expect(stdoutOutput.trim()).toMatch(/^\d+\.\d+\.\d+/);
      expect(exitCode).toBe(0);
    });
  });

  describe('no input', () => {
    it('should error with no input and display help', async () => {
      process.argv = ['node', 'lass'];

      await expect(main()).rejects.toThrow('process.exit(1)');

      expect(stderrOutput).toContain('No input file specified');
      expect(stdoutOutput).toContain('Usage:');
      expect(exitCode).toBe(1);
    });
  });

  describe('single file compilation', () => {
    it('should compile file to stdout', async () => {
      const inputFile = join(testDir, 'style.lass');
      await writeFile(inputFile, '.box { color: blue; }');

      process.argv = ['node', 'lass', inputFile];

      await main();

      expect(stdoutOutput).toBe('.box { color: blue; }');
      expect(exitCode).toBeUndefined(); // No exit called
    });

    it('should compile file to output file', async () => {
      const inputFile = join(testDir, 'style.lass');
      const outputFile = join(testDir, 'style.css');
      await writeFile(inputFile, '.box { color: red; }');

      process.argv = ['node', 'lass', inputFile, outputFile];

      await main();

      const css = await readFile(outputFile, 'utf-8');
      expect(css).toBe('.box { color: red; }');
    });

    it('should compile file with --out to directory', async () => {
      const inputFile = join(testDir, 'style.lass');
      const outDir = join(testDir, 'dist');
      await writeFile(inputFile, '.box { color: green; }');

      process.argv = ['node', 'lass', inputFile, '--out', outDir];

      await main();

      const css = await readFile(join(outDir, 'style.css'), 'utf-8');
      expect(css).toBe('.box { color: green; }');
    });

    it('should error for non-existent file', async () => {
      process.argv = ['node', 'lass', join(testDir, 'nonexistent.lass')];

      await expect(main()).rejects.toThrow('process.exit(1)');

      expect(stderrOutput).toContain('File not found');
      expect(exitCode).toBe(1);
    });

    it('should error for compilation failure', async () => {
      const inputFile = join(testDir, 'bad.lass');
      // Write something that will cause a runtime error during execution
      await writeFile(inputFile, '{{ throw new Error("test error") }}');

      process.argv = ['node', 'lass', inputFile];

      await expect(main()).rejects.toThrow('process.exit(1)');

      expect(stderrOutput).toContain('Error:');
      expect(exitCode).toBe(1);
    });
  });

  describe('--stdin flag', () => {
    it('should compile CSS from stdin', async () => {
      // Mock stdin as a readable stream
      const { Readable } = await import('node:stream');
      const mockStdin = new Readable({
        read() {
          this.push('.box { color: blue; }');
          this.push(null);
        },
      });

      const originalStdin = process.stdin;
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      process.argv = ['node', 'lass', '--stdin'];

      await main();

      expect(stdoutOutput).toBe('.box { color: blue; }');

      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
    });

    it('should compile CSS with preamble from stdin', async () => {
      const { Readable } = await import('node:stream');
      const input = `const color = "red"
---
.box { color: {{ color }}; }`;

      const mockStdin = new Readable({
        read() {
          this.push(input);
          this.push(null);
        },
      });

      const originalStdin = process.stdin;
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      process.argv = ['node', 'lass', '--stdin'];

      await main();

      expect(stdoutOutput).toBe('.box { color: red; }');

      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
    });

    it('should handle stdin compilation error', async () => {
      const { Readable } = await import('node:stream');
      const mockStdin = new Readable({
        read() {
          this.push('{{ throw new Error("stdin error") }}');
          this.push(null);
        },
      });

      const originalStdin = process.stdin;
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });

      process.argv = ['node', 'lass', '--stdin'];

      await expect(main()).rejects.toThrow('process.exit(1)');

      expect(stderrOutput).toContain('Error:');
      expect(exitCode).toBe(1);

      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('directory compilation', () => {
    it('should compile directory with --out', async () => {
      const srcDir = join(testDir, 'src');
      const outDir = join(testDir, 'dist');
      await mkdir(srcDir);

      await writeFile(join(srcDir, 'a.lass'), '.a { color: red; }');
      await writeFile(join(srcDir, 'b.lass'), '.b { color: blue; }');

      process.argv = ['node', 'lass', srcDir, '--out', outDir];

      await main();

      const cssA = await readFile(join(outDir, 'a.css'), 'utf-8');
      const cssB = await readFile(join(outDir, 'b.css'), 'utf-8');

      expect(cssA).toBe('.a { color: red; }');
      expect(cssB).toBe('.b { color: blue; }');
    });

    it('should compile directory with -o shorthand', async () => {
      const srcDir = join(testDir, 'src');
      const outDir = join(testDir, 'dist');
      await mkdir(srcDir);

      await writeFile(join(srcDir, 'style.lass'), '.style { color: red; }');

      process.argv = ['node', 'lass', srcDir, '-o', outDir];

      await main();

      const css = await readFile(join(outDir, 'style.css'), 'utf-8');
      expect(css).toBe('.style { color: red; }');
    });

    it('should error if --out not provided for directory', async () => {
      const srcDir = join(testDir, 'src');
      await mkdir(srcDir);
      await writeFile(join(srcDir, 'style.lass'), '.style {}');

      process.argv = ['node', 'lass', srcDir];

      await expect(main()).rejects.toThrow('process.exit(1)');

      expect(stderrOutput).toContain('--out required for directory input');
      expect(exitCode).toBe(1);
    });
  });
});
