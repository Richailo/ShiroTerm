'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=__dirname;
const domain=process.argv[2];
if(!domain||domain.length>253||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)){
  console.error('Usage: node setup.cjs sync.example.com');process.exitCode=1;
}else{
  const env=path.join(root,'.env'),secretDir=path.join(root,'secrets');
  if(fs.existsSync(env)||fs.existsSync(secretDir)){
    console.error('Configuration already exists. Edit .env or use your existing secret; setup never overwrites them.');
    process.exitCode=1;
  }else{
    fs.mkdirSync(secretDir,{mode:0o700});
    const secret=path.join(secretDir,'admin_password');
    fs.writeFileSync(secret,crypto.randomBytes(24).toString('base64url')+'\n',{mode:0o444,flag:'wx'});
    // The private parent directory protects the file on the host. Its read-only
    // file mode allows the unprivileged container user to read the Compose secret.
    fs.chmodSync(secret,0o444);
    fs.writeFileSync(env,fs.readFileSync(path.join(root,'.env.example'),'utf8').replaceAll('sync.example.com',domain.toLowerCase()),
      {mode:0o600,flag:'wx'});
    console.log('Configuration created. Initial admin password: ./secrets/admin_password');
    console.log('Start with: docker compose up -d');
    console.log('Then open: https://'+domain.toLowerCase()+'/console');
  }
}
