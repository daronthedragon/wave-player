import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const required = ['index.html', 'src', 'assets', 'vendor', 'manifest.webmanifest', 'sw.js', 'LICENSE'];
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
// Named local imports, including nested renderer helpers, get private lexical
// scopes. Reject cycles or unsupported import forms rather than silently emit
// a broken offline artifact. Current modules form an acyclic dependency tree.
async function bundleImports(sourceText, ancestors = ['main.js']) {
const imports = [...sourceText.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w.-]+\.js)(?:\?[^'"\r\n]*)?['"];?\s*/gm)];
for (const match of imports.reverse()) {
  const [, names, filename] = match;
  if (ancestors.includes(filename)) throw new Error(`Circular standalone module import: ${[...ancestors, filename].join(' -> ')}`);
  let source = await readFile(path.join(root, 'src', filename), 'utf8');
  if (filename === 'transcoder.js') {
    const embedded = {
      workerSource: await readFile(path.join(root, 'src/transcoder-worker.js'), 'utf8'),
      coreSource: await readFile(path.join(root, 'vendor/ffmpeg/ffmpeg-core.js'), 'utf8'),
      wasmBase64: (await readFile(path.join(root, 'vendor/ffmpeg/ffmpeg-core.wasm'))).toString('base64')
    };
    const placeholder = '/*__WAVE_FFMPEG__*/ null';
    if (!source.includes(placeholder)) throw new Error('Missing standalone converter embedding marker');
    source = source.replace(placeholder, () => JSON.stringify(embedded));
  }
  const exportedNames = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm)].map(declaration => declaration[1]);
  source = await bundleImports(source, [...ancestors, filename]);
  const destructuring = names.trim().replace(/\s+as\s+/g, ': ');
  const bundledModule = `const { ${destructuring} } = (() => {\n${source.replace(/^export\s+/gm, '')}\nreturn { ${exportedNames.join(', ')} };\n})();\n`;
  sourceText = sourceText.slice(0, match.index) + bundledModule + sourceText.slice(match.index + match[0].length);
}
if (/^\s*import\s/m.test(sourceText)) throw new Error(`Standalone build encountered an unsupported module import in ${ancestors.at(-1)}`);
return sourceText;
}
main = await bundleImports(main);
let script = `(async () => {\n${main}\n})();`;
const mimeTypes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
async function assetFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await assetFiles(path.join(directory, entry.name), prefix + entry.name + '/'));
    else if (entry.isFile()) files.push(prefix + entry.name);
  }
  return files;
}
for (const filename of await assetFiles(path.join(root, 'assets'))) {
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
const stylesheet = /<link\b[^>]*href=["'](?:\.\/)?src\/styles\.css(?:\?[^'"\r\n]*)?["'][^>]*>/i;
const moduleScript = /<script\b[^>]*src=["'](?:\.\/)?src\/main\.js(?:\?[^'"\r\n]*)?["'][^>]*>\s*<\/script>/i;
if (!stylesheet.test(html) || !moduleScript.test(html)) throw new Error('Could not locate stylesheet or app module for standalone build');
html = html.replace(stylesheet, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
html = html.replace(moduleScript, () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
// Preserve decoder attribution and license text inside the single-file artifact.
const notices = await readFile(path.join(root, 'vendor/ffmpeg/NOTICE.md'), 'utf8');
const gpl = await readFile(path.join(root, 'vendor/ffmpeg/COPYING.GPLv2'), 'utf8');
const wrapperLicense = await readFile(path.join(root, 'vendor/ffmpeg/LICENSE.wrapper'), 'utf8');
const rendererNotice = await readFile(path.join(root, 'vendor/ps3-xmb/NOTICE.md'), 'utf8');
const rendererLicense = await readFile(path.join(root, 'vendor/ps3-xmb/LICENSE'), 'utf8');
const textureNotice = await readFile(path.join(root, 'assets/ps3/NOTICE.md'), 'utf8');
html += `\n<!--\n${[notices, gpl, wrapperLicense, rendererNotice, rendererLicense, textureNotice].join('\n\n').replaceAll('-->', '-- >')}\n-->\n`;
await mkdir(path.join(output, 'downloads'), { recursive: true });
await writeFile(path.join(output, 'downloads', 'WAVE-Player.html'), html);
console.log('Built static app in dist/ and standalone app in dist/downloads/WAVE-Player.html');
