'use strict';
// Read-only SSH probe: appliance identity takes precedence over the base distro.
const PLATFORMS=[
  'proxmox','truenas','pfsense','opnsense','openwrt','routeros','synology',
  'qnap','unraid','esxi','ubuntu','debian','fedora','rocky','alma','centos',
  'rhel','arch','manjaro','opensuse','alpine','nixos','gentoo','freebsd',
  'openbsd','netbsd','macos','windows','wsl','linux','unknown'
];
const PROBE=[
  'printf "SHIRO_SYSTEM=%s\\n" "$(uname -s 2>/dev/null)"',
  'if command -v pveversion >/dev/null 2>&1 || test -d /etc/pve; then echo SHIRO_PLATFORM=proxmox; pveversion 2>/dev/null | head -1 | sed "s/^/SHIRO_VERSION=/"; fi',
  'if test -e /etc/ix-release || test -e /etc/truenas-version; then echo SHIRO_PLATFORM=truenas; fi',
  'if test -e /etc/pfSense-rc; then echo SHIRO_PLATFORM=pfsense; fi',
  'if test -e /usr/local/opnsense/version/opnsense; then echo SHIRO_PLATFORM=opnsense; fi',
  'if test -e /etc/openwrt_release; then echo SHIRO_PLATFORM=openwrt; fi',
  'if test -e /etc/synoinfo.conf; then echo SHIRO_PLATFORM=synology; fi',
  'if test -e /etc/config/qpkg.conf; then echo SHIRO_PLATFORM=qnap; fi',
  'if test -e /etc/unraid-version; then echo SHIRO_PLATFORM=unraid; fi',
  'if test -e /etc/vmware-release; then echo SHIRO_PLATFORM=esxi; fi',
  'if test -f /etc/os-release; then sed -n "s/^ID=//p" /etc/os-release | head -1 | tr -d \'"\' | sed "s/^/SHIRO_ID=/"; fi',
  'if command -v systemd-detect-virt >/dev/null 2>&1; then systemd-detect-virt 2>/dev/null | sed "s/^/SHIRO_VIRT=/"; fi',
  'if test -f /proc/sys/kernel/osrelease && grep -qi microsoft /proc/sys/kernel/osrelease; then echo SHIRO_PLATFORM=wsl; fi',
].join('; ');
const safe=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,95).trim();
function parseProbe(raw){
  const data={};
  for(const line of String(raw||'').slice(0,12000).split(/\r?\n/)){
    const match=/^SHIRO_([A-Z]+)=(.*)$/.exec(line);
    if(match)data[match[1]]=safe(match[2]);
  }
  const sys=(data.SYSTEM||'').toLowerCase();
  const distro=(data.ID||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let platform=(data.PLATFORM||'').toLowerCase();
  if(!PLATFORMS.includes(platform))platform='';
  let role='server',confidence=0.65;
  if(platform){
    confidence=0.98;
    role=['proxmox','esxi'].includes(platform)?'hypervisor':
      ['pfsense','opnsense','openwrt','routeros'].includes(platform)?'router':
      ['truenas','synology','qnap','unraid'].includes(platform)?'storage':'server';
  }else if(distro&&PLATFORMS.includes(distro)){
    platform=distro;
    confidence=0.82;
  }else if(sys.includes('freebsd')){platform='freebsd';confidence=0.85;}
  else if(sys.includes('openbsd')){platform='openbsd';confidence=0.85;}
  else if(sys.includes('netbsd')){platform='netbsd';confidence=0.85;}
  else if(sys.includes('darwin')){platform='macos';confidence=0.85;}
  else if(sys.includes('mingw')||sys.includes('windows')){platform='windows';confidence=0.75;}
  else if(sys.includes('linux')){platform='linux';confidence=0.55;}
  else{platform='unknown';confidence=0.2;}
  const virt=(data.VIRT||'').toLowerCase();
  if(['lxc','docker','podman','container','systemd-nspawn'].includes(virt))
    role='container';
  const version=safe(data.VERSION);
  return {platform,role,version,confidence};
}
function probe(client,callback){
  let done=false;
  const finish=result=>{if(done)return;done=true;callback(result);};
  const watchdog=setTimeout(()=>finish(null),6500);
  try{
    client.exec(PROBE,{pty:false},(error,stream)=>{
      if(error){clearTimeout(watchdog);finish(null);return;}
      let output='';
      stream.on('data',chunk=>{if(output.length<12000)output+=chunk.toString('utf8');});
      stream.on('close',()=>{
        clearTimeout(watchdog);
        const result=parseProbe(output);
        finish(result.platform==='unknown'?null:result);
      });
      stream.on('error',()=>{clearTimeout(watchdog);finish(null);});
    });
  }catch{clearTimeout(watchdog);finish(null);}
  return ()=>{clearTimeout(watchdog);finish(null);};
}
module.exports={PLATFORMS,PROBE,parseProbe,probe};
