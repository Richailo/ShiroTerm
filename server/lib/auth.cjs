'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const {fail,text}=require('./errors.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const token=()=>crypto.randomBytes(48).toString('base64url');
let passwordJobs=0;
async function derive(value,salt){
  if(passwordJobs>=4)fail(429,'Too many password operations. Try again shortly.');
  passwordJobs++;
  try{return await scrypt(value,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
  finally{passwordJobs--;}
}
function username(value){
  const result=String(value||'').toLowerCase().trim();
  if(!/^[a-z][a-z0-9_.-]{2,47}$/.test(result))fail(400,'Username must contain 3–48 letters, digits, dots, underscores or hyphens');
  return result;
}
async function passwordHash(value){
  text(value,12,1024,'password (12–1024 characters)');
  const salt=crypto.randomBytes(16);
  const key=await derive(value,salt);
  return salt.toString('hex')+':'+key.toString('hex');
}
async function passwordMatches(value,stored){
  const [salt,key]=(stored||'00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000').split(':');
  const candidate=await derive(typeof value==='string'?value.slice(0,1024):'',Buffer.from(salt,'hex'));
  return crypto.timingSafeEqual(candidate,Buffer.from(key,'hex'));
}
class Auth {
  constructor(db,config){this.db=db;this.config=config;this.busy=0;}
  async credentials(input){
    if(this.busy>=8)fail(429,'Too many sign-in attempts. Try again shortly.');
    this.busy++;
    try{
      const name=username(input?.username),row=this.db.get('SELECT * FROM users WHERE username=?',name);
      const valid=await passwordMatches(input?.password,row?.password);
      if(!row||!row.enabled||!valid)fail(401,'Invalid username or password');
      return row;
    }finally{this.busy--;}
  }
  issue(user,kind,label='ShiroTerm desktop'){
    const raw=token(),csrf=token(),created=this.db.now();
    const expires=created+(kind==='device'?this.config.deviceDays*86400:this.config.browserHours*3600);
    // Oldest sessions are retired, so a compromised account cannot grow storage indefinitely.
    this.db.run(`DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE username=?
      ORDER BY created DESC LIMIT -1 OFFSET 99)`,user);
    this.db.run('INSERT INTO sessions(hash,username,kind,csrf,label,created,expires) VALUES(?,?,?,?,?,?,?)',
      hash(raw),user,kind,csrf,label,created,expires);
    return {token:raw,user,expires,csrf};
  }
  authenticate(req,{browserOnly=false}={}){
    let raw='',kind='browser';
    if(!browserOnly&&req.headers.authorization){
      if(!/^Bearer [A-Za-z0-9_-]{64}$/.test(req.headers.authorization))fail(401,'Unauthorized');
      raw=req.headers.authorization.slice(7);kind='device';
    }else{
      raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('shiro_session='))?.slice(14)||'';
    }
    if(!/^[A-Za-z0-9_-]{64}$/.test(raw))fail(401,'Unauthorized');
    const row=this.db.get(`SELECT s.*,u.admin FROM sessions s JOIN users u ON u.username=s.username
      WHERE s.hash=? AND s.kind=? AND s.expires>? AND u.enabled=1`,hash(raw),kind,this.db.now());
    if(!row)fail(401,'Unauthorized');
    return row;
  }
  origin(req){if(req.headers.origin!==this.config.publicUrl)fail(403,'Request origin is not allowed');}
  csrf(req,session){
    this.origin(req);
    if(req.headers['x-csrf-token']!==session.csrf)fail(403,'Invalid CSRF token');
  }
  cookie(raw,maxAge){return 'shiro_session='+raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+
    (this.config.publicUrl.startsWith('https:')?'; Secure':'');}
  startPairing(input){
    this.db.cleanup();
    if(this.db.get('SELECT COUNT(*) AS count FROM pairings').count>=1000)fail(429,'Too many pending device requests');
    const id=crypto.randomBytes(16).toString('hex'),secret=token();
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes=crypto.randomBytes(8),raw=[...bytes].map(n=>alphabet[n%32]).join('');
    const code=raw.slice(0,4)+'-'+raw.slice(4),expires=this.db.now()+600;
    const label=text(input?.label||'ShiroTerm desktop',1,70,'device name');
    this.db.run('INSERT INTO pairings(id,secret_hash,code_hash,label,expires) VALUES(?,?,?,?,?)',id,hash(secret),hash(code),label,expires);
    return {id,secret,code,expiresIn:600,portalUrl:this.config.publicUrl+'/console'};
  }
  pairing(code){
    code=String(code||'').trim().toUpperCase().replace(/\s/g,'');
    if(!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code))fail(400,'Enter the eight-character device code');
    const row=this.db.get('SELECT * FROM pairings WHERE code_hash=? AND expires>?',hash(code),this.db.now());
    if(!row)fail(404,'Device code not found or expired');
    return row;
  }
  approve(user,code){
    const row=this.pairing(code);
    if(row.approved_user)fail(409,'This device code has already been approved');
    this.db.run('UPDATE pairings SET approved_user=? WHERE id=? AND approved_user IS NULL',user,row.id);
    return {approved:true};
  }
  poll(input){
    if(!/^[a-f0-9]{32}$/.test(input?.id||'')||!/^[A-Za-z0-9_-]{64}$/.test(input?.secret||''))
      fail(400,'Invalid pairing request');
    return this.db.transaction(()=>{
      const row=this.db.get('SELECT * FROM pairings WHERE id=? AND expires>?',input.id,this.db.now());
      if(!row||!crypto.timingSafeEqual(Buffer.from(hash(input.secret),'hex'),Buffer.from(row.secret_hash,'hex')))
        fail(410,'Pairing request expired or consumed');
      if(!row.approved_user)return {status:'pending'};
      const user=this.db.get('SELECT enabled FROM users WHERE username=?',row.approved_user);
      if(!user?.enabled)fail(401,'Unauthorized');
      const issued=this.issue(row.approved_user,'device',row.label);
      this.db.run('DELETE FROM pairings WHERE id=?',row.id);
      const {csrf,...device}=issued;
      return {status:'approved',...device};
    });
  }
}
class RateLimit {
  constructor(now=()=>Date.now()){this.buckets=new Map();this.now=now;}
  take(key,limit,windowMs){
    const now=this.now();let bucket=this.buckets.get(key);
    if(!bucket||bucket.until<=now){
      if(this.buckets.size>=10000){
        for(const [id,value] of this.buckets)if(value.until<=now)this.buckets.delete(id);
        if(this.buckets.size>=10000)fail(429,'Server is busy. Try again later.');
      }
      bucket={count:0,until:now+windowMs};this.buckets.set(key,bucket);
    }
    if(++bucket.count>limit)fail(429,'Too many requests. Try again later.');
  }
}
module.exports={Auth,RateLimit,hash,passwordHash,passwordMatches,username};
