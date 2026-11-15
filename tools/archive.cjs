'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {version}=require('../package.json');
const folder='ShiroTerm-'+process.platform+'-'+process.arch;
const release=path.join(root,'release');
const extension=process.platform==='win32'?'zip':'tar.gz';
const filename='ShiroTerm-'+version+'-'+process.platform+'-'+process.arch+'.'+extension;
const output=path.join(release,filename);
if(!fs.existsSync(path.join(release,folder)))throw Error('Build the native package first');
let result;
if(process.platform==='win32'){
  result=spawnSync('tar.exe',['-a','-cf',output,'-C',release,folder],{stdio:'inherit',shell:false});
}else{
  result=spawnSync('tar',['-czf',output,'-C',release,folder],{stdio:'inherit',shell:false});
}
if(result.error||result.status!==0)throw result.error||Error('Archive failed: '+result.status);
console.log(output);
