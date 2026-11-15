import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {
  Activity,ArrowLeftRight,Check,ChevronDown,ChevronRight,Cloud,CloudOff,
  FileCode2,Fingerprint,Folder,HardDrive,KeyRound,Menu,Minus,Monitor,Palette,
  PanelRightClose,Plus,RefreshCcw,Search,Server,Settings2,ShieldAlert,Copy,Pencil,MoreVertical,Heart,PlugZap,
  Square,Star,TerminalSquare,Trash2,Wifi,X,Braces
} from 'lucide-react';
const Terminal=lazy(()=>import('./components/Terminal'));
const Sftp=lazy(()=>import('./components/Sftp'));
const Snippets=lazy(()=>import('./components/Snippets'));
const KnownHosts=lazy(()=>import('./components/KnownHosts'));
const Forwarding=lazy(()=>import('./components/Forwarding'));
const Keychain=lazy(()=>import('./components/KeychainSimple'));
const Sync=lazy(()=>import('./components/VaultsSimple'));
const ServerConnection=lazy(()=>import('./components/ServerConnection'));
const Logs=lazy(()=>import('./components/Logs'));
const LoginPrompt=lazy(()=>import('./components/LoginPrompt'));
const SessionTools=lazy(()=>import('./components/SessionTools'));
import PlatformIcon,{platformFor,platformName,PLATFORM_OPTIONS} from './components/PlatformIcon';
import type {LoginValues} from './components/LoginPrompt';
import {appPalette} from './app-palette';
import {TERMINAL_THEME_BY_ID,readThemePreferences,saveThemePreferences,
  type TerminalThemeId,type TerminalThemePreferences} from './terminal-themes';
import type {Folder as HostFolder,Host,Credential,Profiles,Session,SshEvent} from './types';
import {moveSession,sessionIdsToClose,nextTabId,type CloseScope} from './tab-operations';

const emptyHost=():Host=>({
  Id:crypto.randomUUID(),Name:'',Host:'',User:'',Protocol:'SSH',Port:22,
  FolderId:'',CredentialId:'',Tags:'',Notes:'',Favorite:false,KeyFile:'',JumpHost:'',
  AutoReconnect:false,SshKeepAliveSeconds:30
});
const statusLabel:Record<string,string>={
  connecting:'Connecting…',
  'connecting-jump':'Connecting to gateway…',
  'jump-connected':'Establishing secure tunnel…',
  connected:'Connected',
  'shell-ready':'Connected',
  'sftp-ready':'SFTP ready',
  'reconnect-wait':'Waiting to reconnect',
  'reconnect-attempt':'Reconnecting…',
  'reconnect-exhausted':'Reconnect attempts exhausted',
  'reconnect-stopped':'Automatic reconnect stopped',
  error:'Connection error',
  closed:'Disconnected'
};
const navigation=[
  {id:'hosts',label:'Hosts',icon:Server},
  {id:'keychain',label:'Keychain',icon:KeyRound},
  {id:'sync',label:'Sync Server',icon:Cloud},
  {id:'vaults',label:'Vaults',icon:HardDrive},
  {id:'forwarding',label:'Port Forwarding',icon:ArrowLeftRight},
  {id:'snippets',label:'Snippets',icon:FileCode2},
  {id:'known',label:'Known Hosts',icon:Fingerprint},
  {id:'logs',label:'Logs',icon:Activity}
];
function Section({title,children,defaultOpen=true}:{
  title:string;children:ReactNode;defaultOpen?:boolean
}){
  const [open,setOpen]=useState(defaultOpen);
  return <section className={'editor-card '+(open?'expanded':'')}>
    <button className="card-caption" type="button" onClick={()=>setOpen(x=>!x)}
      aria-expanded={open}><span>{title}</span><ChevronDown size={17}/></button>
    <div className="collapse-grid"><div className="collapse-body">{children}</div></div>
  </section>;
}
function Field({label,children}:{
  label:string;children:ReactNode
}){
  return <label className="field"><span>{label}</span>{children}</label>;
}
function HostInspector({host,folders,credentials,hosts,onClose,onSaved,onConnect,onDeleted}:{
  host:Host;folders:HostFolder[];credentials:Credential[];hosts:Host[];
  onClose:()=>void;onSaved:(host:Host)=>void;
  onConnect:(host:Host,password?:string,keyPassphrase?:string,jumpPassphrase?:string)=>void;
  onDeleted:(id:string)=>void;
}){
  const [draft,setDraft]=useState(host);
  const [password,setPassword]=useState('');
  const [keyPassphrase,setKeyPassphrase]=useState('');
  const [jumpPassphrase,setJumpPassphrase]=useState('');
  const [remember,setRemember]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [newRecord]=useState(!host.Host);
  const set=(key:keyof Host,value:Host[keyof Host])=>
    setDraft(old=>({...old,[key]:value}));
  const save=async(connect=false)=>{
    if(!draft.Host.trim()){setError('Enter an IP address or hostname.');return;}
    if(connect && ['SSH','SFTP'].includes(draft.Protocol) &&
      !draft.User.trim() &&
      !credentials.find(c=>c.Id===draft.CredentialId)?.User.trim()){
      setError('Enter a username or choose a Keychain credential.');return;
    }
    setSaving(true);setError('');
    try{
      const updated=await window.shiro.saveHost({...draft,Name:draft.Name.trim()||draft.Host.trim()});
      if(['SSH','SFTP'].includes(draft.Protocol)&&remember&&password)
        await window.shiro.savePassword(updated.Id,password);
      const withSecret={...updated,
        HasStoredPassword:!!(host.HasStoredPassword||
          (['SSH','SFTP'].includes(draft.Protocol)&&remember&&password))};
      const connectValues=[password,keyPassphrase,jumpPassphrase] as const;
      setPassword('');setKeyPassphrase('');setJumpPassphrase('');
      onSaved(withSecret);
      if(connect)onConnect(withSecret,...connectValues);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setSaving(false);}
  };
  const remove=async()=>{
    if(!confirm('Delete this host? The original WinForms profile will not be modified.'))return;
    try{await window.shiro.removeHost(draft.Id);onDeleted(draft.Id);}
    catch(e){setError(String(e));}
  };
  return <div className="inspector-content">
    <header className="inspector-header"><span>{newRecord?'New Host':'Host Details'}</span>
      <button className="icon-button" onClick={()=>{
        setPassword('');setKeyPassphrase('');setJumpPassphrase('');onClose();
      }} aria-label="Close inspector"><PanelRightClose size={18}/></button>
    </header>
    <div className="inspector-scroll">
      <Section title="Vault">
        <Field label="Group">
          <select value={draft.FolderId} onChange={e=>set('FolderId',e.target.value)}>
            <option value="">Personal</option>
            {folders.map(f=><option key={f.Id} value={f.Id}>{f.Name}</option>)}
          </select>
        </Field>
      </Section>
      <Section title="Address">
        <Field label="Hostname or IP">
          <input value={draft.Host} onChange={e=>set('Host',e.target.value)} autoComplete="off" placeholder="192.168.1.1"/>
        </Field>
        <div className="field-pair">
          <Field label="Protocol"><select value={draft.Protocol}
            onChange={e=>{const p=e.target.value as Host['Protocol'];setDraft(old=>({
              ...old,Protocol:p,Port:p==='RDP'?3389:p==='TELNET'?23:22
            }));}}>
            <option>SSH</option><option>SFTP</option><option>RDP</option><option>TELNET</option>
          </select></Field>
          <Field label="Port"><input type="number" min={1} max={65535} value={draft.Port}
            onChange={e=>set('Port',Number(e.target.value))}/></Field>
        </div>
      </Section>
      <Section title="General">
        <Field label="Platform identity">
          <select aria-label="Platform icon override" value={draft.PlatformOverride||''}
            onChange={e=>set('PlatformOverride',e.target.value)}>
            <option value="">Automatic detection</option>
            {PLATFORM_OPTIONS.map(([key,label])=><option value={key} key={key}>{label}</option>)}
          </select>
        </Field>
        <p className="info-note">Detected: {platformName(draft.DetectedPlatform||'unknown')}
          {draft.DetectedVersion?' · '+draft.DetectedVersion:''}.
          {['SSH','SFTP'].includes(draft.Protocol)?
            ' Automatic detection runs after SSH login.':' Detection is available for SSH hosts.'}
          A manual override changes only the displayed identity and icon.</p>
        <Field label="Label"><input value={draft.Name} onChange={e=>set('Name',e.target.value)} placeholder="Server name"/></Field>
        <Field label="Tags"><input value={draft.Tags} onChange={e=>set('Tags',e.target.value)} placeholder="production, web"/></Field>
        <label className="check-row"><input type="checkbox" checked={draft.Favorite}
          onChange={e=>set('Favorite',e.target.checked)}/> Add to favorites</label>
      </Section>
      {draft.Protocol==='RDP'?<Section title="Remote Desktop">
        <p className="info-note">Opens the Windows Remote Desktop client (mstsc.exe)
          or Remmina on Linux in a separate window. The client handles credentials and certificates.
          ShiroTerm does not pass or store an RDP password.</p>
      </Section>:draft.Protocol==='TELNET'?<Section title="Telnet · unencrypted">
        <p className="info-note">Telnet traffic is unencrypted, including passwords.
          The connection requires confirmation. Type credentials directly into the
          terminal only on trusted networks. Nothing is automatically sent.</p>
      </Section>:<Section title="Credentials">
        <Field label="Keychain entry"><select value={draft.CredentialId}
          onChange={e=>set('CredentialId',e.target.value)}>
          <option value="">None — use host-specific credentials</option>
          {credentials.map(c=><option key={c.Id} value={c.Id}>{c.Name} ({c.User})</option>)}
        </select></Field>
        <Field label="Username"><input value={draft.User} autoComplete="username"
          onChange={e=>set('User',e.target.value)}
          placeholder={credentials.find(c=>c.Id===draft.CredentialId)?.User||'root'}/></Field>
        <Field label="Password"><input type="password" value={password} autoComplete="off"
          onChange={e=>setPassword(e.target.value)} placeholder="Leave blank to use saved password"/></Field>
        <label className="check-row"><input type="checkbox" checked={remember}
          onChange={e=>setRemember(e.target.checked)}/> Save encrypted password on this computer</label>
        <Field label="SSH private key">
          <div className="key-picker"><input readOnly value={draft.KeyFile}
            placeholder="No SSH key selected" title={draft.KeyFile}/>
            <button className="icon-button" title="Choose key" onClick={async()=>set('KeyFile',await window.shiro.selectKey())}><Folder size={17}/></button>
          </div>
        </Field>
        {draft.KeyFile&&<Field label="Private key passphrase (session only)">
          <input type="password" autoComplete="off" value={keyPassphrase}
            onChange={e=>setKeyPassphrase(e.target.value)}
            placeholder="Leave blank for an unencrypted key"/>
        </Field>}
        {draft.KeyFile.startsWith('vault:')&&<p className="info-note">Legacy encrypted keys must be reimported.</p>}
      </Section>}
      <Section title="Advanced" defaultOpen={false}>
        {['SSH','SFTP'].includes(draft.Protocol)&&<>
        <Field label="Jump host (SSH gateway)">
          <select value={draft.JumpHost}
            onChange={e=>set('JumpHost',e.target.value)}>
            <option value="">Direct connection</option>
            {hosts.filter(h=>h.Id!==draft.Id &&
              ['SSH','SFTP'].includes(h.Protocol) && !h.JumpHost)
              .map(h=><option key={h.Id} value={h.Id}>{h.Name||h.Host} — {h.Host}:{h.Port}</option>)}
            {draft.JumpHost && !hosts.some(h=>h.Id===draft.JumpHost &&
              h.Id!==draft.Id && ['SSH','SFTP'].includes(h.Protocol) && !h.JumpHost)
              && <option value={draft.JumpHost} disabled>Unavailable gateway — choose another</option>}
          </select>
        </Field>
        {draft.JumpHost&&hosts.some(h=>h.Id===draft.JumpHost&&!!h.KeyFile)&&
          <Field label="Gateway private key passphrase (session only)">
            <input type="password" autoComplete="off" value={jumpPassphrase}
              onChange={e=>setJumpPassphrase(e.target.value)}
              placeholder="Leave blank if the gateway key is unencrypted"/>
          </Field>}
        <p className="info-note">Traffic passes through the selected saved SSH host.
          Each server's key is verified independently. One hop is supported.</p>
        </>}
        <Field label="Notes"><textarea value={draft.Notes} onChange={e=>set('Notes',e.target.value)} rows={4}/></Field>
        {['SSH','SFTP'].includes(draft.Protocol)&&<label className="check-row">
          <input type="checkbox" checked={draft.AutoReconnect}
          onChange={e=>set('AutoReconnect',e.target.checked)}/>
          Auto reconnect on unexpected disconnect</label>}
        {draft.AutoReconnect&&['SSH','SFTP'].includes(draft.Protocol)&&
          <p className="info-note">Up to 5 attempts (2–30 seconds).
          Only previously established connections using saved credentials or an
          unencrypted SSH key can reconnect automatically. Interactive passwords
          and key passphrases are never retained.</p>}
      </Section>
      {!newRecord&&<button className="delete-host" onClick={remove}><Trash2 size={15}/> Delete host</button>}
    </div>
    <footer className="inspector-footer">
      {error&&<div className="inline-error">{error}</div>}
      <div className="footer-actions">
        <button className="secondary-button" disabled={saving} onClick={()=>save(false)}>Save</button>
        <button className="primary-button" disabled={saving}
          onClick={()=>save(true)}><TerminalSquare size={16}/>
          {draft.Protocol==='RDP'?'Save & Open RDP':'Save & Connect'}</button>
      </div>
    </footer>
  </div>;
}
export default function App(){
  const [profiles,setProfiles]=useState<Profiles>({Sessions:[],Folders:[],Credentials:[],Macros:[],imported:false});
  const [section,setSection]=useState('hosts');
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [windowMaximized,setWindowMaximized]=useState(false);
  const tabStripRef=useRef<HTMLDivElement>(null);
  const [filter,setFilter]=useState('');
  const [folder,setFolder]=useState('');
  const [selectedHost,setSelectedHost]=useState<Host|null>(null);
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [hostMenu,setHostMenu]=useState<{hostId:string;x:number;y:number}|null>(null);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [activeTab,setActiveTab]=useState('hosts');
  const [tabMenu,setTabMenu]=useState<{id:string;x:number;y:number}|null>(null);
  const [draggingTab,setDraggingTab]=useState<string|null>(null);
  const [dropTarget,setDropTarget]=useState<string|null>(null);
  const tabPointerRef=useRef<{id:string;x:number;y:number;dragging:boolean;target:string|null}|null>(null);
  const suppressTabClickRef=useRef<string|null>(null);
  const [notice,setNotice]=useState('');
  const [verify,setVerify]=useState<SshEvent|null>(null);
  const [themePrefs,setThemePrefs]=useState<TerminalThemePreferences>(readThemePreferences);
  const [toolsPanel,setToolsPanel]=useState<'appearance'|'snippets'|null>(null);
  const closeThemePicker=useCallback(()=>setToolsPanel(null),[]);
  const toggleTools=(tab:'appearance'|'snippets')=>
    setToolsPanel(current=>current===tab?null:tab);
  const [authentication,setAuthentication]=useState<{
    host:Host;replaceId?:string;reason?:string
  }|null>(null);
  const [booting,setBooting]=useState(true);
  const promptedAuthRef=useRef<Set<string>>(new Set());
  useEffect(()=>{
    if(!hostMenu)return;
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Element&&
        event.target.closest('.host-context-menu,.host-menu-button'))return;
      setHostMenu(null);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setHostMenu(null);};
    const scroll=()=>setHostMenu(null);
    window.addEventListener('pointerdown',dismiss,true);
    window.addEventListener('keydown',escape,true);
    window.addEventListener('scroll',scroll,true);
    return ()=>{
      window.removeEventListener('pointerdown',dismiss,true);
      window.removeEventListener('keydown',escape,true);
      window.removeEventListener('scroll',scroll,true);
    };
  },[hostMenu]);
  useEffect(()=>{
    if(!tabMenu)return;
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Element&&event.target.closest('.tab-context-menu'))return;
      setTabMenu(null);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setTabMenu(null);};
    const scroll=()=>setTabMenu(null);
    window.addEventListener('pointerdown',dismiss,true);
    window.addEventListener('keydown',escape,true);
    window.addEventListener('scroll',scroll,true);
    return ()=>{
      window.removeEventListener('pointerdown',dismiss,true);
      window.removeEventListener('keydown',escape,true);
      window.removeEventListener('scroll',scroll,true);
    };
  },[tabMenu]);
  const subscribe=useCallback((fn:(event:SshEvent)=>void)=>window.shiro.onSshEvent(fn),[]);
  useEffect(()=>{
    let mounted=true;
    void window.shiro.windowState().then(state=>{
      if(mounted)setWindowMaximized(state.maximized);
    }).catch(()=>{});
    const unsubscribe=window.shiro.onWindowState(state=>setWindowMaximized(state.maximized));
    return ()=>{mounted=false;unsubscribe();};
  },[]);
  useEffect(()=>{
    const rail=tabStripRef.current;
    if(!rail)return;
    const reveal=()=>{
      const selected=rail.querySelector<HTMLElement>('.title-tab.active');
      if(!selected)return;
      const tab=selected.getBoundingClientRect();
      const view=rail.getBoundingClientRect();
      const pad=8;
      const delta=tab.right>view.right-pad?tab.right-view.right+pad:
        tab.left<view.left+pad?tab.left-view.left-pad:0;
      if(Math.abs(delta)>1)rail.scrollLeft+=delta;
    };
    const frame=requestAnimationFrame(()=>{
      rail.querySelector<HTMLElement>('.title-tab.active')?.scrollIntoView({
        block:'nearest',inline:'nearest',behavior:
          window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'
      });
    });
    // Recheck after the flex-basis animation: a widened tab can extend
    // past the viewport after the initial scrollIntoView calculation.
    const settle=window.setTimeout(reveal,355);
    return ()=>{cancelAnimationFrame(frame);window.clearTimeout(settle);};
  },[activeTab,sessions.length]);
  const refreshProfiles=useCallback(async()=>{
    const next=await window.shiro.profiles();
    setProfiles(next);
  },[]);
  useEffect(()=>{
    let active=true;
    const reload=()=>{
      if(!active)return;
      setSelectedHost(null);setInspectorOpen(false);
      setFolder('');
      void refreshProfiles().catch(error=>{if(active)setNotice(String(error));});
    };
    const unsubscribe=window.shiro.onSyncRestored(reload);
    void window.shiro.syncReady().then(state=>{
      if(active&&state.connected)reload();
    }).catch(()=>{});
    return()=>{active=false;unsubscribe();};
  },[refreshProfiles]);
  useEffect(()=>{
    let active=true,running=false,lastConflict='';
    const tick=async()=>{
      if(running||!active)return;
      running=true;
      try{
        const state=await window.shiro.syncAutoTick(readThemePreferences());
        if(!active)return;
        const conflictKey=(state.autoConflicts||[])
          .map(c=>c.section+':'+c.id).join('|');
        if(conflictKey&&conflictKey!==lastConflict)
          setNotice('Profile sync conflict: review entries in Vaults before continuing.');
        lastConflict=conflictKey;
        if(state.changedLocal){
          await refreshProfiles();
          if(state.themePreferences){
            saveThemePreferences(state.themePreferences);
            setThemePrefs(state.themePreferences);
          }
        }
      }catch(error){if(active)setNotice('Auto-sync: '+String(error));}
      finally{running=false;}
    };
    const timer=window.setInterval(()=>void tick(),45000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[refreshProfiles]);
  useEffect(()=>{
    window.shiro.profiles().then(setProfiles).catch(err=>setNotice(String(err))).finally(()=>setBooting(false));
    return window.shiro.onSshEvent(e=>{
      if(e.type==='verify')setVerify(e);
      if(e.type==='platform'&&e.hostId&&e.platform){
        setProfiles(old=>({...old,Sessions:old.Sessions.map(h=>h.Id===e.hostId?
          {...h,DetectedPlatform:e.platform,DetectedRole:e.role||'server',
            DetectedVersion:e.version||'',DetectedAt:new Date().toISOString()}:h)}));
      }
      if(e.type==='error'){
        setNotice(e.message||'SSH connection error');
        setSessions(old=>old.map(s=>s.id===e.sessionId?{...s,error:e.message}:s));
      }
      if(e.type==='status'&&e.status)
        setSessions(old=>old.map(s=>s.id===e.sessionId?{...s,status:e.status!,
          retryAttempt:e.attempt,retryMax:e.maxAttempts,retryDelayMs:e.delayMs}:s));
    });
  },[]);
  // A refused password or an unreadable private key should open credentials
  // again, without forcing the user to find the host's Advanced settings.
  useEffect(()=>{
    if(authentication||verify)return;
    const failure=sessions.find(s=>s.error&&
      /all configured authentication methods failed|authentication failed|no ssh authentication configured|private key|passphrase|ENOENT/i.test(s.error)&&
      !promptedAuthRef.current.has(s.id));
    if(!failure)return;
    const host=profiles.Sessions.find(h=>h.Id===failure.hostId);
    if(!host)return;
    promptedAuthRef.current.add(failure.id);
    setAuthentication({host,replaceId:failure.id,reason:failure.error});
    setNotice('');
  },[sessions,profiles,authentication,verify]);
  const filtered=useMemo(()=>profiles.Sessions.filter(h=>{
    if(folder && h.FolderId!==folder)return false;
    const term=filter.trim().toLocaleLowerCase();
    return !term || [h.Host,h.Name,h.User,h.Tags].some(x=>x.toLocaleLowerCase().includes(term));
  }),[profiles,filter,folder]);
  const beginNew=()=>{setSection('hosts');setActiveTab('hosts');setSelectedHost(emptyHost());setInspectorOpen(true);};
  const selectHost=(host:Host)=>{
    setHostMenu(null);
    setSelectedHost({...host});setInspectorOpen(true);
  };
  const highlightHost=(host:Host)=>{
    setHostMenu(null);
    setSelectedHost({...host});
    setInspectorOpen(false);
  };
  const showHostMenu=(host:Host,x:number,y:number)=>{
    setSelectedHost({...host});
    setInspectorOpen(false);
    setHostMenu({hostId:host.Id,
      x:Math.max(8,Math.min(x,window.innerWidth-222)),
      y:Math.max(8,Math.min(y,window.innerHeight-252))});
  };
  const editHostFromMenu=(host:Host)=>{setHostMenu(null);selectHost(host);};
  const toggleFavorite=async(host:Host)=>{
    setHostMenu(null);
    try{
      const result=await window.shiro.saveHost({...host,Favorite:!host.Favorite});
      setProfiles(old=>({...old,Sessions:old.Sessions.map(h=>h.Id===result.Id?{...result,
        HasStoredPassword:host.HasStoredPassword}:h)}));
    }catch(error){setNotice(error instanceof Error?error.message:String(error));}
  };
  const deleteFromMenu=async(host:Host)=>{
    setHostMenu(null);
    if(!window.confirm('Delete '+(host.Name||host.Host)+'? This does not touch the legacy WinForms profile.'))return;
    try{await window.shiro.removeHost(host.Id);onDeleted(host.Id);}
    catch(error){setNotice(error instanceof Error?error.message:String(error));}
  };
  const needsPassword=(host:Host)=>{
    const shared=profiles.Credentials.find(c=>c.Id===host.CredentialId);
    return !host.KeyFile&&!host.HasStoredPassword&&!shared?.HasStoredPassword;
  };
  const openAuthentication=(host:Host,replaceId?:string,reason?:string)=>{
    setAuthentication({host,replaceId,reason});
    setNotice('');
  };
  const connect=async(host:Host,password='',keyPassphrase='',jumpPassphrase='',
    replaceId?:string)=>{
    if(host.Protocol==='RDP'){
      setHostMenu(null);setInspectorOpen(false);setNotice('');
      try{
        const opened=await window.shiro.openRdp(host.Id);
        setNotice((opened.client||'Windows Remote Desktop')+' client started for '+opened.address+
          '. The external client manages the connection and will request sign-in when needed.');
      }catch(e){setNotice(e instanceof Error?e.message:String(e));}
      return;
    }
    if(host.Protocol==='TELNET'){
      setHostMenu(null);
      if(!window.confirm('Telnet is unencrypted: commands and passwords can be read on the network. Connect anyway?'))return;
      const id=crypto.randomUUID();
      const next:Session={id,hostId:host.Id,name:host.Name||host.Host,
        protocol:'TELNET',status:'connecting'};
      if(replaceId){
        window.shiro.forgetTerminal(replaceId);
        setSessions(old=>old.map(s=>s.id===replaceId?next:s));
      }else setSessions(old=>[...old,next]);
      setActiveTab(id);setInspectorOpen(false);setNotice('');
      try{await window.shiro.connectTelnet({id:host.Id,sessionId:id});}
      catch(e){
        const message=e instanceof Error?e.message:String(e);
        setSessions(old=>old.map(s=>s.id===id?{...s,status:'error',error:message}:s));
        setNotice(message);
      }
      return;
    }
    if(!password&&!keyPassphrase&&!jumpPassphrase&&
      (needsPassword(host)||!(host.User||profiles.Credentials.find(c=>c.Id===host.CredentialId)?.User))){
      openAuthentication(host,replaceId);
      return;
    }
    const id=crypto.randomUUID();
    const next={id,hostId:host.Id,name:host.Name||host.Host,
      protocol:(host.Protocol==='SFTP'?'SFTP':'SSH') as Session['protocol'],
      status:'connecting'};
    if(replaceId){
      window.shiro.forgetTerminal(replaceId);
      setSessions(old=>old.map(s=>s.id===replaceId?next:s));
    }else setSessions(old=>[...old,next]);
    setActiveTab(host.Protocol==='SFTP'?'sftp:'+id:id);setInspectorOpen(false);setNotice('');
    try{
      await window.shiro.connect({id:host.Id,password,keyPassphrase,jumpPassphrase,sessionId:id});
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      setSessions(old=>old.map(s=>s.id===id?{...s,status:'error',error:message}:s));
      setNotice(message);
    }
  };
  const connectWithCredentials=async(values:LoginValues)=>{
    const entry=authentication;
    if(!entry)return;
    let host=entry.host;
    if(values.username!==host.User||values.keyFile!==host.KeyFile){
      host={...await window.shiro.saveHost({
        ...host,User:values.username,KeyFile:values.keyFile
      }),HasStoredPassword:host.HasStoredPassword};
    }
    if(values.remember&&values.password){
      await window.shiro.savePassword(host.Id,values.password);
      host={...host,HasStoredPassword:true};
    }
    setProfiles(old=>({...old,Sessions:old.Sessions.map(h=>h.Id===host.Id?host:h)}));
    setAuthentication(null);
    // Once encrypted storage succeeds, let the native SSH layer read it back:
    // this enables safe reconnect without keeping an interactive secret.
    const transientPassword=values.remember&&values.password?'':values.password;
    await connect(host,transientPassword,values.keyPassphrase,
      values.jumpPassphrase,entry.replaceId);
  };
  const reconnect=async(previous:Session)=>{
    const host=profiles.Sessions.find(h=>h.Id===previous.hostId);
    if(!host){setNotice('Host profile was removed.');return;}
    await connect(host,'','','',previous.id);
  };
  const onSaved=(host:Host)=>{
    setProfiles(old=>({...old,Sessions:[...old.Sessions.filter(x=>x.Id!==host.Id),host]}));
    setSelectedHost(host);
    setInspectorOpen(false);
  };
  const onDeleted=(id:string)=>{
    setProfiles(old=>({...old,Sessions:old.Sessions.filter(h=>h.Id!==id)}));
    setInspectorOpen(false);setSelectedHost(null);
  };
  const closeTab=(id:string)=>{
    window.shiro.disconnect(id).catch(()=>{});
    window.shiro.forgetTerminal(id);
    setSessions(old=>old.filter(s=>s.id!==id));
    if(activeTab===id || activeTab==='sftp:'+id)setActiveTab('hosts');
    setTabMenu(null);
  };
  const showTabMenu=(id:string,x:number,y:number)=>{
    setTabMenu({id,x:Math.max(8,Math.min(x,window.innerWidth-222)),
      y:Math.max(8,Math.min(y,window.innerHeight-235))});
  };
  const closeTabGroup=(id:string,scope:CloseScope)=>{
    const ids=sessionIdsToClose(sessions,id,scope);
    setTabMenu(null);
    if(!ids.length)return;
    if(ids.length>1&&!window.confirm('Close '+ids.length+' open sessions? Their SSH/Telnet connections will be disconnected.'))return;
    if(ids.length===1){closeTab(ids[0]);return;}
    for(const itemId of ids){
      void window.shiro.disconnect(itemId).catch(()=>{});
      window.shiro.forgetTerminal(itemId);
    }
    setSessions(old=>old.filter(s=>!ids.includes(s.id)));
    if(ids.some(itemId=>activeTab===itemId||activeTab==='sftp:'+itemId)){
      const kept=sessions.find(s=>s.id===id);
      setActiveTab(kept?(kept.protocol==='SFTP'?'sftp:'+kept.id:kept.id):'hosts');
    }
  };
  useEffect(()=>{
    const hotkeys=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||!event.ctrlKey||event.metaKey||event.altKey)return;
      if(authentication||verify||document.querySelector(
        '.credential-modal,.modal-overlay,.sftp-dialog-backdrop'))return;
      if(event.key==='Tab'){
        event.preventDefault();
        setTabMenu(null);
        setActiveTab(nextTabId(sessions,activeTab,event.shiftKey?-1:1));
        return;
      }
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('input,textarea,select,[contenteditable="true"],.xterm'))return;
      if(event.key.toLowerCase()==='w'&&!event.shiftKey){
        if(activeTab==='hosts')return;
        event.preventDefault();
        const id=activeTab.startsWith('sftp:')?activeTab.slice(5):activeTab;
        if(activeTab.startsWith('sftp:')&&sessions.some(s=>s.id===id&&s.protocol==='SSH')){
          setActiveTab(id);return;
        }
        closeTab(id);
      }else if(/^[1-9]$/.test(event.key)&&!event.shiftKey){
        const idx=Number(event.key)-1;
        const ids=['hosts',...sessions.map(s=>s.protocol==='SFTP'?'sftp:'+s.id:s.id)];
        if(idx<ids.length){event.preventDefault();setActiveTab(ids[idx]);}
      }
    };
    window.addEventListener('keydown',hotkeys,true);
    return ()=>window.removeEventListener('keydown',hotkeys,true);
  },[sessions,activeTab,authentication,verify]);
  const sftpFor=activeTab.startsWith('sftp:')?activeTab.slice(5):activeTab;
  const session= sessions.find(s=>s.id===sftpFor);
  const terminalThemeId=(
    session?(themePrefs.byHost[session.hostId]||themePrefs.defaultId):themePrefs.mainId
  ) as TerminalThemeId;
  const terminalTheme=TERMINAL_THEME_BY_ID[terminalThemeId];
  const chooseTheme=(id:TerminalThemeId)=>{
    setThemePrefs(old=>{
      const next=session?{...old,byHost:{...old.byHost,[session.hostId]:id}}:
        {...old,mainId:id};
      saveThemePreferences(next);
      return next;
    });
  };
  const makeThemeDefault=()=>{
    setThemePrefs(old=>{
      const next=session?{...old,defaultId:terminalThemeId}:
        {...old,mainId:terminalThemeId};
      saveThemePreferences(next);
      return next;
    });
  };
  useEffect(()=>{setToolsPanel(null);},[activeTab]);
  const sendSnippet=async(snippet:{Command:string},run:boolean)=>{
    if(!session||session.protocol!=='SSH'||session.status!=='shell-ready')
      throw new Error('A connected SSH terminal is required.');
    await window.shiro.write(session.id,snippet.Command+(run?'\n':''));
  };
  const openSftp=()=>{
    if(session&&session.protocol==='SSH'){setActiveTab('sftp:'+session.id);}
    else setNotice('SFTP requires an SSH connection. RDP and Telnet do not support SFTP.');
  };
  return <div className="app" data-app-theme={terminalThemeId} style={appPalette(terminalThemeId)}>
    <header className="titlebar">
      <div className="brand"><button className="icon-button sidebar-toggle"
        aria-label="Toggle sidebar" onClick={()=>setSidebarCollapsed(x=>!x)}>
        <Menu size={18}/></button>
        <span className="brand-mark"><TerminalSquare size={17}/></span>
        <strong>ShiroTerm</strong><span className="build-label">NEXT</span></div>
      <div ref={tabStripRef} className="title-tabs" role="tablist" aria-label="Open sessions"
        onWheel={e=>{
          const rail=e.currentTarget;
          if(rail.scrollWidth>rail.clientWidth&&Math.abs(e.deltaY)>Math.abs(e.deltaX))
            rail.scrollLeft+=e.deltaY;
        }}>
        <button className={'title-tab title-tab-home '+(activeTab==='hosts'?'active':'')}
          role="tab" aria-label="Vaults" aria-selected={activeTab==='hosts'}
          onClick={()=>setActiveTab('hosts')}><Server size={15}/><span className="tab-label">Vaults</span></button>
        {sessions.map(s=><button key={s.id} data-session-tab={s.id}
          className={'title-tab '+(activeTab===s.id||(s.protocol==='SFTP'&&activeTab==='sftp:'+s.id)?'active ':'')+
            (draggingTab===s.id?'dragging ':'')+(dropTarget===s.id?'drop-target':'')}
          role="tab" aria-label={s.name}
          title={s.name+' — drag to reorder; middle-click to close'}
          aria-selected={activeTab===s.id||(s.protocol==='SFTP'&&activeTab==='sftp:'+s.id)}
          onClick={()=>{
            if(suppressTabClickRef.current===s.id){suppressTabClickRef.current=null;return;}
            setTabMenu(null);setActiveTab(s.protocol==='SFTP'?'sftp:'+s.id:s.id);
          }}
          onMouseUp={e=>{
            if(e.button===1){e.preventDefault();e.stopPropagation();closeTab(s.id);}
          }}
          onAuxClick={e=>{
            if(e.button===1){e.preventDefault();e.stopPropagation();}
          }}
          onContextMenu={e=>{e.preventDefault();showTabMenu(s.id,e.clientX,e.clientY);}}
          onKeyDown={e=>{
            if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
              e.preventDefault();
              const rect=e.currentTarget.getBoundingClientRect();
              showTabMenu(s.id,rect.left+20,rect.bottom+5);
            }
          }}
          onPointerDown={e=>{
            if(e.button!==0||e.target instanceof Element&&e.target.closest('.tab-x'))return;
            tabPointerRef.current={id:s.id,x:e.clientX,y:e.clientY,dragging:false,target:null};
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e=>{
            const state=tabPointerRef.current;
            if(!state||state.id!==s.id)return;
            if(!state.dragging&&Math.hypot(e.clientX-state.x,e.clientY-state.y)<8)return;
            if(!state.dragging){state.dragging=true;setDraggingTab(s.id);}
            const under=document.elementFromPoint(e.clientX,e.clientY);
            const target=under?.closest<HTMLElement>('[data-session-tab]')?.dataset.sessionTab||null;
            if(target!==state.target){
              state.target=target;
              setDropTarget(target&&target!==s.id?target:null);
            }
          }}
          onPointerUp={e=>{
            const state=tabPointerRef.current;
            if(!state||state.id!==s.id)return;
            tabPointerRef.current=null;
            if(e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if(state.dragging){
              suppressTabClickRef.current=s.id;
              window.setTimeout(()=>{
                if(suppressTabClickRef.current===s.id)suppressTabClickRef.current=null;
              },0);
              if(state.target&&state.target!==s.id)
                setSessions(old=>moveSession(old,s.id,state.target!));
              setDraggingTab(null);setDropTarget(null);
            }
          }}
          onPointerCancel={e=>{
            if(tabPointerRef.current?.id!==s.id)return;
            tabPointerRef.current=null;
            if(e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            setDraggingTab(null);setDropTarget(null);
          }}>
          {s.protocol==='SFTP'?<HardDrive size={14}/>:s.protocol==='TELNET'?
            <TerminalSquare size={15}/>:<PlatformIcon size={16}
            platform={platformFor(profiles.Sessions.find(h=>h.Id===s.hostId)||
              {DetectedPlatform:'unknown'} as Host)}/>}<span className="tab-label">{s.name}</span>
          <span className="tab-x" role="button" tabIndex={0} aria-label={'Close '+s.name}
            onKeyDown={e=>{
              if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();closeTab(s.id);}
            }}
            onClick={e=>{e.stopPropagation();closeTab(s.id);}}><X size={13}/></span></button>)}
        {activeTab.startsWith('sftp:')&&session&&session.protocol==='SSH'&&
          <button className="title-tab active" role="tab" aria-selected={true}
            aria-label="SFTP" onClick={()=>setActiveTab(session.id)}>
          <HardDrive size={14}/><span className="tab-label">SFTP</span>
          <span className="tab-x" role="button" tabIndex={0} aria-label="Close SFTP"
            onKeyDown={e=>{
              if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setActiveTab(session.id);}
            }}
            onClick={e=>{e.stopPropagation();setActiveTab(session.id);}}><X size={13}/></span></button>}
      </div>
      <div className="session-drawer-triggers" aria-label="Terminal sidebar controls">
        <button className={'session-drawer-trigger '+(toolsPanel==='snippets'?'active':'')}
          title="Snippets" aria-label="Open snippets sidebar"
          aria-controls="shiro-session-drawer" aria-expanded={toolsPanel==='snippets'}
          onClick={()=>toggleTools('snippets')}><Braces size={17}/></button>
        <button className={'session-drawer-trigger '+(toolsPanel==='appearance'?'active':'')}
          title="Themes" aria-label="Open themes sidebar"
          aria-controls="shiro-session-drawer" aria-expanded={toolsPanel==='appearance'}
          onClick={()=>toggleTools('appearance')}><Palette size={17}/></button>
      </div>
      <div className="window-controls">
        <button aria-label="Minimize" onClick={()=>window.shiro.windowAction('minimize')}><Minus size={15}/></button>
        <button aria-label={windowMaximized?'Restore window':'Maximize'}
          title={windowMaximized?'Restore window':'Maximize'}
          onClick={()=>window.shiro.windowAction('toggleMaximize')}>
          {windowMaximized?<Copy size={13}/>:<Square size={12}/>}
        </button>
        <button aria-label="Close" className="close-window" onClick={()=>window.shiro.windowAction('close')}><X size={17}/></button>
      </div>
    </header>
    <div className="application-body">
      <nav className={'sidebar '+(sidebarCollapsed?'is-collapsed':'')}>
        <div className="sidebar-group">PERSONAL <ChevronDown size={13}/></div>
        {navigation.map(item=>{
          const Icon=item.icon;
          return <button key={item.id} className={'nav-link '+(section===item.id?'active':'')}
            onClick={()=>{setSection(item.id);setActiveTab('hosts');setInspectorOpen(false);}}>
            <Icon size={17}/><span>{item.label}</span></button>;
        })}
        <div className="sidebar-bottom"><span className="status-dot"/><span>Local workspace</span>
          <Settings2 size={15}/></div>
      </nav>
      <div className="workspace">
        <><div className={'host-page '+(inspectorOpen&&section==='hosts'?'with-inspector':'')}
          style={{display:activeTab==='hosts'?'flex':'none'}}>
          {section==='hosts'?<>
            <div className="page-toolbar"><div className="search-field"><Search size={18}/>
              <input aria-label="Search hosts" placeholder="Find a host or ssh user@hostname…"
                value={filter} onChange={e=>setFilter(e.target.value)}/></div>
              <button className="primary-button new-host" onClick={beginNew}><Plus size={17}/> New host</button>
            </div>
            <div className="list-toolbar"><div className="section-caption"><Server size={16}/> Hosts
              <span className="count">{filtered.length}</span></div>
              <div className="layout-actions">
                <select className="folder-select" aria-label="Filter by group" value={folder} onChange={e=>setFolder(e.target.value)}>
                  <option value="">All groups</option>{profiles.Folders.map(f=><option key={f.Id} value={f.Id}>{f.Name}</option>)}
                </select>
                <button className="icon-button" title="New host" onClick={beginNew}><Plus size={18}/></button>
              </div>
            </div>
            <div className="hosts-scroll">
              {booting?<div className="empty-panel">Loading profiles…</div>
              :filtered.length===0?<div className="empty-panel">
                <Server size={35}/><h2>{profiles.Sessions.length?'No matching hosts':'Your hosts, organized'}</h2>
                <p>{profiles.Sessions.length?'Try another search or group.':'Add a host to start connecting to your servers.'}</p>
                <button className="primary-button" onClick={beginNew}><Plus size={16}/> Add host</button>
              </div>:<div className="host-grid">{filtered.map(host=><div
                key={host.Id} className={'host-card '+(selectedHost?.Id===host.Id?'selected':'')}
                role="button" tabIndex={0} aria-label={'Host '+(host.Name||host.Host)}
                onClick={()=>highlightHost(host)}
                onKeyDown={e=>{
                  if(e.target!==e.currentTarget)return;
                  if(e.key==='Enter'){e.preventDefault();void connect(host);}
                  if(e.key==='F2'){e.preventDefault();selectHost(host);}
                  if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
                    e.preventDefault();const r=e.currentTarget.getBoundingClientRect();
                    showHostMenu(host,r.right-15,r.top+40);
                  }
                }}
                onContextMenu={e=>{e.preventDefault();showHostMenu(host,e.clientX,e.clientY);}}
                onDoubleClick={()=>{setHostMenu(null);void connect(host);}}>
                <div className="host-symbol"><PlatformIcon platform={platformFor(host)} size={25}/></div>
                <div className="host-meta"><strong>{host.Name||host.Host}</strong>
                  <span>{platformFor(host)==='unknown'?host.Protocol.toLowerCase():
                    platformName(platformFor(host))} · {host.User||host.Host}</span></div>
                {host.Favorite&&<Star size={15} fill="currentColor" className="favorite-icon"/>}
                <button className="card-edit" title="Edit host" aria-label={'Edit '+host.Name}
                  onDoubleClick={e=>e.stopPropagation()}
                  onClick={e=>{e.stopPropagation();selectHost(host);}}><Pencil size={15}/></button>
                <button className="host-menu-button" title="Host actions" aria-label={'Actions '+host.Name}
                  onDoubleClick={e=>e.stopPropagation()}
                  onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();
                    showHostMenu(host,r.right,r.bottom+6);}}><MoreVertical size={17}/></button>
              </div>)}</div>}
            </div>
          </>:section==='sync'?<Suspense fallback={<div className="hint-row">Loading Sync Server…</div>}>
            <ServerConnection/>
          </Suspense>:section==='vaults'?<Suspense fallback={<div className="hint-row">Loading Vaults…</div>}>
            <Sync onDownload={async prefs=>{await refreshProfiles();if(prefs){saveThemePreferences(prefs);setThemePrefs(prefs);}}}/>
          </Suspense>:section==='keychain'?<Suspense fallback={<div className="hint-row">Loading keychain…</div>}>
            <Keychain items={profiles.Credentials||[]} onChange={refreshProfiles}/>
          </Suspense>:section==='forwarding'?<Suspense fallback={<div className="hint-row">Loading forwarding…</div>}>
            <Forwarding sessions={sessions}/>
          </Suspense>:section==='snippets'?<Suspense fallback={<div className="hint-row">Loading snippets…</div>}>
            <Snippets items={profiles.Macros||[]}
              onChange={Macros=>setProfiles(old=>({...old,Macros}))}/>
          </Suspense>:section==='known'?<Suspense fallback={<div className="hint-row">Loading known hosts…</div>}>
            <KnownHosts/>
          </Suspense>:section==='logs'?<Suspense fallback={<div className="hint-row">Loading activity…</div>}>
            <Logs/>
          </Suspense>:<div className="placeholder-page"><div className="placeholder-icon"><Settings2 size={27}/></div>
            <h2>{navigation.find(n=>n.id===section)?.label}</h2>
            <p>This feature remains available in classic ShiroTerm while the new engine is being migrated.</p>
            <button className="secondary-button" onClick={()=>setSection('hosts')}><Server size={16}/> Back to Hosts</button>
          </div>}
          <aside className={'host-inspector '+(inspectorOpen&&section==='hosts'?'open':'')}
            aria-hidden={!(inspectorOpen&&section==='hosts')}
            inert={!(inspectorOpen&&section==='hosts')}>
            {selectedHost&&section==='hosts'&&<HostInspector
              key={selectedHost.Id} host={selectedHost} folders={profiles.Folders}
              credentials={profiles.Credentials||[]} hosts={profiles.Sessions}
              onClose={()=>setInspectorOpen(false)} onSaved={onSaved}
              onConnect={connect} onDeleted={onDeleted}/>}
          </aside>
        </div><div className="active-workspace" style={{display:activeTab==='hosts'?'none':'flex'}}>
          <div className="session-bar"><span className="connection-state">
            {['connected','shell-ready','sftp-ready'].includes(session?.status||'')?
              <Wifi size={15}/>:<CloudOff size={15}/>}
            {session?.name||'Terminal'}
            {session?.protocol==='TELNET'&&<span className="protocol-warning"
              title="Telnet traffic is not encrypted">Unencrypted</span>}
            <em>
              {statusLabel[session?.status||'']||'Disconnected'}
              {session?.retryAttempt&&['reconnect-wait','reconnect-attempt'].includes(session.status)?
                ' ('+session.retryAttempt+'/'+(session.retryMax||5)+
                (session.status==='reconnect-wait'?' · '+Math.ceil((session.retryDelayMs||0)/1000)+'s':'')+')':''}
            </em></span>
            <div className="session-actions">
              {session&&session.error&&
                /authenticat|password|credential|private key|passphrase/i.test(session.error)&&
                <button className="secondary-button" onClick={()=>{
                  const h=profiles.Sessions.find(item=>item.Id===session.hostId);
                  if(h)openAuthentication(h,session.id,session.error);
                }}><KeyRound size={16}/> Credentials</button>}
              {session&&['closed','error','reconnect-exhausted','reconnect-stopped'].includes(session.status)&&
                <button className="secondary-button" onClick={()=>void reconnect(session)}>
                  <RefreshCcw size={16}/> Reconnect</button>}
              {session&&['reconnect-wait','reconnect-attempt'].includes(session.status)&&
                <button className="secondary-button" onClick={()=>void window.shiro.cancelReconnect(session.id)}>
                  <X size={16}/> Cancel retry</button>}
              {session?.protocol==='SSH'&&
                <button className="secondary-button" onClick={openSftp}><HardDrive size={16}/> SFTP</button>}
              <button className="icon-button" onClick={()=>setActiveTab('hosts')} aria-label="Back to hosts"><Server size={16}/></button>
            </div>
          </div>
          <div className={'terminal-stack '+(activeTab.startsWith('sftp:')?'is-hidden':'')}
            style={{background:terminalTheme.theme.background}}>
            {sessions.filter(s=>s.protocol==='SSH'||s.protocol==='TELNET').map(s=><Suspense key={s.id} fallback={<div className="hint-row">Loading terminal…</div>}>
              <Terminal sessionId={s.id} active={activeTab===s.id}
                themeId={themePrefs.byHost[s.hostId]||themePrefs.defaultId}
                onEvent={subscribe}/>
            </Suspense>)}
          </div>
          {activeTab.startsWith('sftp:')&&session&&<Suspense fallback={<div className="hint-row">Loading SFTP…</div>}>
            <Sftp key={session.id} sessionId={session.id}/>
          </Suspense>}
        </div></>
      </div>
      <Suspense fallback={null}>
        <SessionTools open={toolsPanel!==null} tab={toolsPanel||'appearance'}
          onTabChange={setToolsPanel} themeId={terminalThemeId}
          defaultId={session?themePrefs.defaultId:themePrefs.mainId}
          home={!session} snippets={profiles.Macros}
          onSelect={chooseTheme} onMakeDefault={makeThemeDefault}
          onSnippet={sendSnippet} onClose={closeThemePicker}/>
      </Suspense>
    </div>
    {tabMenu&&sessions.some(s=>s.id===tabMenu.id)&&(()=>{
      const tab=sessions.find(s=>s.id===tabMenu.id)!;
      const remainingRight=sessionIdsToClose(sessions,tab.id,'right').length;
      return <div className="host-context-menu tab-context-menu" role="menu"
        aria-label={'Actions for tab '+tab.name}
        style={{left:tabMenu.x,top:tabMenu.y}}
        onMouseDown={e=>e.preventDefault()}>
        <div className="host-context-title">{tab.name}
          <span>Ctrl+Tab · Switch tabs</span></div>
        <button role="menuitem" onClick={()=>{
          setTabMenu(null);setActiveTab(tab.protocol==='SFTP'?'sftp:'+tab.id:tab.id);
        }}><TerminalSquare size={16}/> Switch to tab</button>
        <button role="menuitem" onClick={()=>closeTabGroup(tab.id,'one')}>
          <X size={16}/> Close tab <span className="host-menu-shortcut">Ctrl+W</span></button>
        <div className="host-menu-separator"/>
        <button role="menuitem" disabled={sessions.length===1}
          onClick={()=>closeTabGroup(tab.id,'others')}>
          <Copy size={16}/> Close other tabs</button>
        <button role="menuitem" disabled={remainingRight===0}
          onClick={()=>closeTabGroup(tab.id,'right')}>
          <ChevronRight size={16}/> Close tabs to the right</button>
      </div>;
    })()}
    {hostMenu&&profiles.Sessions.some(h=>h.Id===hostMenu.hostId)&&(()=>{
      const host=profiles.Sessions.find(h=>h.Id===hostMenu.hostId)!;
      return <div className="host-context-menu" role="menu" aria-label={'Host actions for '+host.Name}
        style={{left:hostMenu.x,top:hostMenu.y}} onMouseDown={e=>e.preventDefault()}>
        <div className="host-context-title">{host.Name||host.Host}<span>{host.Host}:{host.Port}</span></div>
        <button role="menuitem" onClick={()=>{setHostMenu(null);void connect(host);}}>
          <PlugZap size={16}/> Connect <span className="host-menu-shortcut">Enter</span></button>
        <button role="menuitem" onClick={()=>editHostFromMenu(host)}>
          <Pencil size={16}/> Edit host <span className="host-menu-shortcut">F2</span></button>
        <button role="menuitem" onClick={()=>void toggleFavorite(host)}>
          <Star size={16}/> {host.Favorite?'Remove favorite':'Add to favorites'}</button>
        <button role="menuitem" onClick={()=>{
          setHostMenu(null);void window.shiro.copyText(host.Host)
            .catch(e=>setNotice(String(e)));
        }}><Copy size={16}/> Copy address</button>
        <div className="host-menu-separator"/>
        <button role="menuitem" className="host-menu-delete"
          onClick={()=>void deleteFromMenu(host)}><Trash2 size={16}/> Delete host</button>
      </div>;
    })()}
    {notice&&<div className="toast" role="status"><ShieldAlert size={17}/><span>{notice}</span>
      <button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
    {authentication&&<Suspense fallback={null}>
      <LoginPrompt key={authentication.host.Id+':'+(authentication.replaceId||'new')}
        host={authentication.host} reason={authentication.reason}
        hasSavedPassword={!!authentication.host.HasStoredPassword||
          !!profiles.Credentials.find(c=>c.Id===authentication.host.CredentialId)?.HasStoredPassword}
        username={authentication.host.User||profiles.Credentials.find(c=>c.Id===authentication.host.CredentialId)?.User||''}
        gatewayKey={!!profiles.Sessions.find(h=>h.Id===authentication.host.JumpHost)?.KeyFile}
        onCancel={()=>setAuthentication(null)}
        onSubmit={connectWithCredentials}/>
    </Suspense>}
    {verify&&<div className="modal-overlay"><div className="trust-modal">
      <div className="trust-icon"><ShieldAlert size={28}/></div>
      <h2>{verify.changed?'SSH host key has changed':'Verify SSH host identity'}</h2>
      <p>{verify.changed?'Warning: the server key differs from the previously trusted key.':
        'Confirm the key fingerprint through a trusted channel before connecting.'}</p>
      <div className="fingerprint"><strong>{verify.host}:{verify.port}</strong><code>{verify.fingerprint}</code></div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={()=>{window.shiro.trust(verify.requestId!,false);setVerify(null);}}>Reject</button>
        <button className="primary-button" onClick={()=>{window.shiro.trust(verify.requestId!,true);setVerify(null);}}><Check size={16}/> Trust this key</button>
      </div>
    </div></div>}
  </div>;
}
