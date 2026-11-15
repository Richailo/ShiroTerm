'use strict';
const fs=require('node:fs');
const path=require('node:path');
const packager=require('@electron/packager');
const root=path.resolve(__dirname,'..');
const platform=process.argv[2]||process.platform;
const arch=process.argv[3]||'x64';
if(!['win32','linux'].includes(platform)||!['x64','arm64'].includes(arch))
  throw Error('Supported packages: win32/linux, x64/arm64');
const allowed=new Set(['dist','electron','assets','node_modules','package.json','LICENSE','THIRD_PARTY_NOTICES.md']);
packager({dir:root,name:'ShiroTerm',executableName:'ShiroTerm',platform,arch,
  out:path.join(root,'release'),overwrite:true,asar:true,prune:true,
  icon:path.join(root,'assets',platform==='win32'?'shiroterm.ico':'shiroterm.png'),
  appCopyright:'Copyright (c) 2026 Richailo',
  win32metadata:{CompanyName:'Richailo',FileDescription:'ShiroTerm SSH and SFTP client',ProductName:'ShiroTerm'},
  ignore:name=>{
    if(!name)return false;
    const relative=name.replace(/^[/\\]+/,'').replaceAll('\\','/');
    return !allowed.has(relative.split('/')[0])||
      (relative.startsWith('electron/')&&!relative.endsWith('.cjs'))||
      /^node_modules\/(\.bin|\.cache)(\/|$)/.test(relative);
  }
}).then(folders=>{
  for(const folder of folders){
    for(const file of ['README.md','THIRD_PARTY_NOTICES.md'])
      fs.copyFileSync(path.join(root,file),path.join(folder,file));
    fs.copyFileSync(path.join(root,'LICENSE'),path.join(folder,'LICENSE-ShiroTerm.txt'));
    if(platform==='linux'){
      fs.copyFileSync(path.join(root,'assets','shiroterm.png'),path.join(folder,'shiroterm.png'));
      fs.copyFileSync(path.join(root,'assets','shiroterm.desktop'),path.join(folder,'shiroterm.desktop'));
    }
    console.log(folder);
  }
}).catch(error=>{console.error(error);process.exitCode=1;});
