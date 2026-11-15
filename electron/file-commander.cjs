'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const posix=path.posix;
const {randomUUID}=require('node:crypto');
const LIMIT=4096;
function localPath(input){
  if(typeof input!=='string'||!path.isAbsolute(input)||input.length>LIMIT||
     /[\x00-\x1f]/.test(input))throw Error('Absolute local path required');
  return path.normalize(input);
}
function remoteFolder(input){
  if(typeof input!=='string'||!input.startsWith('/')||input.length>LIMIT||
     /[\x00-\x1f\\]/.test(input))throw Error('Invalid remote directory');
  const segments=input.split('/');
  if(segments.some(s=>s==='..'))throw Error('Remote traversal not allowed');
  return posix.normalize(input);
}
function entryName(value){
  if(typeof value!=='string'||!value||value==='.'||value==='..'||
     value.includes('/')||value.includes('\\')||
     /[\x00-\x1f\x7f]/.test(value)||Buffer.byteLength(value,'utf8')>255)
    throw Error('Invalid file name');
  return value;
}
async function listLocal(folder){
  folder=localPath(folder||os.homedir());
  const items=await fs.promises.readdir(folder,{withFileTypes:true});
  const data=await Promise.all(items.filter(e=>!e.isSymbolicLink()).map(async entry=>{
    try{
      const stat=await fs.promises.lstat(path.join(folder,entry.name));
      if(!stat.isFile()&&!stat.isDirectory())return null;
      return {name:entry.name,directory:stat.isDirectory(),
        size:stat.size,mtime:Math.floor(stat.mtimeMs/1000)};
    }catch{return null;}
  }));
  return {folder,entries:data.filter(Boolean).sort((a,b)=>
    Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name))};
}
function statRemote(sftp,remote){
  return new Promise((resolve,reject)=>sftp.lstat(remote,(error,attrs)=>{
    if(error){
      if(error.code===2 || error.code==='ENOENT')return resolve(null);
      return reject(error);
    }
    resolve(attrs);
  }));
}
function mkdirRemote(sftp,remote){
  return new Promise((resolve,reject)=>sftp.mkdir(remote,e=>e?reject(e):resolve()));
}
function sendProgress(onProgress,id,done,total,name){
  if(onProgress)onProgress({taskId:id,name,bytes:done,total,
    percent:total>0?Math.min(100,Math.round(done/total*100)):100});
}
async function transfer({connections,sessionId,direction,localFolder,remoteDir,name,
                          overwrite=false,onProgress}){
  if(!['upload','download'].includes(direction))throw Error('Invalid direction');
  const local=path.join(localPath(localFolder),entryName(name));
  const remote=posix.join(remoteFolder(remoteDir),name);
  const sftp=await connections.getSftp(sessionId);
  const taskId=randomUUID();
  const remoteAttrs=await statRemote(sftp,remote);
  const localAttrs=await fs.promises.lstat(local).catch(e=>{
    if(e.code==='ENOENT')return null;
    throw e;
  });
  if(direction==='upload'){
    if(!localAttrs||!localAttrs.isFile())throw Error('Select a regular local file');
    if(localAttrs.isSymbolicLink?.())throw Error('Local symlinks are not supported');
    if(remoteAttrs&&typeof remoteAttrs.isDirectory==='function'&&remoteAttrs.isDirectory())
      throw Error('Destination is a remote directory');
    if(remoteAttrs&&typeof remoteAttrs.isSymbolicLink==='function'&&remoteAttrs.isSymbolicLink())
      throw Error('Refusing to overwrite a remote symbolic link');
    if(remoteAttrs&&!overwrite)throw Error('Remote file exists: confirm overwrite first');
  }else{
    if(!remoteAttrs)throw Error('Remote file no longer exists');
    if(typeof remoteAttrs.isDirectory==='function'&&remoteAttrs.isDirectory())
      throw Error('Select a remote file (folder transfers are not supported yet)');
    if(localAttrs&&!localAttrs.isFile())throw Error('Destination is not a regular file');
    if(localAttrs&&!overwrite)throw Error('Local file exists: confirm overwrite first');
  }
  const total=direction==='upload'?localAttrs.size:remoteAttrs.size||0;
  let lastUpdate=0;
  const step=(bytes,chunk,full)=>{
    const now=Date.now();
    if(now-lastUpdate>=125||bytes>=full){
      lastUpdate=now;sendProgress(onProgress,taskId,bytes,full||total,name);
    }
  };
  sendProgress(onProgress,taskId,0,total,name);
  // Stage downloads in the destination directory so a broken connection
  // cannot leave a corrupted final file or destroy an earlier version.
  const partial=direction==='download'?local+'.shiroterm-'+taskId+'.partial':null;
  try{
    await new Promise((resolve,reject)=>{
      const finish=error=>error?reject(error):resolve();
      if(direction==='upload')sftp.fastPut(local,remote,{step},finish);
      else sftp.fastGet(remote,partial,{step},finish);
    });
    if(partial){
      if(overwrite)await fs.promises.rename(partial,local);
      else {
        try{await fs.promises.link(partial,local);}
        catch(error){
          if(!['ENOSYS','ENOTSUP','EOPNOTSUPP','EPERM'].includes(error.code))throw error;
          await fs.promises.copyFile(partial,local,fs.constants.COPYFILE_EXCL);
        }
      }
    }
  }finally{
    if(partial)await fs.promises.rm(partial,{force:true}).catch(()=>{});
  }
  sendProgress(onProgress,taskId,total,total,name);
  return {ok:true,taskId,name,direction,total};
}
async function manageLocal({operation,folder,name,newName}){
  folder=localPath(folder);name=entryName(name||'');
  if(!['mkdir','rename','delete'].includes(operation))throw Error('Invalid local operation');
  const source=path.join(folder,name);
  if(operation==='mkdir'){
    await fs.promises.mkdir(source);
    return {operation,path:source,directory:true};
  }
  const attrs=await fs.promises.lstat(source);
  if(attrs.isSymbolicLink())throw Error('Refusing to modify a local symbolic link');
  if(operation==='rename'){
    const destination=path.join(folder,entryName(newName));
    await fs.promises.lstat(destination).then(()=>{throw Error('Destination already exists');},
      error=>{if(error.code!=='ENOENT')throw error;});
    await fs.promises.rename(source,destination);
    return {operation,path:destination,directory:attrs.isDirectory()};
  }
  if(attrs.isDirectory())await fs.promises.rmdir(source);
  else if(attrs.isFile())await fs.promises.unlink(source);
  else throw Error('Unsupported local file type');
  return {operation,path:source,directory:attrs.isDirectory()};
}
module.exports={listLocal,transfer,manageLocal,localPath,remoteFolder,entryName};


// Directory-aware Commander batch transfers. Never follow symlinks or path traversal.
function remoteReadDir(sftp,remote){
  return new Promise((resolve,reject)=>sftp.readdir(remote,(error,files)=>
    error?reject(error):resolve(files)));
}
function remoteMakeDir(sftp,remote){
  return new Promise((resolve,reject)=>sftp.mkdir(remote,error=>
    error?reject(error):resolve()));
}
async function ensureDirectory({sftp,local,remote,direction}){
  if(direction==='upload'){
    const found=await statRemote(sftp,remote);
    if(found){
      if(!found.isDirectory?.()||found.isSymbolicLink?.())
        throw Error('Destination folder is not a regular remote directory: '+remote);
    }else await remoteMakeDir(sftp,remote);
  }else{
    const found=await fs.promises.lstat(local).catch(e=>{
      if(e.code==='ENOENT')return null;
      throw e;
    });
    if(found){
      if(!found.isDirectory()||found.isSymbolicLink())
        throw Error('Destination folder is not a regular local directory: '+local);
    }else await fs.promises.mkdir(local);
  }
}
async function transferBatch({connections,sessionId,direction,localFolder,remoteDir,
                              names,overwrite=false,onProgress}){
  if(direction!=='upload'&&direction!=='download')throw Error('Invalid transfer direction');
  if(!Array.isArray(names)||!names.length||names.length>300)
    throw Error('Select between 1 and 300 entries');
  const unique=[...new Set(names.map(entryName))];
  if(unique.length!==names.length)throw Error('Duplicate transfer entries');
  const rootLocal=localPath(localFolder),rootRemote=remoteFolder(remoteDir);
  const sftp=await connections.getSftp(sessionId);
  const state={count:0,completed:0};
  const events=[];
  async function visit(name,localDir,remoteParent,depth){
    if(++state.count>3000||depth>16)throw Error('Transfer safety limit: too many files or folder levels');
    name=entryName(name);
    const local=path.join(localDir,name),remote=posix.join(remoteParent,name);
    if(direction==='upload'){
      const localStat=await fs.promises.lstat(local);
      if(localStat.isSymbolicLink())throw Error('Refusing local symbolic link: '+name);
      if(localStat.isDirectory()){
        await ensureDirectory({sftp,local,remote,direction});
        const children=await fs.promises.readdir(local,{withFileTypes:true});
        for(const entry of children){
          if(entry.isSymbolicLink())throw Error('Refusing symbolic link in '+name);
          await visit(entry.name,local,remote,depth+1);
        }
        return;
      }
      if(!localStat.isFile())throw Error('Unsupported local file type: '+name);
    }else{
      const attr=await statRemote(sftp,remote);
      if(!attr)throw Error('Remote entry disappeared: '+name);
      if(attr.isSymbolicLink?.())throw Error('Refusing remote symbolic link: '+name);
      if(attr.isDirectory?.()){
        await ensureDirectory({sftp,local,remote,direction});
        const children=await remoteReadDir(sftp,remote);
        for(const entry of children){
          if(entry.attrs?.isSymbolicLink?.())throw Error('Refusing remote symbolic link in '+name);
          await visit(entry.filename,local,remote,depth+1);
        }
        return;
      }
    }
    const transferName=depth===0?name:(direction==='upload'?
      path.relative(rootLocal,local):posix.relative(rootRemote,remote));
    const reply=await transfer({connections,sessionId,direction,
      localFolder:localDir,remoteDir:remoteParent,name,overwrite,
      onProgress:info=>onProgress?.({...info,name:transferName,
        filesCompleted:state.completed,filesVisited:state.count})});
    state.completed++;
    events.push({name:transferName,total:reply.total});
    onProgress?.({taskId:reply.taskId,name:transferName,bytes:reply.total,
      total:reply.total,percent:100,filesCompleted:state.completed,
      filesVisited:state.count,completed:true});
  }
  for(const name of unique)await visit(name,rootLocal,rootRemote,0);
  return {ok:true,count:state.completed,files:events};
}
module.exports.transferBatch=transferBatch;
