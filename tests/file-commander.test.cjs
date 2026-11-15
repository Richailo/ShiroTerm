'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {listLocal,transfer,entryName,localPath,remoteFolder}=
  require('../electron/file-commander.cjs');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-commander-test-'));
  fs.writeFileSync(path.join(dir,'hello.txt'),'safe transfer content');
  fs.mkdirSync(path.join(dir,'folder'));
  const remote=new Map();
  const sftp={
    lstat(name,callback){
      const file=remote.get(name);
      if(!file){const error=Error('Not found');error.code=2;return callback(error);}
      callback(null,{size:file.length,isDirectory:()=>false});
    },
    fastPut(from,to,options,callback){
      const contents=fs.readFileSync(from);
      remote.set(to,contents);
      options.step(contents.length,contents.length,contents.length);
      callback(null);
    },
    fastGet(from,to,options,callback){
      const contents=remote.get(from);
      fs.writeFileSync(to,contents);
      options.step(contents.length,contents.length,contents.length);
      callback(null);
    }
  };
  return {dir,remote,connections:{getSftp:async()=>sftp},
    clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('local pane lists regular files and directories',async()=>{
  const f=fixture();
  try{
    const list=await listLocal(f.dir);
    assert.equal(list.folder,path.normalize(f.dir));
    assert.equal(list.entries[0].name,'folder');
    assert.equal(list.entries[0].directory,true);
    assert.equal(list.entries[1].name,'hello.txt');
    assert.ok(list.entries[1].size>0);
  }finally{f.clean();}
});
test('upload and download preserve contents and emit progress',async()=>{
  const f=fixture();
  try{
    const events=[];
    const props={connections:f.connections,sessionId:'valid-session',
      localFolder:f.dir,remoteDir:'/home/shared',name:'hello.txt',
      onProgress:value=>events.push(value)};
    const uploaded=await transfer({...props,direction:'upload'});
    assert.equal(uploaded.ok,true);
    assert.equal(f.remote.get('/home/shared/hello.txt').toString(),'safe transfer content');
    assert.equal(events.at(-1).percent,100);
    fs.unlinkSync(path.join(f.dir,'hello.txt'));
    await transfer({...props,direction:'download'});
    assert.equal(fs.readFileSync(path.join(f.dir,'hello.txt'),'utf8'),
      'safe transfer content');
  }finally{f.clean();}
});
test('existing files require explicit overwrite confirmation',async()=>{
  const f=fixture();
  try{
    const props={connections:f.connections,sessionId:'x',
      localFolder:f.dir,remoteDir:'/x',name:'hello.txt'};
    await transfer({...props,direction:'upload'});
    await assert.rejects(transfer({...props,direction:'upload'}),/confirm overwrite/);
    await assert.rejects(transfer({...props,direction:'download'}),/confirm overwrite/);
    f.remote.set('/x/hello.txt',Buffer.from('remote version'));
    await transfer({...props,direction:'download',overwrite:true});
    assert.equal(fs.readFileSync(path.join(f.dir,'hello.txt'),'utf8'),'remote version');
  }finally{f.clean();}
});
test('filenames and remote folders reject traversal and unsafe input',()=>{
  assert.throws(()=>entryName('..'),/Invalid/);
  assert.throws(()=>entryName('../secret.txt'),/Invalid/);
  assert.throws(()=>entryName('evil\\nested'),/Invalid/);
  assert.throws(()=>remoteFolder('/home/../secret'),/traversal/);
  assert.throws(()=>remoteFolder('relative'),/Invalid/);
  assert.throws(()=>localPath('../relative'),/Absolute/);
});
test('directory source cannot be transferred like a file',async()=>{
  const f=fixture();
  try{
    await assert.rejects(transfer({connections:f.connections,sessionId:'x',
      localFolder:f.dir,remoteDir:'/x',name:'folder',direction:'upload'}),
      /regular local file/);
  }finally{f.clean();}
});

test('failed download preserves existing local file and cleans partial file',async()=>{
  const f=fixture();
  try{
    f.remote.set('/x/hello.txt',Buffer.from('new remote contents'));
    const failing={getSftp:async()=>({
      lstat(_path,callback){callback(null,{size:19,isDirectory:()=>false});},
      fastGet(_remote,staging,_opts,callback){
        fs.writeFileSync(staging,'half a file');
        callback(Error('Transfer interrupted'));
      }
    })};
    await assert.rejects(transfer({connections:failing,sessionId:'x',
      localFolder:f.dir,remoteDir:'/x',name:'hello.txt',
      direction:'download',overwrite:true}),/Transfer interrupted/);
    assert.equal(fs.readFileSync(path.join(f.dir,'hello.txt'),'utf8'),
      'safe transfer content');
    const leftovers=fs.readdirSync(f.dir).filter(x=>x.includes('.partial'));
    assert.equal(leftovers.length,0);
  }finally{f.clean();}
});
