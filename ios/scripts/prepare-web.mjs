import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ios = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(ios, '..');
const output = path.join(ios, 'www');
const entries = ['index.html', 'src', 'assets', 'vendor', 'manifest.webmanifest', 'sw.js', 'LICENSE'];
for (const name of entries) await stat(path.join(root, 'dist', name));
// Fixed generated destination within ios/, never supplied by users.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of entries) await cp(path.join(root, 'dist', name), path.join(output, name), { recursive: true });
await cp(path.join(ios, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(output, 'src/ios-capacitor.js'));
await cp(path.join(ios, 'scripts/native-share.js'), path.join(output, 'src/ios-share.js'));
await cp(path.join(ios, 'scripts/native-audio.js'), path.join(output, 'src/ios-audio.js'));
await cp(path.join(ios, 'licenses'), path.join(output, 'licenses'), { recursive: true });
const html = await readFile(path.join(output, 'index.html'), 'utf8');
await writeFile(path.join(output, 'index.html'), html.replace('</head>', '<script src="src/ios-capacitor.js"></script><script src="src/ios-share.js"></script><script src="src/ios-audio.js"></script></head>'));
// Preserve original license notices, and avoid bundling the 43 MB portable HTML.
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('iOS requires a numeric release version.');
const project = path.join(ios, 'native/App/App.xcodeproj/project.pbxproj');
// Apple's documented bundle build format is Major.Minor.Patch.
const build = version;
const projectText = await readFile(project, 'utf8');
await writeFile(project, projectText.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`).replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`));
await writeFile(path.join(output, 'ios-build.json'), JSON.stringify({ version, applicationId: 'io.github.daronthedragon.waveplayer' }) + '\n');
const icon = path.join(ios, 'native/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
await cp(path.join(root, 'assets/icon-512.png'), icon);
if (process.platform === 'darwin') {
  // Produce Apple's required icon size from WAVE's existing app artwork.
  execFileSync('/usr/bin/sips', ['-z', '1024', '1024', icon], { stdio: 'ignore' });
}
console.log(`Prepared WAVE ${version} iOS assets, excluding portable downloads.`);
