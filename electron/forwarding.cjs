'use strict';
const net=require('node:net');
const crypto=require('node:crypto');

function port(value){
  const number=Number(value);
  if(!Number.isInteger(number)||number<1||number>65535)
    throw new Error('Port must be between 1 and 65535');
  return number;
}
function targetName(value){
  if(typeof value!=='string'||!value.trim()||value.length>253||
      /[\s\/\\@]/.test(value))throw new Error('Invalid target hostname');
  return value.trim();
}
class LocalForwarding {
  constructor(sessionGetter){
    this.sessionGetter=sessionGetter;
    this.rules=new Map();
  }
  list(){
    return [...this.rules.values()].map(rule=>({
      id:rule.id,sessionId:rule.sessionId,listenPort:rule.listenPort,
      targetHost:rule.targetHost,targetPort:rule.targetPort
    }));
  }
  async start({sessionId,listenPort,targetHost,targetPort}){
    if(typeof sessionId!=='string'||sessionId.length>100)
      throw new Error('Invalid session');
    listenPort=port(listenPort);
    targetPort=port(targetPort);
    targetHost=targetName(targetHost);
    const record=this.sessionGetter(sessionId);
    if(!record||!record.ready||record.closing)
      throw new Error('SSH connection must be ready before forwarding');
    if(this.list().some(rule=>rule.listenPort===listenPort))
      throw new Error('The local port is already forwarded');
    const id=crypto.randomUUID();
    const sockets=new Set();
    const server=net.createServer(socket=>{
      sockets.add(socket);
      socket.on('close',()=>sockets.delete(socket));
      socket.setNoDelay(true);
      record.client.forwardOut('127.0.0.1',socket.remotePort||0,
        targetHost,targetPort,(err,channel)=>{
          if(err){socket.destroy();return;}
          if(socket.destroyed){channel.end();return;}
          channel.on('error',()=>socket.destroy());
          socket.on('error',()=>channel.destroy());
          channel.on('close',()=>socket.destroy());
          socket.on('close',()=>channel.destroy());
          channel.pipe(socket);
          socket.pipe(channel);
        });
    });
    const onClosed=()=>this.stop(id);
    record.client.on('close',onClosed);
    try{
      await new Promise((resolve,reject)=>{
        const onError=err=>reject(err);
        server.once('error',onError);
        server.listen(listenPort,'127.0.0.1',()=>{
          server.removeListener('error',onError);
          resolve();
        });
      });
      server.on('error',()=>this.stop(id));
    }catch(err){
      record.client.removeListener('close',onClosed);
      server.close();
      throw err;
    }
    this.rules.set(id,{id,sessionId,listenPort,targetHost,targetPort,
      server,sockets,client:record.client,onClosed});
    return {id,sessionId,listenPort,targetHost,targetPort};
  }
  stop(id){
    const rule=this.rules.get(id);
    if(!rule)return false;
    this.rules.delete(id);
    rule.client.removeListener('close',rule.onClosed);
    for(const socket of rule.sockets)socket.destroy();
    rule.server.close();
    return true;
  }
  stopAll(){
    for(const id of [...this.rules.keys()])this.stop(id);
  }
}
module.exports={LocalForwarding,port,targetName};
