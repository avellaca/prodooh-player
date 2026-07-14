/**
 * Build script for Raspberry Pi deployment bundle.
 *
 * Produces a single self-contained JS file (dist/player.js) and an HTML shell
 * (dist/index.html) ready to be loaded by Chromium in kiosk mode on RPi 5.
 *
 * Usage: node build.mjs
 */

import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(__dirname, 'dist');

async function build() {
  // Ensure output directory exists
  mkdirSync(outdir, { recursive: true });

  // Bundle TypeScript source into a single JS file for Chromium
  //
  // Note: The player uses better-sqlite3 for local storage on the Raspberry Pi
  // (Node.js runtime). When building for the browser (local dev/testing),
  // we replace it with a localStorage-backed shim via an esbuild plugin.
  const sqliteShimPlugin = {
    name: 'sqlite-browser-shim',
    setup(build) {
      // Redirect better-sqlite3 imports to our browser shim
      build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
        path: resolve(__dirname, 'src/shims/better-sqlite3-browser.ts'),
      }));
      // Redirect Node.js crypto to Web Crypto (already available in browser)
      build.onResolve({ filter: /^crypto$/ }, () => ({
        path: resolve(__dirname, 'src/shims/crypto-browser.ts'),
      }));
    },
  };

  await esbuild.build({
    entryPoints: [resolve(__dirname, 'src/main.ts')],
    bundle: true,
    outfile: resolve(outdir, 'player.js'),
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    sourcemap: true,
    metafile: true,
    logLevel: 'info',
    plugins: [sqliteShimPlugin],
  });

  // Generate a minimal HTML shell for Chromium kiosk mode
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:,">
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

  // Copy factory content assets to dist bundle
  const factorySource = resolve(__dirname, 'public/factory');
  const factoryDest = resolve(outdir, 'factory');
  if (existsSync(factorySource)) {
    mkdirSync(factoryDest, { recursive: true });
    cpSync(factorySource, factoryDest, { recursive: true });
    console.log('✓ Factory content copied to dist/factory/');
  }

  // Copy setup.html to dist
  const setupSource = resolve(__dirname, 'public/setup.html');
  if (existsSync(setupSource)) {
    cpSync(setupSource, resolve(outdir, 'setup.html'));
    console.log('✓ setup.html copied to dist/');
  }

  // Copy favicon.ico to dist
  const faviconSource = resolve(__dirname, 'public/favicon.ico');
  if (existsSync(faviconSource)) {
    cpSync(faviconSource, resolve(outdir, 'favicon.ico'));
  }

  console.log('\\n✓ Build complete: dist/player.js + dist/index.html');
  console.log('  Deploy the dist/ folder to the Raspberry Pi.');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
