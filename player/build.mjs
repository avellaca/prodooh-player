/**
 * Build script for Raspberry Pi deployment bundle.
 *
 * Produces a single self-contained JS file (dist/player.js) and an HTML shell
 * (dist/index.html) ready to be loaded by Chromium in kiosk mode on RPi 5.
 *
 * Usage: node build.mjs
 */

import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(__dirname, 'dist');

async function build() {
  // Ensure output directory exists
  mkdirSync(outdir, { recursive: true });

  // Bundle TypeScript source into a single JS file for Chromium
  await esbuild.build({
    entryPoints: [resolve(__dirname, 'src/index.ts')],
    bundle: true,
    outfile: resolve(outdir, 'player.js'),
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: true,
    metafile: true,
    logLevel: 'info',
  });

  // Generate a minimal HTML shell for Chromium kiosk mode
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prodooh Player</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #player-root { width: 100%; height: 100%; position: relative; }
  </style>
</head>
<body>
  <div id="player-root"></div>
  <script type="module" src="./player.js"></script>
</body>
</html>`;

  writeFileSync(resolve(outdir, 'index.html'), html);

  console.log('\\n✓ Build complete: dist/player.js + dist/index.html');
  console.log('  Deploy the dist/ folder to the Raspberry Pi.');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
