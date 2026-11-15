'use strict';
const fs=require('node:fs');
const {utils}=require('ssh2');

function loadPrivateKey(filename,passphrase=''){
  if(typeof filename!=='string'||filename.length>1024||!filename.trim())
    throw new Error('Select a valid SSH private key');
  if(filename.startsWith('vault:'))
    throw new Error('Legacy encrypted keys require reimport into a file');
  const stats=fs.statSync(filename);
  if(!stats.isFile()||stats.size<32||stats.size>512*1024)
    throw new Error('SSH private key file has an invalid size or type');
  if(typeof passphrase!=='string'||passphrase.length>4096)
    throw new Error('Invalid SSH key passphrase');
  const data=fs.readFileSync(filename);
  const result=utils.parseKey(data,passphrase||undefined);
  const keys=Array.isArray(result)?result:[result];
  const failure=keys.find(key=>key instanceof Error);
  if(failure){
    if(/encrypted|passphrase|decrypt|bad password/i.test(failure.message))
      throw new Error('SSH key is encrypted: enter the correct key passphrase');
    throw new Error('Unable to read SSH private key: '+failure.message);
  }
  if(!keys.length||!keys[0]||!keys[0].type)
    throw new Error('Invalid SSH private key');
  return {privateKey:data,passphrase:passphrase||undefined};
}
module.exports={loadPrivateKey};
