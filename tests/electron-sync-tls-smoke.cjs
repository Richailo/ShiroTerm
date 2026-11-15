'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const https=require('node:https');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright-core');
const {X509Certificate}=require('node:crypto');
(async()=>{
  const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-cert-ui-'));
  const profile=path.join(tmp,'profile'),key=path.join(tmp,'key.pem'),cert=path.join(tmp,'cert.pem');
  const openssl=process.platform==='win32'&&fs.existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')?
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe':'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=ShiroTerm Demo CA',
    '-addext','basicConstraints=critical,CA:TRUE','-addext','subjectAltName=IP:127.0.0.1',
    '-keyout',key,'-out',cert],{stdio:'pipe',env:{...process.env,MSYS_NO_PATHCONV:'1'}});
  let url,app;const confirmations=[];
  const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(req.url==='/v1/device/start'?
      {id:'a'.repeat(32),secret:'b'.repeat(64),code:'DEMO-TLS2',expiresIn:600,portalUrl:url+'/console'}:
      {status:'pending'}));
  });
  server.on('tlsClientError',()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url='https://127.0.0.1:'+server.address().port;
  const packaged=process.argv.includes('--packaged');
  async function launch(){
    app=await _electron.launch({cwd:root,
      executablePath:packaged?path.join(root,'release','ShiroTerm-'+process.platform+'-'+process.arch,
        process.platform==='win32'?'ShiroTerm.exe':'ShiroTerm'):require('electron'),
      args:[...(packaged?[]:['.']),'--no-sandbox','--disable-gpu','--shiro-smoke'],
      env:{...process.env,SHIROTERM_SYNC_CA:'',SHIROTERM_TEST_USER_DATA:profile,LOCALAPPDATA:path.join(tmp,'legacy')}});
    const page=await app.firstWindow();
    await page.locator('nav.sidebar .nav-link').filter({hasText:'Sync Server'}).click();
    await page.getByLabel('Server address').waitFor();
    return page;
  }
  try{
    let page=await launch();
    await page.getByLabel('Server address').fill(url);
    await page.getByRole('button',{name:'Zaloguj przez przeglądarkę'}).click();
    await page.getByRole('alert').getByText('Nieufny certyfikat HTTPS. Wybierz certyfikat serwera.',{exact:true}).waitFor();
    await app.evaluate(({dialog,shell},file)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
      globalThis.certificateConfirmation=null;
      dialog.showMessageBox=async(_win,options)=>{globalThis.certificateConfirmation=options;return {response:0};};
      shell.openExternal=async()=>{};
    },cert);
    await page.getByRole('button',{name:'Certyfikat HTTPS',exact:true}).click();
    await page.getByText('Certyfikat zapisany.',{exact:true}).waitFor();
    if(process.env.SHIROTERM_SCREENSHOT)await page.screenshot({path:process.env.SHIROTERM_SCREENSHOT});
    confirmations.push(await app.evaluate(()=>globalThis.certificateConfirmation));
    assert.equal(confirmations[0].defaultId,1,'Certificate approval must default to cancellation');
    assert.match(confirmations[0].detail,new RegExp(new X509Certificate(fs.readFileSync(cert)).fingerprint256));
    await page.getByRole('button',{name:'Zaloguj przez przeglądarkę'}).click();
    await page.getByText('DEMO-TLS2',{exact:true}).waitFor();
    assert.equal(await page.getByRole('alert').count(),0);
    await app.close();app=null;
    page=await launch();
    await page.getByText('ShiroTerm Demo CA',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Server address').inputValue(),url);
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Usuń certyfikat HTTPS',exact:true}).click();
    await page.getByText('ShiroTerm Demo CA',{exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Zaloguj przez przeglądarkę'}).click();
    await page.getByRole('alert').getByText('Nieufny certyfikat HTTPS. Wybierz certyfikat serwera.',{exact:true}).waitFor();
    console.log('ELECTRON_HTTPS_CERTIFICATE_IMPORT_PERSISTENCE_AND_REVOCATION_PASS');
  }finally{
    await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
