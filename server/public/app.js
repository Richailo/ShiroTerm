'use strict';
const $=id=>document.getElementById(id);
let session={authenticated:false};
const pendingCode=new URL(location.href).searchParams.get('code')||'';
if(location.search)history.replaceState(null,'','/console');
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=!message;}
async function api(route,body){
  const response=await fetch(route,{method:body===undefined?'GET':'POST',credentials:'same-origin',
    headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':session.csrf||''},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
  const data=await response.json();
  if(!response.ok){
    if(response.status===401){session={authenticated:false};renderSession();}
    throw Error(data.error||'Request failed');
  }
  return data;
}
async function action(control,task){
  control.disabled=true;notice('');
  try{await task();}catch(error){notice(error.message||'The server could not complete this request.',true);}
  finally{control.disabled=false;}
}
function row(title,detail,label,task){
  const root=document.createElement('div');root.className='list-row';
  const content=document.createElement('div'),name=document.createElement('strong'),note=document.createElement('small');
  name.textContent=title;note.textContent=detail;content.append(name,note);root.append(content);
  if(label){const button=document.createElement('button');button.textContent=label;button.className='quiet danger';
    button.addEventListener('click',()=>void action(button,task));root.append(button);}
  return root;
}
function empty(target,message){const p=document.createElement('p');p.className='empty';p.textContent=message;target.append(p);}
function renderSession(){
  $('login-panel').hidden=session.authenticated;$('dashboard').hidden=!session.authenticated;
  $('logout').hidden=!session.authenticated;$('identity').textContent=session.user||'';
  $('admin-panel').hidden=!session.admin;
  if(!session.authenticated){
    for(const id of ['devices','users','vaults'])$(id).replaceChildren();
    for(const input of document.querySelectorAll('input[type=password]'))input.value='';
  }
}
async function refreshDevices(){
  const data=await api('/console/api/devices');$('devices').replaceChildren();
  for(const device of data.devices)$('devices').append(row(device.label,
    'Authorized '+new Date(device.created*1000).toLocaleDateString()+' · expires '+new Date(device.expires*1000).toLocaleDateString(),
    'Revoke',async()=>{
      if(!confirm('Revoke access for '+device.label+'?'))return;
      await api('/console/api/device/revoke',{id:device.id});await refreshDevices();notice('Device access revoked.');
    }));
  if(!data.devices.length)empty($('devices'),'No desktops have been authorized yet.');
}
async function refreshVaults(){
  const data=await api('/v1/profile-vaults');$('vaults').replaceChildren();
  for(const vault of data.vaults)$('vaults').append(row(vault.name,
    vault.revision?'Version '+vault.revision+' · '+new Date(vault.updated*1000).toLocaleString():'No backup uploaded yet'));
}
async function refreshVault(){
  const data=await api('/console/api/vault/status');
  $('vault-state').textContent=!data.configured?'Vaultwarden is optional and has not been enabled by this server’s administrator.':
    data.connected?'Connected as '+data.account+' · '+data.itemCount+' logins · locks in '+Math.ceil(data.expiresInSeconds/60)+' minutes':
      'Connect your Vaultwarden account to use its saved SSH credentials in ShiroTerm.';
  $('vault-form').hidden=!data.configured||data.connected;$('lock-vault').hidden=!data.connected;
}
async function refreshUsers(){
  if(!session.admin)return;
  const data=await api('/console/api/users');$('users').replaceChildren();
  for(const user of data.users)$('users').append(row(user.username,
    (user.admin?'Administrator':'User')+(user.enabled?'':' · disabled'),
    user.username!==session.user?(user.enabled?'Disable':'Enable'):'',async()=>{
      if(user.enabled&&!confirm('Disable '+user.username+' and revoke their connected devices?'))return;
      await api('/console/api/user/'+(user.enabled?'disable':'enable'),{username:user.username});
      await refreshUsers();notice(user.enabled?'Account disabled.':'Account enabled.');
    }));
}
async function checkCode(){
  $('approve').disabled=true;
  const code=$('pair-code').value.trim().toUpperCase();
  const data=await api('/console/api/pairing?code='+encodeURIComponent(code));
  $('pair-description').textContent=data.approved?'This code has already been approved.':
    'Authorize “'+data.label+'”? Check that this code matches the one in your desktop app.';
  $('approve').disabled=data.approved;
}
async function loadDashboard(){
  await Promise.all([refreshDevices(),refreshVaults(),refreshVault(),refreshUsers()]);
  if($('pair-code').value)await checkCode();
}
$('login-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  void action(form.querySelector('button'),async()=>{
    const input=Object.fromEntries(new FormData(form));form.elements.password.value='';
    session=await api('/console/api/login',input);renderSession();await loadDashboard();
  });
});
$('logout').addEventListener('click',event=>void action(event.currentTarget,async()=>{
  await api('/console/api/logout',{});session={authenticated:false};renderSession();notice('Signed out.');
}));
$('pair-code').value=pendingCode;
$('pair-code').addEventListener('input',()=>{$('approve').disabled=true;});
$('pair-form').addEventListener('submit',event=>{event.preventDefault();void action(event.currentTarget.querySelector('button'),checkCode);});
$('approve').addEventListener('click',event=>void action(event.currentTarget,async()=>{
  await api('/console/api/device/approve',{code:$('pair-code').value.trim().toUpperCase()});
  $('pair-description').textContent='Approved. Your desktop will finish connecting automatically.';
  $('pair-code').value='';notice('Device approved. You can return to ShiroTerm.');
  setTimeout(()=>void refreshDevices().catch(()=>{}),4000);
}).finally(()=>{if(!$('pair-code').value)$('approve').disabled=true;}));
$('refresh-devices').addEventListener('click',event=>void action(event.currentTarget,refreshDevices));
$('vault-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  void action(form.querySelector('button'),async()=>{
    const input=Object.fromEntries(new FormData(form));form.reset();
    await api('/console/api/vault/connect',input);await refreshVault();notice('Vaultwarden connected.');
  });
});
$('lock-vault').addEventListener('click',event=>void action(event.currentTarget,async()=>{
  await api('/console/api/vault/disconnect',{});await refreshVault();notice('Vaultwarden locked for all your connected desktops.');
}));
$('user-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  void action(form.querySelector('button'),async()=>{
    const input=Object.fromEntries(new FormData(form));input.admin=form.elements.admin.checked;
    form.reset();await api('/console/api/users',input);await refreshUsers();notice('Account created.');
  });
});
$('password-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  void action(form.querySelector('button'),async()=>{
    const input=Object.fromEntries(new FormData(form));form.reset();
    await api('/console/api/password',input);await refreshDevices();notice('Password changed. Other sessions and desktops have been signed out.');
  });
});
void (async()=>{
  session=await api('/console/api/session');renderSession();
  if(session.authenticated)await loadDashboard();
})().catch(error=>notice(error.message,true));
setInterval(()=>{if(session.authenticated)void refreshVault().catch(()=>{});},30000);
