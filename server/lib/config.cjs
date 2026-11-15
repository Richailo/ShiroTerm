'use strict';
const path=require('node:path');
function origin(input,allowHttp=false){
  let value;
  try{value=new URL(input);}catch{throw Error('PUBLIC_URL must be a valid HTTPS origin');}
  if(value.username||value.password||value.search||value.hash||value.pathname!=='/'||
    (value.protocol!=='https:'&&!(allowHttp&&value.protocol==='http:')))
    throw Error('PUBLIC_URL must be an HTTPS origin without a path or credentials');
  return value.origin;
}
function number(env,key,fallback,min,max){
  const result=env[key]===undefined?fallback:Number(env[key]);
  if(!Number.isSafeInteger(result)||result<min||result>max)throw Error('Invalid '+key);
  return result;
}
function configFromEnv(env=process.env){
  return {
    publicUrl:origin(env.PUBLIC_URL,env.ALLOW_HTTP==='true'),
    host:env.HOST||'0.0.0.0',port:number(env,'PORT',8080,1,65535),
    dataDir:path.resolve(env.DATA_DIR||'/data'),
    adminUser:env.ADMIN_USER||'admin',adminPasswordFile:env.ADMIN_PASSWORD_FILE||'',
    deviceDays:number(env,'DEVICE_SESSION_DAYS',30,1,365),
    browserHours:number(env,'BROWSER_SESSION_HOURS',12,1,48),
    historyLimit:number(env,'HISTORY_LIMIT',100,2,1000),
    vaultUrl:env.VAULTWARDEN_URL?origin(env.VAULTWARDEN_URL):'',
    vaultMinutes:number(env,'VAULT_UNLOCK_MINUTES',60,5,1440),
    bwPath:env.BW_PATH||'/usr/local/bin/bw',
    maxBody:1900000
  };
}
module.exports={configFromEnv,origin};
