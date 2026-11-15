'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {folderPath,fileName,childPath,action}=require('../electron/sftp-actions.cjs');
function fixture(){
  const files=new Map([['/root/original.txt',{directory:false}],['/root/sub',{directory:true}],
    ['/root/taken.txt',{directory:false}],['/root/shortcut',{directory:false,symlink:true}]]);
  const calls=[];
  const missing=()=>Object.assign(new Error('SSH_FX_NO_SUCH_FILE'),{code:2});
  const sftp={
    mkdir(file,cb){calls.push(['mkdir',file]);if(files.has(file))cb(new Error('exists'));
      else{files.set(file,{directory:true});cb(null);}},
    lstat(file,cb){calls.push(['lstat',file]);const item=files.get(file);
      if(!item)cb(missing());else cb(null,{
        mode:item.directory?0o040755:item.symlink?0o120777:0o100644,
        isDirectory:()=>item.directory
      });},
    rename(from,to,cb){calls.push(['rename',from,to]);
      const item=files.get(from);if(!item){cb(missing());return;}
      if(files.has(to)){cb(new Error('exists'));return;}
      files.delete(from);files.set(to,item);cb(null);},
    unlink(file,cb){calls.push(['unlink',file]);if(!files.has(file))cb(missing());
      else{files.delete(file);cb(null);}},
    rmdir(file,cb){calls.push(['rmdir',file]);if(!files.get(file)?.directory)cb(missing());
      else{files.delete(file);cb(null);}
    }
  };
  return {sftp,calls,files};
}
test('SFTP paths reject traversal, control characters and invalid names',()=>{
  assert.equal(folderPath('/root/sub/'),'/root/sub/');
  assert.equal(childPath('/root','report.txt'),'/root/report.txt');
  for(const bad of ['relative','/root/../etc','/root/./private','/root/\n','/root\\oops',null])
    assert.throws(()=>folderPath(bad),/Invalid/);
  for(const bad of ['','.', '..','etc/passwd','weird\nname','x'.repeat(256)])
    assert.throws(()=>fileName(bad),/Invalid/);
  assert.throws(()=>childPath('/root/..','file'),/Invalid/);
});
test('SFTP create folder and rename do not overwrite existing files',async()=>{
  const f=fixture();
  const created=await action(f.sftp,{operation:'mkdir',folder:'/root',name:'safe'});
  assert.equal(created.path,'/root/safe');
  assert.ok(f.files.has('/root/safe'));
  await assert.rejects(action(f.sftp,{operation:'rename',folder:'/root',
    name:'original.txt',newName:'taken.txt'}),/already exists/);
  assert.ok(f.files.has('/root/original.txt'));
  assert.equal(f.calls.some(c=>c[0]==='rename'&&c[2]==='/root/taken.txt'),false);
  const renamed=await action(f.sftp,{operation:'rename',folder:'/root',
    name:'original.txt',newName:'renamed.txt'});
  assert.equal(renamed.path,'/root/renamed.txt');
  assert.ok(f.files.has('/root/renamed.txt'));
  await assert.rejects(action(f.sftp,{operation:'rename',folder:'/root',
    name:'renamed.txt',newName:'renamed.txt'}),/different/);
});
test('SFTP deletion uses lstat and never recursively removes folders',async()=>{
  const f=fixture();
  const file=await action(f.sftp,{operation:'delete',folder:'/root',name:'taken.txt'});
  assert.equal(file.directory,false);
  assert.ok(f.calls.some(c=>c[0]==='unlink'&&c[1]==='/root/taken.txt'));
  const dir=await action(f.sftp,{operation:'delete',folder:'/root',name:'sub'});
  assert.equal(dir.directory,true);
  assert.ok(f.calls.some(c=>c[0]==='rmdir'&&c[1]==='/root/sub'));
  await action(f.sftp,{operation:'delete',folder:'/root',name:'shortcut'});
  assert.ok(f.calls.some(c=>c[0]==='unlink'&&c[1]==='/root/shortcut'));
  assert.ok(!f.calls.some(c=>c[0]==='recursiveDelete'));
  await assert.rejects(action(f.sftp,{operation:'delete',folder:'/',name:'..'}),/Invalid/);
  await assert.rejects(action(f.sftp,{operation:'delete',folder:'/root',name:'missing'}),/NO_SUCH_FILE/);
});
test('SFTP rejects unexpected operations and lstat errors before destructive rename',async()=>{
  const f=fixture();
  await assert.rejects(action(f.sftp,{operation:'chmod',folder:'/root',name:'taken.txt'}),/Unsupported/);
  const sftp={lstat(_path,cb){cb(Object.assign(new Error('Access denied'),{code:3}));},
    rename(){throw Error('Must not attempt rename');}};
  await assert.rejects(action(sftp,{operation:'rename',folder:'/root',
    name:'original.txt',newName:'new.txt'}),/Access denied/);
});
