import fs from 'node:fs';
import path from 'node:path';

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const check = process.argv.includes('--check');
const root = process.argv.slice(2).find(value => value !== '--check') || 'src-tauri/gen/apple';
const launch = files(root).filter(file => file.endsWith('LaunchScreen.storyboard'));
if (!launch.length) throw new Error('Generated iOS LaunchScreen.storyboard not found');
if (!check) for (const file of launch) fs.copyFileSync('mobile/ios/LaunchScreen.storyboard', file);
const assets = files(root).filter(file => file.replaceAll('\\', '/').endsWith('AppIcon.appiconset/Contents.json'));
if (!assets.length) throw new Error('Generated iOS app asset catalog not found');
for (const file of assets) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const item of catalog.images) {
    if (!item.filename) throw new Error('iOS app icon entry has no filename');
    const source = path.join('src-tauri/icons/ios', item.filename);
    if (!fs.existsSync(source)) throw new Error(`Missing iOS app icon: ${item.filename}`);
    const destination=path.join(path.dirname(file), item.filename);
    if(check){if(!fs.readFileSync(source).equals(fs.readFileSync(destination)))throw new Error(`Packaged iOS icon differs: ${item.filename}`);}
    else fs.copyFileSync(source, destination);
  }
  if(check)continue;
  const target = path.join(path.dirname(path.dirname(file)), 'LegadoWelcomeBook.imageset');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync('mobile/ios/welcome-book.png', path.join(target, 'welcome-book.png'));
  fs.writeFileSync(path.join(target, 'Contents.json'), JSON.stringify({ images: [{ filename: 'welcome-book.png', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }));
}
console.log(`${check?'Verified':'Prepared'} ${launch.length} launch storyboard and ${assets.length} asset catalog`);
