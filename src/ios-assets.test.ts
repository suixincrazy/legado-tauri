// @vitest-environment node
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';

it('replaces generated iPad and marketing icons before Xcode compiles the asset catalog',()=>{
  const root=mkdtempSync(join(tmpdir(),'legado-ios-assets-'));
  try {
    const catalog=join(root,'Assets.xcassets','AppIcon.appiconset');mkdirSync(catalog,{recursive:true});
    const names=['AppIcon-76x76@2x.png','AppIcon-83.5x83.5@2x.png','AppIcon-512@2x.png'];
    writeFileSync(join(catalog,'Contents.json'),JSON.stringify({images:names.map(filename=>({filename}))}));
    names.forEach(name=>writeFileSync(join(catalog,name),'Tauri default icon'));
    writeFileSync(join(root,'LaunchScreen.storyboard'),'generated');
    execFileSync(process.execPath,['scripts/prepare-ios.mjs',root]);
    for(const name of names)expect(readFileSync(join(catalog,name))).toEqual(readFileSync(join('src-tauri/icons/ios',name)));
    expect(readFileSync(join(root,'LaunchScreen.storyboard'),'utf8')).toContain('LegadoWelcomeBook');
  } finally {rmSync(root,{recursive:true,force:true});}
});
