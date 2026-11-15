'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {transferBatch,transferExternal}=require('../electron/commander-batch.cjs');
const {manageLocal}=require('../electron/file-commander.cjs');
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-dual-'));
  const local=path.join(root,'local'),downloads=path.join(root,'downloads');
  fs.mkdirSync(local);fs.mkdirSync(downloads);
  fs.mkdirSync(path.join(local,'docs'));fs.mkdirSync(path.join(local,'docs','nested'));
  fs.writeFileSync(path.join(local,'docs','a.txt'),'first file');
  fs.writeFileSync(path.join(local,'docs','nested','b.txt'),'second file');
  fs.writeFileSync(path.join(local,'top.log'),'test log');
  const dirs=new Set(['/target','/source']);
  const files=new Map();
  const attrs=(p)=>{
    if(dirs.has(p))return {size:0,isDirectory:()=>true,isSymbolicLink:()=>false};
    if(files.has(p))return {size:files.get(p).length,isDirectory:()=>false,isSymbolicLink:()=>false};
    return null;
  };
  const sftp={
    lstat(p,fn){const a=attrs(p);if(a)return fn(null,a);const e=Error('missing');e.code=2;fn(e);},
    readdir(p,fn){
      if(!dirs.has(p))return fn(Error('not a directory'));
      const names=new Set();
      for(const entry of [...dirs,...files.keys()]){
        const parent=path.posix.dirname(entry);
        if(parent===p)names.add(path.posix.basename(entry));
      }
      fn(null,[...names].map(name=>({filename:name,
        attrs:attrs(path.posix.join(p,name))})));
    },
    mkdir(p,fn){if(dirs.has(p))return fn(Error('already exists'));dirs.add(p);fn(null);},
    fastPut(localPath,remotePath,options,fn){
      const buffer=fs.readFileSync(localPath);files.set(remotePath,buffer);
      options.step(buffer.length,buffer.length,buffer.length);fn(null);
    },
    fastGet(remotePath,localPath,options,fn){
      const buffer=files.get(remotePath);
      if(!buffer)return fn(Error('missing remote file'));
      fs.writeFileSync(localPath,buffer);
      options.step(buffer.length,buffer.length,buffer.length);fn(null);
    }
  };
  return {root,local,downloads,dirs,files,sftp,
    connections:{getSftp:async()=>sftp},
    clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('upload nested directories, preserve paths, and aggregate batch progress',async()=>{
  const f=fixture();
  try{
    const events=[];
    const reply=await transferBatch({connections:f.connections,sessionId:'test',
      direction:'upload',localFolder:f.local,remoteDir:'/target',names:['docs','top.log'],
      onProgress:e=>events.push(e)});
    assert.equal(reply.ok,true);assert.equal(reply.files,3);
    assert.equal(reply.folders,2);
    assert.equal(f.files.get('/target/docs/nested/b.txt').toString(),'second file');
    assert.equal(f.files.get('/target/docs/a.txt').toString(),'first file');
    assert.equal(f.files.get('/target/top.log').toString(),'test log');
    assert.equal(events.at(-1).percent,100);
    assert.equal(events.at(-1).fileCount,3);
  }finally{f.clean();}
});
test('download remote folders recursively',async()=>{
  const f=fixture();
  try{
    f.dirs.add('/source/photos');f.dirs.add('/source/photos/2026');
    f.files.set('/source/photos/2026/image.jpg',Buffer.from('picture'));
    const reply=await transferBatch({connections:f.connections,sessionId:'test',
      direction:'download',localFolder:f.downloads,remoteDir:'/source',names:['photos']});
    assert.equal(reply.files,1);
    assert.equal(fs.readFileSync(path.join(f.downloads,'photos','2026','image.jpg'),'utf8'),'picture');
  }finally{f.clean();}
});
test('detect conflicting nested file before creating directories or overwriting',async()=>{
  const f=fixture();
  try{
    f.dirs.add('/target/docs');f.files.set('/target/docs/a.txt',Buffer.from('original'));
    await assert.rejects(transferBatch({connections:f.connections,sessionId:'x',
      direction:'upload',localFolder:f.local,remoteDir:'/target',names:['docs']}),
      /confirm overwrite/);
    assert.equal(f.files.get('/target/docs/a.txt').toString(),'original');
    assert.equal(f.dirs.has('/target/docs/nested'),false);
  }finally{f.clean();}
});
test('local symbolic links in recursive uploads are rejected before writes',async()=>{
  const f=fixture();
  try{
    try{fs.symlinkSync(path.join(f.local,'top.log'),path.join(f.local,'docs','link.txt'));}
    catch(e){if(e.code==='EPERM')return;throw e;}
    await assert.rejects(transferBatch({connections:f.connections,sessionId:'x',
      direction:'upload',localFolder:f.local,remoteDir:'/target',names:['docs']}),
      /Symbolic links/);
    assert.equal(f.files.size,0);
  }finally{f.clean();}
});
test('reject path traversal in batch names',async()=>{
  const f=fixture();
  try{
    await assert.rejects(transferBatch({connections:f.connections,sessionId:'x',
      direction:'upload',localFolder:f.local,remoteDir:'/target',names:['../secret']}),
      /Invalid file name/);
  }finally{f.clean();}
});
test('local file commander manages folders and avoids overwriting rename',async()=>{
  const f=fixture();
  try{
    await manageLocal({operation:'mkdir',folder:f.local,name:'newdir'});
    assert.equal(fs.statSync(path.join(f.local,'newdir')).isDirectory(),true);
    await assert.rejects(manageLocal({operation:'rename',folder:f.local,
      name:'top.log',newName:'docs'}),/already exists/);
    await manageLocal({operation:'rename',folder:f.local,
      name:'top.log',newName:'renamed.log'});
    assert.equal(fs.existsSync(path.join(f.local,'renamed.log')),true);
    await manageLocal({operation:'delete',folder:f.local,name:'renamed.log'});
    assert.equal(fs.existsSync(path.join(f.local,'renamed.log')),false);
    await assert.rejects(manageLocal({operation:'delete',folder:f.local,name:'docs'}));
  }finally{f.clean();}
});

test('dragging Windows Explorer files into remote pane uploads from explicit paths',async()=>{
  const f=fixture();
  try{
    const result=await transferExternal({connections:f.connections,sessionId:'test',
      remoteDir:'/target',paths:[path.join(f.local,'top.log'),
        path.join(f.local,'docs')]});
    assert.equal(result.files,3);
    assert.equal(f.files.get('/target/top.log').toString(),'test log');
    assert.equal(f.files.get('/target/docs/nested/b.txt').toString(),'second file');
  }finally{f.clean();}
});
test('reject Explorer drag of different files with the same basename',async()=>{
  const f=fixture();
  try{
    fs.writeFileSync(path.join(f.downloads,'top.log'),'different');
    await assert.rejects(transferExternal({connections:f.connections,sessionId:'test',
      remoteDir:'/target',paths:[path.join(f.local,'top.log'),
        path.join(f.downloads,'top.log')]}),/same file name/);
  }finally{f.clean();}
});
