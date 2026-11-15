'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const https=require('node:https');
const {createService}=require('../app.cjs');
const {configFromEnv}=require('../lib/config.cjs');
const ADMIN_PASSWORD='fixture-administrator-password-2026';
async function fixture(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-server-test-'));
  const passwordFile=path.join(dir,'admin_password');fs.writeFileSync(passwordFile,ADMIN_PASSWORD);
  let clock=Math.floor(Date.now()/1000);
  const config={...configFromEnv({PUBLIC_URL:'http://127.0.0.1',ALLOW_HTTP:'true',DATA_DIR:path.join(dir,'data'),
    ADMIN_PASSWORD_FILE:passwordFile,ADMIN_USER:'admin',HISTORY_LIMIT:'3'}),...options.config};
  const service=await createService({config,now:()=>clock,...options.service});
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  const base=(options.service?.tls?'https':'http')+'://127.0.0.1:'+service.server.address().port;
  config.publicUrl=base;
  return {dir,config,base,service,advance:seconds=>{clock+=seconds;},
    request:(route,input)=>request(base,route,{...input,ca:options.service?.tls?.cert}),
    async close(){await service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function request(base,route,{body,headers={},method=body===undefined?'GET':'POST',ca,rawBody}={}){
  return new Promise((resolve,reject)=>{
    const url=new URL(route,base),data=rawBody===undefined?(body===undefined?null:JSON.stringify(body)):rawBody;
    const req=(url.protocol==='https:'?https:http).request(url,{method,ca,
      headers:{...(data===null?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}),...headers}},res=>{
      const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>{
        const text=Buffer.concat(parts).toString('utf8');let json;
        try{json=JSON.parse(text);}catch{json=text;}
        resolve({status:res.statusCode,headers:res.headers,body:json});
      });
    });
    req.on('error',reject);req.end(data);
  });
}
async function login(f,username='admin',password=ADMIN_PASSWORD){
  const response=await f.request('/console/api/login',{body:{username,password},headers:{Origin:f.base}});
  if(response.status!==200)throw Error('Fixture browser login failed: '+JSON.stringify(response.body));
  const cookie=response.headers['set-cookie'][0].split(';')[0],csrf=response.body.csrf;
  return {cookie,csrf,headers:{Cookie:cookie,Origin:f.base,'X-CSRF-Token':csrf}};
}
module.exports={fixture,request,login,ADMIN_PASSWORD};
