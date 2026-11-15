'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Database}=require('./lib/database.cjs');
const {passwordHash,username}=require('./lib/auth.cjs');
(async()=>{
  const [command,input]=process.argv.slice(2);
  const db=new Database(path.resolve(process.env.DATA_DIR||'/data'));
  try{
    if(command==='reset-password'){
      const name=username(input);
      if(!db.get('SELECT username FROM users WHERE username=?',name))throw Error('User not found');
      let password='';for await(const chunk of process.stdin){password+=chunk;if(password.length>1026)throw Error('Password is too long');}
      const secured=await passwordHash(password.replace(/\r?\n$/,''));
      db.transaction(()=>{
        db.run('UPDATE users SET password=?,enabled=1 WHERE username=?',secured,name);
        db.run('DELETE FROM sessions WHERE username=?',name);
        db.run('DELETE FROM pairings WHERE approved_user=?',name);
      });
      console.log('Password reset. Restart the server to lock any in-memory Vaultwarden sessions.');
    }else if(command==='revoke-all'){
      db.transaction(()=>{db.run('DELETE FROM sessions');db.run('DELETE FROM pairings');});
      console.log('All sessions and pending device approvals revoked.');
    }else if(command==='backup'){
      if(!input||!path.isAbsolute(input)||fs.existsSync(input))throw Error('Choose a new absolute backup filename');
      db.db.prepare('VACUUM INTO ?').run(input);fs.chmodSync(input,0o600);
      console.log('Consistent database backup created.');
    }else throw Error('Usage: admin.cjs reset-password USER < private-password-file | admin.cjs backup /data/backup.sqlite | admin.cjs revoke-all');
  }finally{db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
