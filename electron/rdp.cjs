'use strict';
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');

// RDP is delegated to the platform's external graphical client.
// No passwords, gateway tokens or secrets ever enter process arguments.
function endpoint(profile){
  if(!profile||profile.Protocol!=='RDP')throw new Error('Host is not configured for RDP');
  const hostname=String(profile.Host||'').trim();
  const port=Number(profile.Port||3389);
  if(!hostname||hostname.length>253||/[\x00-\x20\x7f\/"'<>|?*]/.test(hostname))
    throw new Error('Invalid RDP hostname');
  if(!Number.isInteger(port)||port<1||port>65535)
    throw new Error('Invalid RDP port');
  const isIpv6=hostname.includes(':');
  if(isIpv6&&!/^\[?[0-9a-f:.%]+\]?$/i.test(hostname))
    throw new Error('Invalid IPv6 address');
  if(!isIpv6&&!/^[a-z0-9_.-]+$/i.test(hostname))
    throw new Error('Invalid RDP address');
  const normalized=isIpv6&&hostname[0]!=='['?'['+hostname+']':hostname;
  return normalized+(port===3389?'':':'+port);
}
function clientPath(windowsDir=process.env.WINDIR||'C:\\Windows'){
  if(!path.win32.isAbsolute(windowsDir))throw new Error('Invalid Windows directory');
  return path.win32.join(windowsDir,'System32','mstsc.exe');
}
// A spawned mstsc.exe is not a connected RDP session. Fail early and clearly
// when the target does not accept TCP connections, before showing a login hint.
function checkReachability(profile,{dial=net.createConnection,timeoutMs=3000}={}){
  const address=endpoint(profile);
  const rawHost=String(profile.Host).trim();
  const host=rawHost.startsWith('[')&&rawHost.endsWith(']')?rawHost.slice(1,-1):rawHost;
  const port=Number(profile.Port||3389);
  return new Promise((resolve,reject)=>{
    let socket;
    let settled=false;
    const finish=(reason)=>{
      if(settled)return;
      settled=true;
      if(socket)socket.destroy();
      if(!reason){resolve({address,port});return;}
      reject(new Error('RDP '+address+' cannot be reached on TCP port '+port+': '+reason+
        '. Check Remote Desktop on the destination PC, Windows edition, firewall and network access.'));
    };
    try{
      socket=dial({host,port});
      socket.setTimeout(timeoutMs,()=>finish('connection timed out'));
      socket.once('connect',()=>finish());
      socket.once('error',err=>finish(err.code==='ECONNREFUSED'?'connection refused':
        (err.code||err.message||'connection error')));
    }catch(err){finish(err.message||String(err));}
  });
}
function launch(profile,{run=spawn,platform=process.platform,windowsDir=process.env.WINDIR||'C:\\Windows'}={}){
  if(!['win32','linux'].includes(platform))return Promise.reject(new Error('RDP is supported on Windows and Linux'));
  let address;
  try{address=endpoint(profile);}catch(e){return Promise.reject(e);}
  return new Promise((resolve,reject)=>{
    const label=platform==='win32'?'Windows Remote Desktop':'Remmina';
    const binary=platform==='win32'?clientPath(windowsDir):'remmina';
    const args=platform==='win32'?['/v:'+address,'/prompt']:['--connect','rdp://'+address];
    let child;
    try{
      child=run(binary,args,{
        shell:false,windowsHide:false,detached:false,stdio:'ignore'
      });
    }catch(err){reject(new Error('Could not start '+label+': '+err.message));return;}
    let settled=false;
    const fail=err=>{
      if(settled)return;
      settled=true;
      reject(new Error(label+' could not start: '+(err.message||err)+
        (platform==='linux'&&err.code==='ENOENT'?'. Install Remmina with its RDP plugin using your distribution package manager.':'')));
    };
    child.once('error',fail);
    child.once('spawn',()=>{
      if(settled)return;
      settled=true;
      resolve({address,external:true,client:label,processId:child.pid||null});
    });
  });
}
module.exports={endpoint,clientPath,checkReachability,launch};
