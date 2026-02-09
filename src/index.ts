/**
 * @lass-lang/cli
 *
 * Lass CLI - compile .lass files to CSS.
 *
 * Usage:
 *   lass input.lass              # Output to stdout
 *   lass input.lass output.css   # Output to file
 *   lass src/ --out dist/        # Compile directory
 *   lass --stdin                 # Read from stdin
 *   lass --help                  # Show help
 *   lass --version               # Show version
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, extname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createReadStream } from 'node:fs';
import { transpile } from '@lass-lang/core';
import { rewriteImportsForExecution } from '@lass-lang/plugin-utils';

// ============================================================================
// VERSION (read from package.json at runtime would add complexity, hardcode for now)
// ============================================================================

export const VERSION = '0.0.1';

// ============================================================================
// HELP TEXT
// ============================================================================

export const HELP = `
lass - Compile .lass files to CSS

Usage:
  lass <input.lass> [output.css]    Compile a single file
  lass <dir> --out <outdir>         Compile all .lass files in directory
  lass --stdin                      Read from stdin, write to stdout

Options:
  -o, --out <dir>      Output directory (for directory input)
  --stdin              Read input from stdin
  -h, --help           Show this help message
  -v, --version        Show version number

Examples:
  lass styles.lass                      # Output CSS to stdout
  lass styles.lass dist/styles.css      # Output CSS to file
  lass src/styles/ --out dist/css/      # Compile directory
  echo ".box { color: blue; }" | lass --stdin
`;

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  stdin: boolean;
  outDir: string | null;
  inputs: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // Skip node and script path
  const result: ParsedArgs = {
    help: false,
    version: false,
    stdin: false,
    outDir: null,
    inputs: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-v' || arg === '--version') {
      result.version = true;
    } else if (arg === '--stdin') {
      result.stdin = true;
    } else if (arg === '-o' || arg === '--out') {
      i++;
      result.outDir = args[i] ?? null;
    } else if (!arg.startsWith('-')) {
      result.inputs.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return result;
}

// ============================================================================
// CSS EXECUTION (temp file approach like bun-plugin)
// ============================================================================

/**
 * Execute transpiled JS module and extract CSS string.
 *
 * Uses temp file + dynamic import so that imports in the preamble
 * resolve correctly via Node.js module resolution.
 */
async function executeModule(jsCode: string): Promise<string> {
  const tempPath = join(
    tmpdir(),
    `lass-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  );

  try {
    await writeFile(tempPath, jsCode, 'utf-8');
    const fileUrl = pathToFileURL(tempPath).href;

    // Dynamic import - imports in the module resolve from temp file location
    // Since we rewrote imports to absolute paths, this works correctly
    const module = await import(fileUrl);
    return module.default as string;
  } finally {
    // Clean up temp file
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// FILE COMPILATION
// ============================================================================

/**
 * Compile a single .lass file to CSS.
 */
export async function compileFile(inputPath: string): Promise<string> {
  const absolutePath = resolve(inputPath);
  const source = await readFile(absolutePath, 'utf-8');

  // Transpile to JS
  const { code: jsCode } = transpile(source, { filename: absolutePath });

  // Rewrite imports to absolute paths (so they resolve from temp file)
  const executableCode = rewriteImportsForExecution(jsCode, dirname(absolutePath));

  // Execute and get CSS
  const css = await executeModule(executableCode);

  return css;
}

/**
 * Compile .lass content from string (for stdin).
 */
export async function compileString(source: string, filename = 'stdin.lass'): Promise<string> {
  const cwd = process.cwd();

  // Transpile to JS
  const { code: jsCode } = transpile(source, { filename });

  // Rewrite imports to absolute paths (resolve from cwd for stdin)
  const executableCode = rewriteImportsForExecution(jsCode, cwd);

  // Execute and get CSS
  const css = await executeModule(executableCode);

  return css;
}

// ============================================================================
// DIRECTORY COMPILATION
// ============================================================================

/**
 * Recursively find all .lass files in a directory.
 */
export async function findLassFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findLassFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.lass')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Compile all .lass files in a directory to an output directory.
 */
export async function compileDirectory(inputDir: string, outputDir: string): Promise<void> {
  const absoluteInputDir = resolve(inputDir);
  const absoluteOutputDir = resolve(outputDir);

  const files = await findLassFiles(absoluteInputDir);

  if (files.length === 0) {
    console.error(`No .lass files found in ${inputDir}`);
    process.exit(1);
  }

  for (const file of files) {
    const relativePath = relative(absoluteInputDir, file);
    const outputPath = join(
      absoluteOutputDir,
      relativePath.replace(/\.lass$/, '.css')
    );

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    try {
      const css = await compileFile(file);
      await writeFile(outputPath, css, 'utf-8');
      console.log(`Compiled: ${relativePath} -> ${relative(process.cwd(), outputPath)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error compiling ${relativePath}: ${message}`);
      process.exit(1);
    }
  }

  console.log(`\nCompiled ${files.length} file(s)`);
}

// ============================================================================
// STDIN HANDLING
// ============================================================================

/**
 * Read all input from stdin.
 */
export async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Handle --help
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Handle --version
  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // Handle --stdin
  if (args.stdin) {
    try {
      const source = await readStdin();
      const css = await compileString(source);
      process.stdout.write(css);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
    return;
  }

  // Need at least one input
  if (args.inputs.length === 0) {
    console.error('Error: No input file specified\n');
    console.log(HELP);
    process.exit(1);
  }

  const input = args.inputs[0]!;
  const inputPath = resolve(input);

  // Check if input exists
  try {
    const inputStat = await stat(inputPath);

    if (inputStat.isDirectory()) {
      // Directory mode - requires --out
      if (!args.outDir) {
        console.error('Error: --out required for directory input');
        process.exit(1);
      }
      await compileDirectory(inputPath, args.outDir);
    } else {
      // Single file mode
      const css = await compileFile(inputPath);

      if (args.inputs.length > 1) {
        // Output to file (second positional arg)
        const outputPath = resolve(args.inputs[1]!);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, css, 'utf-8');
      } else if (args.outDir) {
        // Output to directory
        const outputPath = join(
          args.outDir,
          basename(inputPath).replace(/\.lass$/, '.css')
        );
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, css, 'utf-8');
      } else {
        // Output to stdout
        process.stdout.write(css);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Error: File not found: ${input}`);
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
