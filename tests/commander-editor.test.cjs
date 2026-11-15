'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openFile,closeAll}=require('../electron/commander-editor.cjs');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-sftp-edit-test-'));
  fs.writeFileSync(path.join(dir,'local.txt'),'hello local');
  let contents=Buffer.from('remote original'),modified=1000;
  let pathOpened='',uploadCount=0,errorCount=0,confirmCount=0;
  const sftp={
    lstat(name,cb){cb(null,{size:contents.length,mtime:modified,
      isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false});},
    fastGet(remote,local,options,cb){fs.writeFileSync(local,contents);cb(null);},
    fastPut(local,remote,options,cb){
      contents=fs.readFileSync(local);modified++;uploadCount++;cb(null);
    }
  };
  const opts={connections:{getSftp:async()=>sftp},sessionId:'test',
    side:'remote',localFolder:dir,remoteDir:'/root',name:'remote.txt',
    shell:{openPath:async path=>{pathOpened=path;return '';}},
    dialog:{showMessageBox:async(_win,props)=>{
      if(props.type==='error'){errorCount++;return {response:0};}
      confirmCount++;return {response:0};}},
    win:{}};
  return {dir,opts,get opened(){return pathOpened},get content(){return contents.toString()},
    get uploads(){return uploadCount},get errors(){return errorCount},
    get prompts(){return confirmCount},
    changeRemote(v){contents=Buffer.from(v);modified++;},
    clean(){closeAll();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('double-click local file opens default OS application',async()=>{
  const f=fixture();
  try{
    const opened=await openFile({...f.opts,side:'local',name:'local.txt'});
    assert.equal(opened.ok,true);
    assert.equal(opened.side,'local');
    assert.equal(f.opened,path.join(f.dir,'local.txt'));
  }finally{f.clean();}
});
test('remote editing uses temp download and uploads after user confirms save',async()=>{
  const f=fixture();
  try{
    const result=await openFile(f.opts);
    assert.equal(result.temporary,true);
    assert.equal(fs.readFileSync(f.opened,'utf8'),'remote original');
    fs.writeFileSync(f.opened,'newly edited content');
    await new Promise(resolve=>setTimeout(resolve,2600));
    assert.equal(f.prompts,1);
    assert.equal(f.uploads,1);
    assert.equal(f.content,'newly edited content');
  }finally{f.clean();}
});
test('editing conflict prevents overwriting newer remote contents',async()=>{
  const f=fixture();
  try{
    await openFile({...f.opts,sessionId:'other'});
    f.changeRemote('changed on remote');
    fs.writeFileSync(f.opened,'different local edits');
    await new Promise(resolve=>setTimeout(resolve,2600));
    assert.equal(f.prompts,1);
    assert.equal(f.uploads,0);
    assert.equal(f.errors,1);
    assert.equal(f.content,'changed on remote');
  }finally{f.clean();}
});

test('remote editor reacquires SFTP after its original channel closes',async()=>{
  const f=fixture();
  try{
    await openFile({...f.opts,sessionId:'recovered'});
    const original=f.opts.connections.getSftp;
    let reopened=0;
    f.opts.connections.getSftp=async()=>{
      reopened++;
      return original();
    };
    fs.writeFileSync(f.opened,'edited after remote channel was replaced');
    await new Promise(resolve=>setTimeout(resolve,2600));
    assert.equal(reopened,1,'editor must fetch live SFTP before committing');
    assert.equal(f.uploads,1);
    assert.equal(f.content,'edited after remote channel was replaced');
  }finally{f.clean();}
});
