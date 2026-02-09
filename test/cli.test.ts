/**
 * Unit tests for @lass-lang/cli
 *
 * Tests the CLI for compiling .lass files to CSS.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { compileFile, compileString } from '../src/index.js';

// Path to the compiled CLI binary
const CLI_PATH = join(import.meta.dirname, '../dist/bin/lass.js');

/**
 * Run the CLI as a subprocess and capture output.
 */
async function runCli(
  args: string[],
  options: { stdin?: string; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data.toString()));
    proc.stderr.on('data', (data) => (stderr += data.toString()));

    if (options.stdin !== undefined) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

describe('@lass-lang/cli', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lass-cli-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('--help', () => {
    it('should display help information', async () => {
      const { stdout, code } = await runCli(['--help']);

      expect(code).toBe(0);
      expect(stdout).toContain('lass - Compile .lass files to CSS');
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('--stdin');
    });

    it('should accept -h shorthand', async () => {
      const { stdout, code } = await runCli(['-h']);

      expect(code).toBe(0);
      expect(stdout).toContain('lass - Compile .lass files to CSS');
    });
  });

  describe('--version', () => {
    it('should display version number', async () => {
      const { stdout, code } = await runCli(['--version']);

      expect(code).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should accept -v shorthand', async () => {
      const { stdout, code } = await runCli(['-v']);

      expect(code).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('--stdin', () => {
    it('should compile CSS from stdin', async () => {
      const { stdout, code } = await runCli(['--stdin'], {
        stdin: '.box { color: blue; }',
      });

      expect(code).toBe(0);
      expect(stdout).toBe('.box { color: blue; }');
    });

    it('should evaluate preamble expressions from stdin', async () => {
      const { stdout, code } = await runCli(['--stdin'], {
        stdin: `const color = "red"
---
.box { color: {{ color }}; }`,
      });

      expect(code).toBe(0);
      expect(stdout).toBe('.box { color: red; }');
    });
  });

  describe('single file compilation', () => {
    it('should compile CSS-only .lass file to stdout', async () => {
      const inputFile = join(testDir, 'style.lass');
      await writeFile(inputFile, '.box { color: blue; }');

      const { stdout, code } = await runCli([inputFile]);

      expect(code).toBe(0);
      expect(stdout).toBe('.box { color: blue; }');
    });

    it('should compile .lass file with preamble expressions', async () => {
      const inputFile = join(testDir, 'style.lass');
      await writeFile(
        inputFile,
        `const size = "16px"
---
.text { font-size: {{ size }}; }`
      );

      const { stdout, code } = await runCli([inputFile]);

      expect(code).toBe(0);
      expect(stdout).toBe('.text { font-size: 16px; }');
    });

    it('should compile .lass file to output file', async () => {
      const inputFile = join(testDir, 'style.lass');
      const outputFile = join(testDir, 'style.css');
      await writeFile(inputFile, '.box { color: blue; }');

      const { code } = await runCli([inputFile, outputFile]);

      expect(code).toBe(0);

      const css = await readFile(outputFile, 'utf-8');
      expect(css).toBe('.box { color: blue; }');
    });

    it('should create output directory if it does not exist', async () => {
      const inputFile = join(testDir, 'style.lass');
      const outputFile = join(testDir, 'nested', 'dir', 'style.css');
      await writeFile(inputFile, '.box { color: blue; }');

      const { code } = await runCli([inputFile, outputFile]);

      expect(code).toBe(0);

      const css = await readFile(outputFile, 'utf-8');
      expect(css).toBe('.box { color: blue; }');
    });
  });

  describe('file with imports', () => {
    it('should resolve JSON imports in preamble', async () => {
      const tokensFile = join(testDir, 'tokens.json');
      const inputFile = join(testDir, 'style.lass');

      await writeFile(
        tokensFile,
        JSON.stringify({ colors: { primary: '#3b82f6' } })
      );
      await writeFile(
        inputFile,
        `import tokens from './tokens.json' with { type: 'json' }
---
.btn { color: {{ tokens.colors.primary }}; }`
      );

      const { stdout, code } = await runCli([inputFile]);

      expect(code).toBe(0);
      expect(stdout).toBe('.btn { color: #3b82f6; }');
    });

    it('should resolve JS imports in preamble', async () => {
      const utilsFile = join(testDir, 'utils.js');
      const inputFile = join(testDir, 'style.lass');

      await writeFile(
        utilsFile,
        `export const spacing = (n) => \`\${n * 4}px\`;`
      );
      await writeFile(
        inputFile,
        `import { spacing } from './utils.js'
---
.box { padding: {{ spacing(4) }}; }`
      );

      const { stdout, code } = await runCli([inputFile]);

      expect(code).toBe(0);
      expect(stdout).toBe('.box { padding: 16px; }');
    });
  });

  describe('directory compilation', () => {
    it('should compile all .lass files in directory', async () => {
      const srcDir = join(testDir, 'src');
      const outDir = join(testDir, 'dist');
      await mkdir(srcDir);

      await writeFile(join(srcDir, 'a.lass'), '.a { color: red; }');
      await writeFile(join(srcDir, 'b.lass'), '.b { color: blue; }');

      const { code, stdout } = await runCli([srcDir, '--out', outDir]);

      expect(code).toBe(0);
      expect(stdout).toContain('Compiled 2 file(s)');

      const cssA = await readFile(join(outDir, 'a.css'), 'utf-8');
      const cssB = await readFile(join(outDir, 'b.css'), 'utf-8');

      expect(cssA).toBe('.a { color: red; }');
      expect(cssB).toBe('.b { color: blue; }');
    });

    it('should compile nested directory structure', async () => {
      const srcDir = join(testDir, 'src');
      const outDir = join(testDir, 'dist');
      await mkdir(join(srcDir, 'components'), { recursive: true });

      await writeFile(join(srcDir, 'main.lass'), '.main { color: red; }');
      await writeFile(
        join(srcDir, 'components', 'button.lass'),
        '.btn { color: blue; }'
      );

      const { code } = await runCli([srcDir, '--out', outDir]);

      expect(code).toBe(0);

      const mainCss = await readFile(join(outDir, 'main.css'), 'utf-8');
      const btnCss = await readFile(
        join(outDir, 'components', 'button.css'),
        'utf-8'
      );

      expect(mainCss).toBe('.main { color: red; }');
      expect(btnCss).toBe('.btn { color: blue; }');
    });

    it('should error if --out not provided for directory input', async () => {
      const srcDir = join(testDir, 'src');
      await mkdir(srcDir);
      await writeFile(join(srcDir, 'a.lass'), '.a { color: red; }');

      const { stderr, code } = await runCli([srcDir]);

      expect(code).toBe(1);
      expect(stderr).toContain('--out required for directory input');
    });
  });

  describe('error handling', () => {
    it('should error for non-existent file', async () => {
      const { stderr, code } = await runCli(['nonexistent.lass']);

      expect(code).toBe(1);
      expect(stderr).toContain('File not found');
    });

    it('should error with no input specified', async () => {
      const { stderr, code } = await runCli([]);

      expect(code).toBe(1);
      expect(stderr).toContain('No input file specified');
    });
  });

  describe('programmatic API', () => {
    it('compileFile should return CSS string', async () => {
      const inputFile = join(testDir, 'style.lass');
      await writeFile(inputFile, '.box { color: blue; }');

      const css = await compileFile(inputFile);

      expect(css).toBe('.box { color: blue; }');
    });

    it('compileString should return CSS string', async () => {
      const css = await compileString('.box { color: blue; }');

      expect(css).toBe('.box { color: blue; }');
    });

    it('compileString should evaluate preamble expressions', async () => {
      const css = await compileString(`const x = 42
---
.box { width: {{ x }}px; }`);

      expect(css).toBe('.box { width: 42px; }');
    });
  });
});
