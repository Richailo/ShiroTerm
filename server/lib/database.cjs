'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {fail,text}=require('./errors.cjs');
function envelope(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).sort().join(',')!=='data,iv,salt,tag')fail(400,'Invalid encrypted snapshot');
  for(const [key,size] of [['salt',16],['iv',12],['tag',16],['data',null]]){
    const value=raw[key];
    if(typeof value!=='string'||!value||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      fail(400,'Invalid encrypted snapshot '+key);
    const buffer=Buffer.from(value,'base64');
    if(buffer.toString('base64')!==value||(size&&buffer.length!==size)||(!size&&buffer.length>1400000))
      fail(400,'Invalid encrypted snapshot '+key);
  }
  return JSON.stringify(raw);
}
class Database {
  constructor(dir,{historyLimit=100,now=()=>Math.floor(Date.now()/1000)}={}){
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    this.filename=path.join(dir,'shiroterm.sqlite');
    this.db=new DatabaseSync(this.filename);
    if(this.db.prepare('PRAGMA user_version').get().user_version>1){this.db.close();throw Error('Database schema is newer than this server');}
    fs.chmodSync(this.filename,0o600);
    this.now=now;this.historyLimit=historyLimit;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('browser','device')), csrf TEXT NOT NULL,
        label TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_owner ON sessions(username);
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL, expires INTEGER NOT NULL,
        approved_user TEXT REFERENCES users(username) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        name TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS vault_owner ON vaults(username);
      CREATE TABLE IF NOT EXISTS snapshots (
        vault TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, blob TEXT NOT NULL, updated INTEGER NOT NULL,
        PRIMARY KEY(vault,revision));
      PRAGMA user_version=1;`);
  }
  get(sql,...args){return this.db.prepare(sql).get(...args);}
  all(sql,...args){return this.db.prepare(sql).all(...args);}
  run(sql,...args){return this.db.prepare(sql).run(...args);}
  transaction(operation){
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=operation();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  createUser(username,password,admin=false){
    if(this.get('SELECT username FROM users WHERE username=?',username))fail(409,'User already exists');
    if(this.get('SELECT COUNT(*) AS count FROM users').count>=1000)fail(409,'User limit reached');
    this.transaction(()=>{
      this.run('INSERT INTO users(username,password,admin,created) VALUES(?,?,?,?)',username,password,+admin,this.now());
      this.run('INSERT INTO vaults(id,username,name,kind,created) VALUES(?,?,?,?,?)',
        'personal:'+username,username,'Personal','personal',this.now());
    });
  }
  vault(username,id){
    if(id!=='personal'&&!/^[a-f0-9]{32}$/.test(id))fail(400,'Invalid vault identifier');
    const internal=id==='personal'?'personal:'+username:id;
    const vault=this.get('SELECT * FROM vaults WHERE id=? AND username=?',internal,username);
    if(!vault)fail(404,'Vault not found');
    return vault;
  }
  snapshot(username,id){
    const vault=this.vault(username,id);
    const row=this.get('SELECT revision,blob,updated FROM snapshots WHERE vault=? ORDER BY revision DESC LIMIT 1',vault.id);
    return row?{...row,blob:JSON.parse(row.blob)}:{revision:0,blob:null,updated:0};
  }
  saveSnapshot(username,id,input){
    if(!Number.isSafeInteger(input?.expected_revision)||input.expected_revision<0)
      fail(400,'expected_revision must be a nonnegative integer');
    const blob=envelope(input.blob);
    return this.transaction(()=>{
      const vault=this.vault(username,id),current=this.snapshot(username,id);
      if(current.revision!==input.expected_revision)fail(409,'Conflict: remote configuration changed');
      const revision=current.revision+1,updated=this.now();
      this.run('INSERT INTO snapshots(vault,revision,blob,updated) VALUES(?,?,?,?)',vault.id,revision,blob,updated);
      this.run('DELETE FROM snapshots WHERE vault=? AND revision<=?',vault.id,revision-this.historyLimit);
      return {revision,updated};
    });
  }
  history(username,id,revision){
    const vault=this.vault(username,id);
    if(revision===undefined)return {versions:this.all(
      'SELECT revision,updated FROM snapshots WHERE vault=? ORDER BY revision DESC LIMIT ?',vault.id,this.historyLimit)};
    if(!Number.isSafeInteger(revision)||revision<1)fail(400,'Invalid snapshot revision');
    const row=this.get('SELECT revision,updated,blob FROM snapshots WHERE vault=? AND revision=?',vault.id,revision);
    if(!row)fail(404,'Snapshot version not found');
    return {...row,blob:JSON.parse(row.blob)};
  }
  listVaults(username){
    return {vaults:this.all(`SELECT v.id,v.name,v.kind,v.created,
      COALESCE(MAX(s.revision),0) AS revision,COALESCE(MAX(s.updated),0) AS updated
      FROM vaults v LEFT JOIN snapshots s ON s.vault=v.id WHERE v.username=?
      GROUP BY v.id ORDER BY v.created,v.id`,username).map(v=>({...v,id:v.kind==='personal'?'personal':v.id}))};
  }
  createVault(username,name){
    name=text(typeof name==='string'?name.trim():name,2,80,'vault name');
    if(this.get('SELECT COUNT(*) AS count FROM vaults WHERE username=?',username).count>=100)
      fail(409,'Vault limit reached');
    const id=require('node:crypto').randomBytes(16).toString('hex'),created=this.now();
    this.run('INSERT INTO vaults(id,username,name,kind,created) VALUES(?,?,?,?,?)',id,username,name,'private',created);
    return {id,name,kind:'private',created,updated:0,revision:0};
  }
  cleanup(){
    this.run('DELETE FROM sessions WHERE expires<=?',this.now());
    this.run('DELETE FROM pairings WHERE expires<=?',this.now());
  }
  close(){this.db.close();}
}
module.exports={Database,envelope};
