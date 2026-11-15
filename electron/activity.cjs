'use strict';
const crypto=require('node:crypto');
const MAX_RECORDS=500;
const ALLOWED=new Set(['status','error','verify']);
class Activity {
  constructor(){this.entries=[];}
  record(event,description=''){
    if(!event||!ALLOWED.has(event.type))return false;
    const clean=(value,max)=>typeof value==='string'?
      value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
    const entry={
      id:crypto.randomUUID(),
      time:new Date().toISOString(),
      type:event.type,
      sessionId:clean(event.sessionId,100),
      host:clean(description,256),
      status:clean(event.status,72),
      message:clean(event.message,350).replace(/(password|passphrase|token|secret)\s*[:=]\s*\S+/gi,'$1=[REDACTED]'),
      changed:event.type==='verify'?!!event.changed:false
    };
    // Never retain terminal output, passwords, key material or full event payloads.
    this.entries.push(entry);
    if(this.entries.length>MAX_RECORDS)
      this.entries.splice(0,this.entries.length-MAX_RECORDS);
    return true;
  }
  list(){return this.entries.map(entry=>({...entry}));}
  clear(){this.entries=[];return true;}
}
module.exports={Activity,MAX_RECORDS};
