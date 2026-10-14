import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const required = ['index.html', 'src', 'assets', 'manifest.webmanifest', 'sw.js'];
for (const entry of required) await stat(path.join(root, entry));
// This destination is fixed inside the repository, never supplied by input.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of required) await cp(path.join(root, entry), path.join(output, entry), { recursive: true });
await writeFile(path.join(output, '.nojekyll'), '');

// The downloadable edition embeds its modules and original artwork in one
// HTML file, so opening it from disk needs neither a server nor an installer.
let html = await readFile(path.join(root, 'index.html'), 'utf8');
let css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
let main = await readFile(path.join(root, 'src/main.js'), 'utf8');
// Each direct named import gets its own lexical scope so module-local helpers
// cannot collide. Keep this small bundler explicit about unsupported imports.
const imports = [...main.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w.-]+\.js)['"];?\s*/gm)];
for (const match of imports.reverse()) {
  const [, names, filename] = match;
  const source = await readFile(path.join(root, 'src', filename), 'utf8');
  if (/^\s*import\s/m.test(source)) throw new Error(`Standalone build does not support nested imports in ${filename}`);
  const exportedNames = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm)].map(declaration => declaration[1]);
  const destructuring = names.trim().replace(/\s+as\s+/g, ': ');
  const bundledModule = `const { ${destructuring} } = (() => {\n${source.replace(/^export\s+/gm, '')}\nreturn { ${exportedNames.join(', ')} };\n})();\n`;
  main = main.slice(0, match.index) + bundledModule + main.slice(match.index + match[0].length);
}
if (/^import\s/m.test(main)) throw new Error('Standalone build encountered an unsupported module import');
let script = `(async () => {\n${main}\n})();`;
const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
for (const filename of await readdir(path.join(root, 'assets'))) {
  const mime = mimeTypes[path.extname(filename)];
  if (!mime) continue;
  const bytes = await readFile(path.join(root, 'assets', filename));
  const data = `data:${mime};base64,${bytes.toString('base64')}`;
  for (const prefix of ['../assets/', './assets/', 'assets/']) {
    html = html.replaceAll(prefix + filename, data);
    css = css.replaceAll(prefix + filename, data);
    script = script.replaceAll(prefix + filename, data);
  }
}
html = html.replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/gi, '');
const stylesheet = /<link\b[^>]*href=["'](?:\.\/)?src\/styles\.css["'][^>]*>/i;
const moduleScript = /<script\b[^>]*src=["'](?:\.\/)?src\/main\.js["'][^>]*>\s*<\/script>/i;
if (!stylesheet.test(html) || !moduleScript.test(html)) throw new Error('Could not locate stylesheet or app module for standalone build');
html = html.replace(stylesheet, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
html = html.replace(moduleScript, () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
await mkdir(path.join(output, 'downloads'), { recursive: true });
await writeFile(path.join(output, 'downloads', 'WAVE-Player.html'), html);
console.log('Built static app in dist/ and standalone app in dist/downloads/WAVE-Player.html');
