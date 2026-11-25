import fs from 'node:fs';
import path from 'node:path';

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const root = 'src-tauri/gen/apple';
const launch = files(root).filter(file => file.endsWith('LaunchScreen.storyboard'));
if (!launch.length) throw new Error('Generated iOS LaunchScreen.storyboard not found');
for (const file of launch) fs.copyFileSync('mobile/ios/LaunchScreen.storyboard', file);
const assets = files(root).filter(file => file.endsWith('AppIcon.appiconset/Contents.json'));
if (!assets.length) throw new Error('Generated iOS app asset catalog not found');
for (const file of assets) {
  const target = path.join(path.dirname(path.dirname(file)), 'LegadoWelcomeBook.imageset');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync('mobile/ios/welcome-book.png', path.join(target, 'welcome-book.png'));
  fs.writeFileSync(path.join(target, 'Contents.json'), JSON.stringify({ images: [{ filename: 'welcome-book.png', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }));
}
console.log(`Prepared ${launch.length} launch storyboard and ${assets.length} asset catalog`);
