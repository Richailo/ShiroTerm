import {HardDrive,Monitor,Router,Server,ShieldCheck,TerminalSquare} from 'lucide-react';
import {
  siProxmox,siDebian,siUbuntu,siFedora,siRockylinux,siAlmalinux,
  siCentos,siRedhat,siArchlinux,siManjaro,siOpensuse,siAlpinelinux,
  siNixos,siGentoo,siFreebsd,siOpenbsd,siNetbsd,siApple,
  siTruenas,siPfsense,siOpnsense,siOpenwrt,siMikrotik,
  siSynology,siQnap,siUnraid,siVmware,siLinux
} from 'simple-icons';
import type {Host} from '../types';
const names:Record<string,string>={
  proxmox:'Proxmox VE',truenas:'TrueNAS',pfsense:'pfSense',opnsense:'OPNsense',
  openwrt:'OpenWrt',routeros:'MikroTik RouterOS',synology:'Synology DSM',
  qnap:'QNAP',unraid:'Unraid',esxi:'VMware ESXi',ubuntu:'Ubuntu',
  debian:'Debian',fedora:'Fedora',rocky:'Rocky Linux',alma:'AlmaLinux',
  centos:'CentOS',rhel:'Red Hat Enterprise Linux',arch:'Arch Linux',
  manjaro:'Manjaro',opensuse:'openSUSE',alpine:'Alpine Linux',
  nixos:'NixOS',gentoo:'Gentoo',freebsd:'FreeBSD',openbsd:'OpenBSD',
  netbsd:'NetBSD',macos:'macOS',windows:'Windows',wsl:'WSL',
  linux:'Linux',unknown:'Unknown system'
};
export const PLATFORM_OPTIONS=Object.entries(names);
export const platformFor=(host:Host)=>
  host.PlatformOverride||host.DetectedPlatform||
  (host.Protocol==='RDP'?'windows':'unknown');
export const platformName=(id:string)=>names[id]||'Unknown system';
type Logo={path:string;hex:string};
const logos:Record<string,Logo>={
  proxmox:siProxmox,truenas:siTruenas,pfsense:siPfsense,
  opnsense:siOpnsense,openwrt:siOpenwrt,routeros:siMikrotik,
  synology:siSynology,qnap:siQnap,unraid:siUnraid,esxi:siVmware,
  ubuntu:siUbuntu,debian:siDebian,fedora:siFedora,rocky:siRockylinux,
  alma:siAlmalinux,centos:siCentos,rhel:siRedhat,arch:siArchlinux,
  manjaro:siManjaro,opensuse:siOpensuse,alpine:siAlpinelinux,
  nixos:siNixos,gentoo:siGentoo,freebsd:siFreebsd,openbsd:siOpenbsd,
  netbsd:siNetbsd,macos:siApple,linux:siLinux,wsl:siLinux
};
// Accent colors are tuned for white SVGs and dark/light ShiroTerm themes.
export const PLATFORM_BACKGROUNDS:Record<string,string>={
  proxmox:'#c35400',truenas:'#08779b',pfsense:'#334b89',
  opnsense:'#c94017',openwrt:'#007eaa',routeros:'#46566c',
  synology:'#616c78',qnap:'#173d7d',unraid:'#bd4112',esxi:'#526a79',
  ubuntu:'#cb4517',debian:'#a81d33',fedora:'#3378aa',rocky:'#087b59',
  alma:'#365d9a',centos:'#51408b',rhel:'#c32929',arch:'#1473a3',
  manjaro:'#177a68',opensuse:'#438519',alpine:'#0d597f',
  nixos:'#526cb7',gentoo:'#65539b',freebsd:'#ab2b28',openbsd:'#8e6510',
  netbsd:'#af4c0b',macos:'#59677c',windows:'#156fc2',wsl:'#4d728f',
  linux:'#5d6676',unknown:'#44536f'
};
export default function PlatformIcon({platform,size=22}:{platform:string;size?:number}){
  const logo=logos[platform];
  let graphic;
  if(logo)graphic=<svg width={size} height={size} viewBox="0 0 24 24"
      preserveAspectRatio="xMidYMid meet" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={logo.path}/></svg>;
  else if(platform==='windows')graphic=<svg width={size} height={size}
      viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M2 5 L15 3.4 V15 H2 Z M17 3.1 L30 1.3 V15 H17 Z M2 17 H15 V29.1 L2 27.3 Z M17 17 H30 V30.7 L17 28.9 Z"/></svg>;
  else if(platform==='truenas'||platform==='qnap'||platform==='synology')
    graphic=<HardDrive size={size}/>;
  else if(platform==='pfsense'||platform==='opnsense')
    graphic=<ShieldCheck size={size}/>;
  else if(platform==='routeros'||platform==='openwrt')
    graphic=<Router size={size}/>;
  else if(platform==='macos')graphic=<Monitor size={size}/>;
  else if(platform==='wsl')graphic=<TerminalSquare size={size}/>;
  else graphic=<Server size={size}/>;
  return <div className={'platform-icon platform-'+platform} role="img"
    aria-label={platformName(platform)} title={platformName(platform)}
    style={{backgroundColor:PLATFORM_BACKGROUNDS[platform]||PLATFORM_BACKGROUNDS.unknown}}>
    {graphic}
  </div>;
}
