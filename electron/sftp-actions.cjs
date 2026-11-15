'use strict';
const posix=require('node:path').posix;
function folderPath(input){
  if(typeof input!=='string'||input.length>4096||!input.startsWith('/')||
    /[\x00-\x1f\x7f\\]/.test(input)||input.split('/').some(p=>p==='..'||p==='.'))
    throw new Error('Invalid absolute SFTP directory');
  return posix.normalize(input);
}
function fileName(input){
  if(typeof input!=='string'||!input.length||input==='.'||input==='..'||
    Buffer.byteLength(input,'utf8')>255||/[\x00-\x1f\x7f\\/]/.test(input))
    throw new Error('Invalid file name: use a single name without path separators');
  return input;
}
function childPath(folder,name){
  const base=folderPath(folder);
  const safe=fileName(name);
  const combined=posix.join(base,safe);
  if(combined.length>4096)throw new Error('SFTP path exceeds maximum length');
  return combined;
}
function sftpCall(sftp,method,...args){
  return new Promise((resolve,reject)=>{
    if(typeof sftp[method]!=='function'){reject(new Error('SFTP '+method+' unsupported'));return;}
    sftp[method](...args,(err,result)=>err?reject(err):resolve(result));
  });
}
async function action(sftp,request){
  if(!request||typeof request!=='object')throw new Error('Missing SFTP operation');
  const {operation,folder,name,newName}=request;
  const target=childPath(folder,name);
  if(operation==='mkdir'){
    await sftpCall(sftp,'mkdir',target);
    return {path:target,operation};
  }
  if(operation==='rename'){
    const destination=childPath(folder,newName);
    if(destination===target)throw new Error('Choose a different filename');
    let exists=false;
    try{await sftpCall(sftp,'lstat',destination);exists=true;}
    catch(e){
      // SSH_FX_NO_SUCH_FILE (2): any other failure must not mean "safe to overwrite".
      if(e?.code!==2)throw e;
    }
    if(exists)throw new Error('Destination already exists. Rename will not overwrite it.');
    await sftpCall(sftp,'rename',target,destination);
    return {path:destination,operation};
  }
  if(operation==='delete'){
    const attrs=await sftpCall(sftp,'lstat',target);
    const isDirectory=typeof attrs.isDirectory==='function'?
      attrs.isDirectory():!!(attrs.mode&0o040000);
    // Never delete recursively. lstat treats symlinks as links, not target dirs.
    await sftpCall(sftp,isDirectory?'rmdir':'unlink',target);
    return {path:target,operation,directory:isDirectory};
  }
  throw new Error('Unsupported SFTP action');
}
module.exports={folderPath,fileName,childPath,sftpCall,action};
