'use strict';
const fs=require('node:fs');
const path=require('node:path');
const tls=require('node:tls');
const net=require('node:net');
const {X509Certificate}=require('node:crypto');
function origin(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw Error('Nieprawidłowy adres serwera HTTPS.');
  return url.origin;
}
function parseCertificates(input,{checkDates=true}={}){
  const raw=Buffer.isBuffer(input)?input:Buffer.from(String(input));
  if(!raw.length||raw.length>262144)throw Error('Nieprawidłowy plik certyfikatu.');
  const text=raw.toString('utf8');
  if(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text))
    throw Error('Wybierz certyfikat publiczny, bez klucza prywatnego.');
  const blocks=text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[raw];
  if(blocks.length>16)throw Error('Plik zawiera zbyt wiele certyfikatów.');
  return blocks.map(block=>{
    let cert;
    try{cert=new X509Certificate(block);}catch{throw Error('Nie można odczytać certyfikatu PEM, CRT lub DER.');}
    if(!cert.ca&&!(cert.subject===cert.issuer&&cert.verify(cert.publicKey)))
      throw Error('Wybierz certyfikat CA lub własny certyfikat serwera.');
    if(checkDates&&(Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now()))
      throw Error('Certyfikat jest nieważny lub wygasł.');
    return cert.toString();
  });
}
let roots;
function systemRoots(){
  if(roots)return roots;
  const found=[];
  if(typeof tls.getCACertificates==='function'){
    for(const type of ['default','system'])try{found.push(...tls.getCACertificates(type));}catch{}
  }
  roots=[...new Set([...tls.rootCertificates,...found])];
  return roots;
}
function tlsMessage(error){
  if(['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_UNTRUSTED'].includes(error?.code))
    return 'Nieufny certyfikat HTTPS. Wybierz certyfikat serwera.';
  if(error?.code==='CERT_HAS_EXPIRED')return 'Certyfikat HTTPS serwera wygasł.';
  if(error?.code==='CERT_NOT_YET_VALID')return 'Certyfikat HTTPS serwera nie jest jeszcze ważny.';
  if(error?.code==='ERR_TLS_CERT_ALTNAME_INVALID')return 'Adres serwera nie zgadza się z certyfikatem HTTPS.';
  return error?.message||String(error);
}
class ServerCertificates {
  constructor(dir){
    this.file=dir?path.join(dir,'server-certificates.json'):null;
    this.servers={};
    if(this.file)try{
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version===1&&data.servers&&typeof data.servers==='object')
        for(const [url,pems] of Object.entries(data.servers).slice(0,100))try{
          if(!Array.isArray(pems))continue;
          this.servers[origin(url)]=parseCertificates(pems.join('\n'),{checkDates:false});
        }catch{}
    }catch{}
  }
  info(url){
    const certs=this.servers[origin(url)];
    if(!certs?.length)return null;
    const cert=new X509Certificate(certs[0]);
    return {subject:cert.subject,fingerprint:cert.fingerprint256,validTo:cert.validTo};
  }
  options(url,extra=[]){
    const env=process.env.SHIROTERM_SYNC_CA?
      parseCertificates(fs.readFileSync(process.env.SHIROTERM_SYNC_CA),{checkDates:false}):[];
    return {ca:[...systemRoots(),...env,...(this.servers[origin(url)]||[]),...extra],rejectUnauthorized:true};
  }
  save(next){
    if(!this.file)throw Error('Brak lokalnego profilu do zapisania certyfikatu.');
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temp=this.file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temp,JSON.stringify({version:1,servers:next}),{mode:0o600,flag:'wx'});
    try{fs.renameSync(temp,this.file);this.servers=next;}
    finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  set(url,input){
    url=origin(url);const pems=parseCertificates(input);
    if(!this.servers[url]&&Object.keys(this.servers).length>=100)throw Error('Osiągnięto limit zapisanych certyfikatów.');
    this.save({...this.servers,[url]:pems});return this.info(url);
  }
  remove(url){
    url=origin(url);const next={...this.servers};delete next[url];this.save(next);return true;
  }
  verify(url,input){
    url=origin(url);const pems=parseCertificates(input),target=new URL(url);
    const host=target.hostname.replace(/^\[|\]$/g,'');
    return new Promise((resolve,reject)=>{
      const socket=tls.connect({host,port:Number(target.port||443),
        servername:net.isIP(host)?undefined:host,ca:pems,rejectUnauthorized:true},()=>{
        socket.end();resolve(pems);
      });
      socket.setTimeout(6000,()=>socket.destroy(Error('Serwer nie odpowiada.')));
      socket.once('error',error=>reject(Error(tlsMessage(error))));
    });
  }
}
module.exports={ServerCertificates,parseCertificates,systemRoots,tlsMessage};
