'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseProbe,PROBE,PLATFORMS,probe}=require('../electron/host-detection.cjs');
const {Store}=require('../electron/storage.cjs');

test('Proxmox VE takes priority over Debian base distro',()=>{
  const res=parseProbe('SHIRO_SYSTEM=Linux\nSHIRO_ID=debian\nSHIRO_PLATFORM=proxmox\nSHIRO_VERSION=pve-manager/9.1.0\nSHIRO_VIRT=none\n');
  assert.equal(res.platform,'proxmox');
  assert.equal(res.role,'hypervisor');
  assert.equal(res.confidence,0.98);
  assert.equal(res.version,'pve-manager/9.1.0');
});
test('recognizes free BSD, Linux, router and storage platforms conservatively',()=>{
  assert.equal(parseProbe('SHIRO_SYSTEM=FreeBSD\nSHIRO_PLATFORM=pfsense\n').platform,'pfsense');
  assert.equal(parseProbe('SHIRO_SYSTEM=Linux\nSHIRO_PLATFORM=truenas\n').role,'storage');
  assert.equal(parseProbe('SHIRO_SYSTEM=Linux\nSHIRO_ID=ubuntu\n').platform,'ubuntu');
  assert.equal(parseProbe('SHIRO_SYSTEM=Linux\nSHIRO_ID=debian\nSHIRO_VIRT=lxc\n').role,'container');
  assert.equal(parseProbe('SHIRO_SYSTEM=FreeBSD\n').platform,'freebsd');
  assert.equal(parseProbe('SHIRO_PLATFORM=malicious\nSHIRO_ID=debian\n').platform,'debian');
  assert.ok(PLATFORMS.length>=25);
  assert.ok(PROBE.includes('pveversion')&&PROBE.includes('/etc/pve'));
  assert.ok(!PROBE.includes('sudo ')&&!PROBE.includes('apt install'));
});
test('detection probe uses a separate read-only SSH exec channel and reports result',async()=>{
  const {PassThrough}=require('node:stream');
  let sent='';
  const client={exec(command,options,callback){
    sent=command;assert.equal(options.pty,false);
    const stream=new PassThrough();
    callback(null,stream);
    setImmediate(()=>{
      stream.write('SHIRO_SYSTEM=Linux\nSHIRO_ID=debian\nSHIRO_PLATFORM=proxmox\n');
      stream.emit('close');
    });
  }};
  const detected=await new Promise(resolve=>probe(client,resolve));
  assert.equal(detected.platform,'proxmox');
  assert.ok(sent.includes('uname')&&sent.includes('pveversion'));
});
test('detection persists without erasing existing user-controlled icon override',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-detection-'));
  try{
    const crypto={isEncryptionAvailable:()=>false};
    const store=new Store(dir,crypto);
    store.saveHost({Id:'srv1',Host:'192.0.2.101',Name:'Cluster PVE',
      PlatformOverride:'truenas',Protocol:'SSH'});
    store.saveHostDetection('srv1',{platform:'proxmox',role:'hypervisor',version:'pve-manager/9.1'});
    const entry=new Store(dir,crypto).list().Sessions.find(h=>h.Id==='srv1');
    assert.equal(entry.PlatformOverride,'truenas');
    assert.equal(entry.DetectedPlatform,'proxmox');
    assert.equal(entry.DetectedRole,'hypervisor');
    assert.ok(entry.DetectedAt);
    assert.equal(new Store(dir,crypto).list().Sessions.filter(h=>h.Id==='srv1').length,1);
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
