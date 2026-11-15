'use strict';
const posix=require('node:path').posix;
const {constants}=require('node:fs');
const {OPEN_MODE,STATUS_CODE:ST}=require('ssh2/lib/protocol/SFTP.js');
function createSftpFixture(){
  const dirs=new Set(['/','/remote','/remote/docs']);
  const files=new Map([['/remote/readme.txt',Buffer.from('real SFTP fixture file\n')],
    ['/remote/docs/nested.txt',Buffer.from('nested SFTP content\n')]]);
  const sessions=[];
  function attach(client,onShell=()=>{}){
    client.on('session',accept=>{
      const session=accept();
      session.on('pty',cb=>cb?.());
      session.on('shell',acceptShell=>{onShell();acceptShell().write('local-ssh-smoke-success\n');});
      session.on('sftp',acceptSftp=>{
        const sftp=acceptSftp();sessions.push(sftp);
        const handles=new Map();let index=0;
        const attrs=name=>{
          const dir=dirs.has(name),file=files.get(name);
          if(!dir&&!file)return null;
          return {size:dir?0:file.length,uid:1000,gid:1000,
            mode:dir?constants.S_IFDIR|0o755:constants.S_IFREG|0o644,
            atime:1700000000,mtime:1700000000};
        };
        const handle=b=>b.length===4?handles.get(b.readUInt32BE(0)):null;
        const status=(id,code=ST.OK)=>sftp.status(id,code);
        const putHandle=(id,type,name)=>{
          const num=index++,value=Buffer.alloc(4);value.writeUInt32BE(num);
          handles.set(num,{type,name,read:false});sftp.handle(id,value);
        };
        const stat=(id,name)=>{const a=attrs(posix.normalize(name));
          if(a)sftp.attrs(id,a);else status(id,ST.NO_SUCH_FILE);};
        sftp.on('STAT',stat).on('LSTAT',stat);
        sftp.on('REALPATH',(id,name)=>{
          name=posix.normalize(name||'/');
          sftp.name(id,[{filename:name,longname:name,attrs:attrs(name)||{}}]);
        });
        sftp.on('FSTAT',(id,h)=>{const state=handle(h);
          if(!state)return status(id,ST.FAILURE);
          stat(id,state.name);
        });
        sftp.on('OPENDIR',(id,name)=>{
          name=posix.normalize(name);
          if(!dirs.has(name))return status(id,ST.NO_SUCH_FILE);
          putHandle(id,'dir',name);
        });
        sftp.on('READDIR',(id,h)=>{
          const state=handle(h);if(!state||state.type!=='dir')return status(id,ST.FAILURE);
          if(state.read)return status(id,ST.EOF);
          state.read=true;
          const names=[...dirs,...files.keys()].filter(p=>p!==state.name&&posix.dirname(p)===state.name);
          if(!names.length)return status(id,ST.EOF);
          sftp.name(id,names.map(p=>({filename:posix.basename(p),
            longname:posix.basename(p),attrs:attrs(p)})));
        });
        sftp.on('OPEN',(id,name,flags)=>{
          name=posix.normalize(name);
          if(!dirs.has(posix.dirname(name)))return status(id,ST.NO_SUCH_FILE);
          if(dirs.has(name))return status(id,ST.FAILURE);
          if(!files.has(name)&&!(flags&OPEN_MODE.CREAT))return status(id,ST.NO_SUCH_FILE);
          if(files.has(name)&&(flags&OPEN_MODE.EXCL))return status(id,ST.FAILURE);
          if(!files.has(name)||(flags&OPEN_MODE.TRUNC))files.set(name,Buffer.alloc(0));
          putHandle(id,'file',name);
        });
        sftp.on('READ',(id,h,offset,length)=>{
          const state=handle(h);if(!state||state.type!=='file')return status(id,ST.FAILURE);
          const buf=files.get(state.name);
          if(!buf||offset>=buf.length)return status(id,ST.EOF);
          sftp.data(id,buf.subarray(offset,offset+length));
        });
        sftp.on('WRITE',(id,h,offset,data)=>{
          const state=handle(h);
          if(!state||state.type!=='file'||offset>16*1024*1024)return status(id,ST.FAILURE);
          const old=files.get(state.name)||Buffer.alloc(0);
          const buf=Buffer.alloc(Math.max(old.length,offset+data.length));
          old.copy(buf);data.copy(buf,offset);files.set(state.name,buf);status(id);
        });
        sftp.on('CLOSE',(id,h)=>{
          if(h.length!==4||!handles.delete(h.readUInt32BE(0)))return status(id,ST.FAILURE);
          status(id);
        });
        sftp.on('MKDIR',(id,name)=>{
          name=posix.normalize(name);
          if(!dirs.has(posix.dirname(name))||attrs(name))return status(id,ST.FAILURE);
          dirs.add(name);status(id);
        });
        sftp.on('REMOVE',(id,name)=>{
          if(!files.delete(posix.normalize(name)))return status(id,ST.NO_SUCH_FILE);
          status(id);
        });
        sftp.on('RMDIR',(id,name)=>{
          name=posix.normalize(name);
          if(name==='/'||!dirs.has(name)||[...dirs,...files.keys()].some(p=>posix.dirname(p)===name))
            return status(id,ST.FAILURE);
          dirs.delete(name);status(id);
        });
      });
    });
  }
  return {attach,files,dirs,sessions};
}
module.exports={createSftpFixture};
