'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {_electron}=require('playwright-core');
const {Server}=require('ssh2');
const {createSftpFixture}=require('./helpers/sftp-fixture.cjs');

(async()=>{
  const root=path.resolve(__dirname,'..');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-native-smoke-'));
  const appdata=path.join(tmp,'roaming');
  const localdata=path.join(tmp,'local');
  const profileDir=path.join(appdata,'ShiroTerm Next');
  fs.mkdirSync(profileDir,{recursive:true});
  fs.mkdirSync(localdata,{recursive:true});
  const uploadFolder=path.join(tmp,'sftp-upload');
  const downloadFolder=path.join(tmp,'sftp-download');
  fs.mkdirSync(path.join(uploadFolder,'qa-newdocs'),{recursive:true});
  fs.mkdirSync(downloadFolder,{recursive:true});
  fs.writeFileSync(path.join(uploadFolder,'qa-newdocs','new-note.txt'),'from ShiroTerm UI to SFTP\n');
  const {privateKey}=crypto.generateKeyPairSync('rsa',{
    modulusLength:2048,
    privateKeyEncoding:{type:'pkcs1',format:'pem'},
    publicKeyEncoding:{type:'spki',format:'pem'}
  });
  const fixture=createSftpFixture();
  const clients=new Set();
  let authenticated=0,shellOpened=0;
  const server=new Server({hostKeys:[privateKey]},client=>{
    clients.add(client);
    client.on('close',()=>clients.delete(client));
    client.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username==='test-user'&&
        ctx.password==='fixture-only-password'){
        authenticated++;ctx.accept();
      }else ctx.reject();
    });
    client.on('ready',()=>fixture.attach(client,()=>shellOpened++));
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const host={
    Id:'fixture-host',Name:'Native SSH fixture',Host:'127.0.0.1',
    Port:server.address().port,User:'test-user',Protocol:'SSH',
    CredentialId:'',FolderId:'',Tags:'',Notes:'',
    Favorite:false,KeyFile:'',JumpHost:'',AutoReconnect:false,
    SshKeepAliveSeconds:30
  };
  fs.writeFileSync(path.join(profileDir,'profiles-v2.json'),JSON.stringify({
    Sessions:[host],Folders:[],Credentials:[],Macros:[],imported:false
  }));
  const packaged=process.argv.includes('--packaged');
  const executablePath=packaged?
    path.join(root,'release','ShiroTerm-'+process.platform+'-'+process.arch,
      process.platform==='win32'?'ShiroTerm.exe':'ShiroTerm'):
    require('electron');
  let app;
  try{
    console.log('ELECTRON_NATIVE_MODE='+ (packaged?'packaged':'source'));
    app=await _electron.launch({
      executablePath,cwd:root,
      args:packaged?['--no-sandbox','--disable-gpu','--shiro-smoke']:['.','--no-sandbox','--disable-gpu','--shiro-smoke'],
      env:{...process.env,APPDATA:appdata,LOCALAPPDATA:localdata,SHIROTERM_TEST_USER_DATA:profileDir}
    });
    console.log('ELECTRON_PID='+app.process().pid);
    app.process().stderr?.on('data',data=>console.log('ELECTRON_STDERR='+data.toString().slice(0,2000)));
    app.process().on('exit',(code,signal)=>console.log('ELECTRON_EXIT='+code+'/'+signal));
    const page=await app.firstWindow();
    const problems=[];
    page.on('pageerror',e=>problems.push(e.message));
    page.on('console',m=>console.log('RENDERER_CONSOLE='+m.type()+':'+m.text().slice(0,900)));
    page.on('close',()=>console.log('RENDERER_CLOSED'));
    await page.locator('.host-card').first().waitFor({timeout:12000});
    const profiles=await page.evaluate(()=>window.shiro.profiles());
    assert.equal(profiles.Sessions.length,1);
    assert.equal(profiles.Sessions[0].HasStoredPassword,false);
    await page.locator('.host-card').first().dblclick();
    await page.getByRole('form',{name:'SSH authentication'}).waitFor();
    await page.locator('.credential-modal input[type=password]').first()
      .fill('fixture-only-password');
    await page.locator('.credential-modal button[type=submit]').click();
    const trust=page.getByRole('button',{name:'Trust this key'});
    await trust.waitFor({timeout:15000});
    await trust.click();
    await page.waitForFunction(()=>document.querySelector(
      '.connection-state em')?.textContent?.trim()==='Connected',
      {timeout:20000});
    assert.equal(authenticated,1);
    assert.equal(shellOpened,1);
    assert.deepEqual(problems,[]);
    console.log('ELECTRON_NATIVE_SSH_PASS=true');
    // Real Electron renderer: narrow the Commander with the right-docked Themes
    // sidebar, switch host palette and verify the computed, container-aware UI.
    await page.locator('.session-actions button').filter({hasText:'SFTP'}).click();
    await page.locator('.commander-v2 .commander-workspace').waitFor({timeout:12000});
    // Actual SFTP subsystem, real SSH wire protocol and Electron IPC.
    const remotePane=page.locator('.commander-pane').nth(1);
    const localPane=page.locator('.commander-pane').nth(0);
    await remotePane.locator('.commander-pathbar input').fill('/remote');
    await remotePane.locator('.commander-pathbar input').press('Enter');
    await remotePane.locator('.commander-file').filter({hasText:'readme.txt'}).waitFor({timeout:12000});
    await localPane.locator('.commander-pathbar input').fill(uploadFolder);
    await localPane.locator('.commander-pathbar input').press('Enter');
    await localPane.locator('.commander-file').filter({hasText:'qa-newdocs'}).first().waitFor({timeout:12000});
    await localPane.locator('.commander-file').filter({hasText:'qa-newdocs'}).first().dblclick();
    await localPane.locator('.commander-file').filter({hasText:'new-note.txt'}).waitFor({timeout:12000});
    assert.equal(await localPane.locator('.commander-pathbar input').inputValue(),
      path.join(uploadFolder,'qa-newdocs'));
    await localPane.locator('.commander-pathbar button[title="Parent directory"]').click();
    await localPane.locator('.commander-file').filter({hasText:'qa-newdocs'}).first().waitFor({timeout:12000});
    await localPane.locator('.commander-file').filter({hasText:'qa-newdocs'}).first().click();
    await page.getByRole('button',{name:/Copy to remote/i}).click();
    await page.waitForFunction(()=>Boolean(
      document.querySelector('.sftp-success')?.textContent?.includes('Uploaded')||
      document.querySelector('.sftp-feedback')),null,{timeout:20000});
    if(await page.locator('.sftp-feedback').count())throw Error('SFTP upload failed: '+await page.locator('.sftp-feedback').innerText());
    assert.equal(fixture.files.get('/remote/qa-newdocs/new-note.txt').toString(),'from ShiroTerm UI to SFTP\n');
    await localPane.locator('.commander-pathbar input').fill(downloadFolder);
    await localPane.locator('.commander-pathbar input').press('Enter');
    await remotePane.locator('.commander-file').filter({hasText:'readme.txt'}).first().click();
    await page.getByRole('button',{name:/Copy to local/i}).click();
    await page.waitForFunction(()=>document.querySelector('.sftp-success')?.textContent?.includes('Downloaded'),null,{timeout:20000});
    assert.equal(fs.readFileSync(path.join(downloadFolder,'readme.txt'),'utf8'),'real SFTP fixture file\n');
    console.log('ELECTRON_REAL_SFTP_UPLOAD_DOWNLOAD_PASS=true');
    // The SSH transport remains connected, while only the SFTP subsystem closes.
    // Commander must establish a fresh channel instead of reusing a dead stream.
    const channelCount=fixture.sessions.length;
    fixture.sessions[0].end();
    await page.waitForFunction(()=>document.querySelector('.commander-connect')?.textContent?.includes('unavailable'),null,{timeout:8000});
    await remotePane.locator('.commander-pathbar button[title="Refresh this folder"]').click();
    await page.waitForFunction(()=>document.querySelector('.commander-connect')?.textContent?.includes('connected'),null,{timeout:10000});
    const channelCountNow=fixture.sessions.length;
    console.log('SFTP_CHANNEL_REOPEN='+JSON.stringify({before:channelCount,after:channelCountNow}));
    assert.ok(channelCountNow>channelCount,'SFTP channel was not recreated after closing');
    await remotePane.locator('.commander-file').filter({hasText:'readme.txt'}).waitFor({timeout:10000});
    console.log('ELECTRON_SFTP_CHANNEL_REOPEN_PASS=true');
    await page.getByRole('button',{name:'Open themes sidebar'}).click();
    await page.getByRole('button',{name:'Theme Copper Ember'}).click();
    await page.waitForFunction(()=>document.querySelector('.app')?.getAttribute('data-app-theme')==='ember');
    const layout=await page.evaluate(()=>{
      const app=document.querySelector('.app');
      const commander=document.querySelector('.commander-v2');
      const workspace=commander.querySelector('.commander-workspace');
      const panes=[...commander.querySelectorAll('.commander-pane')];
      const row=commander.querySelector('.commander-file-heading');
      const styles=getComputedStyle(app);
      const rowStyle=getComputedStyle(row);
      const colorProbe=document.createElement('div');
      colorProbe.style.background='var(--ui-bg)';
      app.append(colorProbe);
      const targetBg=getComputedStyle(colorProbe).backgroundColor;
      colorProbe.remove();
      return {
        theme:app.getAttribute('data-app-theme'),
        accent:styles.getPropertyValue('--ui-accent').trim(),
        background:getComputedStyle(commander).backgroundColor,
        expectedBg:targetBg,
        width:workspace.getBoundingClientRect().width,
        paneWidths:panes.map(p=>p.getBoundingClientRect().width),
        cols:rowStyle.gridTemplateColumns.split(' ').length,
        dateVisible:getComputedStyle(row.children[1]).display!=='none',
        kindVisible:getComputedStyle(row.children[3]).display!=='none',
        overflow:panes.some(p=>p.scrollWidth>p.clientWidth+3),
        backgroundRemote:getComputedStyle(panes[1]).backgroundColor
      };
    });
    console.log('SFTP_LAYOUT='+JSON.stringify(layout));
    assert.equal(layout.theme,'ember');
    assert.equal(layout.accent.toLowerCase(),'#ffc184');
    assert.equal(layout.background,layout.expectedBg);
    assert.equal(layout.paneWidths.length,2);
    assert.equal(layout.cols,2);
    assert.equal(layout.dateVisible,false);
    assert.equal(layout.kindVisible,false);
    assert.equal(layout.overflow,false);
    // Check light theme contrast and a narrow workspace (the panels must stack).
    await page.getByRole('button',{name:'Theme Alpine Paper'}).click();
    await page.waitForFunction(()=>document.querySelector('.app')?.getAttribute('data-app-theme')==='paper');
    await page.setViewportSize({width:760,height:820});
    const small=await page.evaluate(()=>{
      const shell=document.querySelector('.app');
      const commander=document.querySelector('.commander-v2');
      const space=commander.querySelector('.commander-workspace');
      const panes=[...commander.querySelectorAll('.commander-pane')];
      const styles=getComputedStyle(shell);
      return {
        lightTheme:shell.getAttribute('data-app-theme'),
        accent:styles.getPropertyValue('--ui-accent').trim(),
        width:space.clientWidth,
        paneWidths:panes.map(p=>Math.round(p.getBoundingClientRect().width)),
        columns:getComputedStyle(space).gridTemplateColumns.split(' ').length,
        paneOverflow:panes.some(p=>p.scrollWidth>p.clientWidth+3),
        background:getComputedStyle(commander).backgroundColor,
        text:getComputedStyle(commander).color
      };
    });
    console.log('SFTP_NARROW_LIGHT_LAYOUT='+JSON.stringify(small));
    assert.equal(small.lightTheme,'paper');
    assert.equal(small.accent.toLowerCase(),'#147d90');
    assert.equal(small.columns,1);
    assert.equal(small.paneOverflow,false);
    assert.notEqual(small.background,small.text);
    console.log('ELECTRON_NATIVE_SFTP_THEME_LAYOUT_PASS=true');
    // No server account is configured in the isolated smoke-test profile.
    // Reading Vaultwarden status or an idle device pairing must NOT show
    // a rejected IPC error in the renderer.
    const initial=await page.evaluate(async()=>({
      vault:await window.shiro.vaultStatus(),
      pairing:await window.shiro.syncPairPoll()
    }));
    assert.equal(initial.vault.connected,false);
    assert.equal(initial.pairing.status,'idle');
    await page.setViewportSize({width:1360,height:900});
    await page.locator('nav.sidebar .nav-link').filter({hasText:'Sync Server'}).click();
    await page.locator('.server-connection-form').waitFor({timeout:15000});
    const spacing=await page.evaluate(()=>{
      const panel=document.querySelector('.server-connection-card');
      const form=document.querySelector('.server-connection-form');
      const children=[...form.children].filter(el=>getComputedStyle(el).display!=='none');
      const rects=children.map(el=>el.getBoundingClientRect());
      const gaps=rects.slice(1).map((r,i)=>r.top-rects[i].bottom);
      const pane=panel.getBoundingClientRect();
      return {
        gap:getComputedStyle(form).rowGap,
        gaps:gaps.map(n=>Math.round(n)),
        panelWidth:Math.round(pane.width),
        viewportWidth:innerWidth,
        overflow:panel.scrollWidth>panel.clientWidth+2
      };
    });
    console.log('SYNC_SERVER_SPACING='+JSON.stringify(spacing));
    assert.ok(spacing.gaps.every(g=>g>=12),'Server login controls overlap or are too close');
    assert.equal(spacing.overflow,false);
    assert.ok(spacing.panelWidth<spacing.viewportWidth);
    assert.deepEqual(problems,[]);
    console.log('ELECTRON_NATIVE_SYNC_SERVER_LAYOUT_PASS=true');
    await page.locator('nav.sidebar .nav-link').filter({hasText:'Vaults'}).click();
    await page.locator('.vaults-simple .vaults-scroll').waitFor({timeout:10000});
    const vaultLayout=await page.evaluate(()=>{
      const element=document.querySelector('.vaults-simple');
      const scrollers=[...element.querySelectorAll('*')].filter(node=>{
        const style=getComputedStyle(node);
        return ['scroll','auto'].includes(style.overflowY)&&node.clientHeight>0;
      });
      return {scrollContainers:scrollers.map(node=>node.className),
        horizontalOverflow:element.scrollWidth>element.clientWidth+3,
        title:element.querySelector('h2')?.textContent,
        heading:element.querySelector('.vaults-state strong')?.textContent};
    });
    console.log('VAULTS_SIMPLIFIED_LAYOUT='+JSON.stringify(vaultLayout));
    assert.equal(vaultLayout.scrollContainers.length,1,'Vaults must have one scroll area');
    assert.equal(vaultLayout.horizontalOverflow,false);
    await page.locator('nav.sidebar .nav-link').filter({hasText:'Keychain'}).click();
    await page.locator('.keychain-simple .keychain-workspace').waitFor({timeout:10000});
    await page.locator('.keychain-simple .feature-header button').click();
    const keychainLayout=await page.evaluate(()=>{
      const root=document.querySelector('.keychain-simple');
      return {advancedOpen:root.querySelector('.keychain-advanced')?.open,
        labels:[...root.querySelectorAll('.keychain-fields label')].map(x=>x.textContent?.trim()),
        overflow:root.scrollWidth>root.clientWidth+3};
    });
    console.log('KEYCHAIN_SIMPLIFIED_LAYOUT='+JSON.stringify(keychainLayout));
    assert.equal(keychainLayout.advancedOpen,false);
    assert.equal(keychainLayout.overflow,false);
    assert.ok(keychainLayout.labels.some(x=>x.includes('Nazwa')));
    assert.deepEqual(problems,[]);
    console.log('ELECTRON_NATIVE_VAULTS_KEYCHAIN_LAYOUT_PASS=true');
  }finally{
    try{await app?.close();}catch{}
    for(const client of clients)client.end();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
