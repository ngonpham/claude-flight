#!/usr/bin/env node
/**
 * Builds Pacific 1942 (Bắn Máy Bay) as ONE self-contained HTML file — the game, three.js and the
 * styles inlined, nothing fetched — that plays when opened straight from disk or sent to someone:
 * `dist/pacific-standalone.html`. Run: `npm run build:pacific-file`.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = join(root, 'dist', '.pacific-standalone');
rmSync(tmp, { recursive: true, force: true });

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  base: './',
  build: {
    target: 'es2022',
    outDir: tmp,
    emptyOutDir: true,
    copyPublicDir: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
    // One bundle: the game's dynamic import of its app is inlined too.
    rolldownOptions: { input: join(root, 'pacific.html'), output: { codeSplitting: false } },
  },
});

const assets = join(tmp, 'assets');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.join(', ')}`);
const code = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readdirSync(assets).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

const icon = `data:image/svg+xml,${encodeURIComponent(readFileSync(join(root, 'public', 'favicon.svg'), 'utf8'))}`;
let html = readFileSync(join(tmp, 'pacific.html'), 'utf8')
  .replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>\s*/g, '')
  .replace(/<link rel="stylesheet"[^>]*>\s*/g, '')
  .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
  .replace(/href="[^"]*favicon\.svg"/, `href="${icon}"`);
// Replacer functions, not strings: minified code is full of `$&`-like sequences.
if (css) html = html.replace('</head>', () => `<style>${css}</style>\n</head>`);
// Inline module at the end of <body>: #app exists when it runs.
html = html.replace('</body>', () => `<script type="module">${code}</script>\n</body>`);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'pacific-standalone.html');
writeFileSync(out, html);
rmSync(tmp, { recursive: true, force: true });
console.log(`dist/pacific-standalone.html: ${(html.length / 1024).toFixed(0)} KB`);
