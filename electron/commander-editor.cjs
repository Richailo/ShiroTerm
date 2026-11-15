'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {localPath,remoteFolder,entryName}=require('./file-commander.cjs');
const editors=new Map();
const MAX_EDIT_BYTES=64*1024*1024;
function getRemoteStat(sftp,name){
  return new Promise((ok,fail)=>sftp.lstat(name,(error,attrs)=>{
    if(error)fail(error);else ok(attrs);
  }));
}
function safeRegular(attrs){
  if(!attrs||attrs.isDirectory?.()||
     (typeof attrs.isFile==='function'&&!attrs.isFile()))
    throw Error('Only regular remote files can be edited');
  if(attrs.isSymbolicLink?.()||
      ((attrs.mode||0)&0o170000)===0o120000)throw Error('Cannot edit a symbolic link');
  if(attrs.size>MAX_EDIT_BYTES)throw Error('Edit limit is 64 MB. Download manually instead.');
}
function fastGet(sftp,remote,local){
  return new Promise((ok,fail)=>sftp.fastGet(remote,local,{},error=>error?fail(error):ok()));
}
function fastPut(sftp,local,remote){
  return new Promise((ok,fail)=>sftp.fastPut(local,remote,{},error=>error?fail(error):ok()));
}
async function openFile({connections,sessionId,side,localFolder,remoteDir,name,shell,dialog,win}){
  name=entryName(name);
  if(side==='local'){
    const local=path.join(localPath(localFolder),name);
    const stat=await fs.promises.lstat(local);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Only regular local files can be opened');
    const message=await shell.openPath(local);
    if(message)throw Error(message);
    return {ok:true,opened:true,side:'local'};
  }
  if(side!=='remote')throw Error('Invalid pane');
  const remote=path.posix.join(remoteFolder(remoteDir),name);
  const existing=editors.get(sessionId+':'+remote);
  if(existing){
    await shell.openPath(existing.local);
    return {ok:true,opened:true,side:'remote',alreadyOpen:true};
  }
  const sftp=await connections.getSftp(sessionId);
  const original=await getRemoteStat(sftp,remote);
  safeRegular(original);
  const staging=await fs.promises.mkdtemp(path.join(os.tmpdir(),'shiroterm-sftp-'));
  await fs.promises.chmod(staging,0o700).catch(()=>{});
  const local=path.join(staging,name);
  try{
    await fastGet(sftp,remote,local);
    const result=await shell.openPath(local);
    if(result)throw Error(result);
  }catch(error){
    await fs.promises.rm(staging,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
  const key=sessionId+':'+remote;
  const record={local,staging,remote,sftp,mtime:original.mtime,size:original.size,
    working:false,closed:false,debounce:null};
  editors.set(key,record);
  const onChange=async(current,previous)=>{
    if(record.closed||record.working||current.mtimeMs===previous.mtimeMs&&
       current.size===previous.size)return;
    if(record.debounce)clearTimeout(record.debounce);
    record.debounce=setTimeout(async()=>{
      if(record.closed||record.working)return;
      record.working=true;
      try{
        const {response}=await dialog.showMessageBox(win,{
          type:'question',title:'ShiroTerm · SFTP Edit',
          message:'Save changes to the remote SFTP server?',
          detail:remote+'\nThe local editor changed this file. Upload your edits? '+
            'The temporary copy is deleted when ShiroTerm closes.',
          buttons:['Upload changes','Do not upload'],defaultId:0,cancelId:1,
          noLink:true
        });
        if(response!==0)return;
        // Reacquire the active SFTP channel; a remote editor may stay open
        // while the original channel disconnects and is recreated.
        const liveSftp=await connections.getSftp(sessionId);
        const latest=await getRemoteStat(liveSftp,remote);
        safeRegular(latest);
        if(latest.mtime!==record.mtime||latest.size!==record.size)
          throw Error('Remote file changed since opening. Reload and resolve the conflict manually.');
        await fastPut(liveSftp,local,remote);
        const updated=await getRemoteStat(liveSftp,remote);
        record.mtime=updated.mtime;record.size=updated.size;
      }catch(error){
        await dialog.showMessageBox(win,{type:'error',title:'SFTP edit was not uploaded',
          message:String(error.message||error),buttons:['OK']}).catch(()=>{});
      }finally{record.working=false;}
    },800);
  };
  fs.watchFile(local,{interval:950},onChange);
  return {ok:true,opened:true,side:'remote',temporary:true};
}
function closeAll(){
  for(const record of editors.values()){
    record.closed=true;
    fs.unwatchFile(record.local);
    if(record.debounce)clearTimeout(record.debounce);
    // Temporary editing files are cleaned when the application exits.
    void fs.promises.rm(record.staging,{recursive:true,force:true}).catch(()=>{});
  }
  editors.clear();
}
module.exports={openFile,closeAll};
