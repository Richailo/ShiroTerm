'use strict';
const fs=require('node:fs');
const path=require('node:path');
const posix=path.posix;
const crypto=require('node:crypto');
const base=require('./file-commander.cjs');
const MAX_ITEMS=20000,MAX_DEPTH=48;
const isDir=a=>!!(a&&(typeof a.isDirectory==='function'?a.isDirectory():a.mode&0o040000));
const isLink=a=>!!(a&&(typeof a.isSymbolicLink==='function'?a.isSymbolicLink():((a.mode||0)&0o170000)===0o120000));
const lstatRemote=(sftp,p)=>new Promise((ok,fail)=>sftp.lstat(p,(err,attrs)=>
  err?(err.code===2||err.code==='ENOENT'?ok(null):fail(err)):ok(attrs)));
const readRemote=(sftp,p)=>new Promise((ok,fail)=>sftp.readdir(p,(err,items)=>
  err?fail(err):ok(items)));
const mkdirRemote=(sftp,p)=>new Promise((ok,fail)=>sftp.mkdir(p,error=>error?fail(error):ok()));
const forbidden=a=>{if(isLink(a))throw Error('Symbolic links cannot be transferred safely');};
async function planTransfers(sftp,direction,localFolder,remoteDir,names){
  if(!Array.isArray(names)||!names.length||names.length>500)
    throw Error('Select 1–500 files or directories');
  const localRoot=base.localPath(localFolder);
  const remoteRoot=base.remoteFolder(remoteDir);
  const checked=[...new Set(names.map(base.entryName))];
  const folders=[],files=[];
  let count=0;
  async function visit(local,remote,depth){
    if(depth>MAX_DEPTH)throw Error('Folder nesting limit exceeded');
    if(++count>MAX_ITEMS)throw Error('Too many entries in transfer');
    const attrs=direction==='upload'?await fs.promises.lstat(local):await lstatRemote(sftp,remote);
    if(!attrs)throw Error('Source no longer exists');
    forbidden(attrs);
    const dir=isDir(attrs);
    if(!dir){files.push({local,remote,size:attrs.size||0});return;}
    folders.push({local,remote});
    if(direction==='upload'){
      for(const item of await fs.promises.readdir(local))
        await visit(path.join(local,base.entryName(item)),
          posix.join(remote,base.entryName(item)),depth+1);
    }else{
      for(const item of await readRemote(sftp,remote)){
        const name=base.entryName(item.filename);
        forbidden(item.attrs);
        await visit(path.join(local,name),posix.join(remote,name),depth+1);
      }
    }
  }
  for(const name of checked)
    await visit(path.join(localRoot,name),posix.join(remoteRoot,name),0);
  return {folders,files,total:files.reduce((sum,file)=>sum+file.size,0),names:checked};
}
async function transferBatch({connections,sessionId,direction,localFolder,remoteDir,
                              names,overwrite=false,onProgress}){
  if(direction!=='upload'&&direction!=='download')throw Error('Invalid direction');
  const sftp=await connections.getSftp(sessionId);
  const plan=await planTransfers(sftp,direction,localFolder,remoteDir,names);
  // Inspect every destination before modifying anything. In particular, never
  // follow a symlink in a destination directory or overwrite without consent.
  for(const item of [...plan.folders,...plan.files]){
    const destination=direction==='upload'?item.remote:item.local;
    const attrs=direction==='upload'?await lstatRemote(sftp,destination):
      await fs.promises.lstat(destination).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
    if(!attrs)continue;
    forbidden(attrs);
    if(plan.folders.includes(item)){
      if(!isDir(attrs))throw Error('Directory destination is a file: '+destination);
    }else if(isDir(attrs))throw Error('File destination is a directory: '+destination);
    else if(!overwrite)throw Error('Destination already exists; confirm overwrite: '+destination);
  }
  // A source directory may itself already exist on the other side. Preserve its
  // structure but do not silently replace any files without confirmation.
  for(const item of plan.folders){
    if(direction==='upload'){
      const exists=await lstatRemote(sftp,item.remote);
      if(!exists)await mkdirRemote(sftp,item.remote);
    }else await fs.promises.mkdir(item.local,{recursive:true});
  }
  const id=crypto.randomUUID();
  let completed=0,index=0;
  for(const file of plan.files){
    const relative=direction==='upload'?
      path.relative(base.localPath(localFolder),file.local):
      posix.relative(base.remoteFolder(remoteDir),file.remote);
    const parts=direction==='upload'?relative.split(path.sep):relative.split('/');
    const name=parts.pop();
    const localDir=path.dirname(file.local),remoteParent=posix.dirname(file.remote);
    await base.transfer({connections:{getSftp:async()=>sftp},sessionId,direction,
      localFolder:localDir,remoteDir:remoteParent,name,overwrite,
      onProgress:evt=>{
        const bytes=completed+evt.bytes;
        onProgress?.({taskId:id,name:relative,bytes,total:plan.total,
          percent:plan.total?Math.min(100,Math.round(bytes/plan.total*100)):100,
          current:index+1,fileCount:plan.files.length});
      }});
    completed+=file.size;index++;
  }
  onProgress?.({taskId:id,name:'Complete',bytes:plan.total,total:plan.total,
    percent:100,current:index,fileCount:plan.files.length});
  return {ok:true,files:plan.files.length,folders:plan.folders.length,
    total:plan.total,direction,names:plan.names};
}
async function transferExternal({connections,sessionId,remoteDir,paths,overwrite=false,onProgress}){
  if(!Array.isArray(paths)||!paths.length||paths.length>100)
    throw Error('Select 1–100 files or folders from your computer');
  const distinct=new Set();
  const groups=new Map();
  for(const raw of paths){
    const absolute=base.localPath(raw);
    const name=base.entryName(path.basename(absolute));
    if(distinct.has(name))throw Error('Different sources have the same file name: '+name);
    distinct.add(name);
    const parent=path.dirname(absolute);
    if(!groups.has(parent))groups.set(parent,[]);
    groups.get(parent).push(name);
  }
  let files=0,folders=0,total=0;
  for(const [localFolder,names] of groups){
    const result=await transferBatch({connections,sessionId,direction:'upload',
      localFolder,remoteDir,names,overwrite,onProgress});
    files+=result.files;folders+=result.folders;total+=result.total;
  }
  return {ok:true,files,folders,total,direction:'upload'};
}
module.exports={planTransfers,transferBatch,transferExternal};
