'use strict';
const net=require('node:net');
const {StringDecoder}=require('node:string_decoder');
const IAC=255,SE=240,SB=250,WILL=251,WONT=252,DO=253,DONT=254;
const ECHO=1,SGA=3;
function filterTelnet(state,input,respond){
  const output=[];
  for(const byte of input){
    if(state.phase==='data'){
      if(byte===IAC){state.phase='iac';continue;}
      output.push(byte);continue;
    }
    if(state.phase==='iac'){
      if(byte===IAC){output.push(IAC);state.phase='data';continue;}
      if(byte===WILL||byte===WONT||byte===DO||byte===DONT){
        state.command=byte;state.phase='option';continue;
      }
      if(byte===SB){state.phase='sub';continue;}
      state.phase='data';continue;
    }
    if(state.phase==='sub'){
      if(byte===IAC)state.phase='sub-iac';
      continue;
    }
    if(state.phase==='sub-iac'){
      state.phase=byte===SE?'data':byte===IAC?'sub':'sub';
      continue;
    }
    if(state.phase==='option'){
      if(state.command===WILL)
        respond(Buffer.from([IAC,byte===ECHO||byte===SGA?DO:DONT,byte]));
      else if(state.command===DO)
        respond(Buffer.from([IAC,WONT,byte]));
      // WONT/DONT are acknowledgments: don't reply and risk loops.
      state.phase='data';
    }
  }
  return Buffer.from(output);
}
class TelnetConnections{
  constructor(win,store,activity=null,{connect=net.createConnection}={}){
    this.win=win;this.store=store;this.activity=activity;
    this.connectSocket=connect;this.sessions=new Map();
  }
  emit(type,data){
    const record=this.sessions.get(data.sessionId);
    if(this.activity&&['status','error'].includes(type))
      this.activity.record({type,...data},record?.profile?.Name||record?.profile?.Host||'');
    if(!this.win.isDestroyed())
      this.win.webContents.send('ssh:event',{type,...data});
  }
  connect({id,sessionId}){
    const profile=this.store.config.Sessions.find(item=>item.Id===id);
    if(!profile||profile.Protocol!=='TELNET')throw new Error('Telnet host was not found');
    if(typeof sessionId!=='string'||!sessionId||sessionId.length>100)
      throw new Error('Invalid session ID');
    if(this.sessions.has(sessionId))throw new Error('Telnet session already exists');
    const port=Number(profile.Port);
    if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid Telnet port');
    if(!profile.Host||profile.Host.length>253)throw new Error('Invalid Telnet address');
    const socket=this.connectSocket({host:profile.Host,port});
    const record={profile,socket,phase:{phase:'data',command:0},
      decoder:new StringDecoder('utf8'),ready:false,closing:false};
    this.sessions.set(sessionId,record);
    this.emit('status',{sessionId,status:'connecting'});
    socket.setTimeout?.(15000);
    socket.on('connect',()=>{
      record.ready=true;
      socket.setTimeout?.(0);
      this.emit('status',{sessionId,status:'shell-ready'});
    });
    socket.on('data',buffer=>{
      const clean=filterTelnet(record.phase,buffer,reply=>{
        if(socket.writable)socket.write(reply);
      });
      if(clean.length){
        const chunk=record.decoder.write(clean);
        if(chunk)this.emit('data',{sessionId,data:chunk});
      }
    });
    socket.on('timeout',()=>socket.destroy(new Error('Telnet connection timed out')));
    socket.on('error',err=>this.emit('error',{
      sessionId,message:'Telnet: '+err.message
    }));
    socket.on('close',()=>{
      if(this.sessions.get(sessionId)!==record)return;
      const tail=record.decoder.end();
      if(tail)this.emit('data',{sessionId,data:tail});
      this.sessions.delete(sessionId);
      this.emit('status',{sessionId,status:'closed'});
    });
    return {sessionId};
  }
  write(sessionId,data){
    const record=this.sessions.get(sessionId);
    if(!record||!record.ready||!record.socket.writable)
      throw new Error('Telnet session is not connected');
    if(typeof data!=='string'||data.length>65536)throw new Error('Invalid Telnet input');
    // NVT CR is CR LF for Enter, or CR NUL for a literal carriage return.
    const wire=data.replace(/\r(?!\n)/g,'\r\n');
    const input=Buffer.from(wire,'utf8');
    const escaped=[];
    for(const b of input){escaped.push(b);if(b===IAC)escaped.push(IAC);}
    record.socket.write(Buffer.from(escaped));
  }
  disconnect(sessionId){
    const record=this.sessions.get(sessionId);
    if(!record)return false;
    record.closing=true;
    record.socket.destroy();
    return true;
  }
  closeAll(){for(const id of [...this.sessions.keys()])this.disconnect(id);}
}
module.exports={TelnetConnections,filterTelnet,IAC,WILL,DO,DONT,WONT,SB,SE};
