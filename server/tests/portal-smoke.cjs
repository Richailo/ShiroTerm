'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright-core');
const {fixture,ADMIN_PASSWORD}=require('./helpers.cjs');
(async()=>{
  const f=await fixture();let browser;
  try{
    browser=await chromium.launch({headless:true,
      ...(process.env.SHIROTERM_CHROMIUM?{executablePath:process.env.SHIROTERM_CHROMIUM}:
        process.platform==='win32'?{executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'}:{channel:'chrome'})});
    const pending=(await f.request('/v1/device/start',{body:{label:'Demo Windows desktop'}})).body;
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.base+'/console?code='+pending.code);
    await page.locator('#login-panel').waitFor();
    await page.locator('#login-form [name=username]').fill('admin');
    await page.locator('#login-form [name=password]').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button').click();
    await page.locator('#dashboard').waitFor();
    await page.getByText('Authorize “Demo Windows desktop”?',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Approve device',exact:true}).click();
    await page.getByText('Device approved. You can return to ShiroTerm.',{exact:true}).waitFor();
    const approved=await f.request('/v1/device/poll',{body:{id:pending.id,secret:pending.secret}});
    assert.equal(approved.body.status,'approved');
    await page.getByRole('button',{name:'Refresh devices'}).click();
    await page.locator('#devices').getByText('Demo Windows desktop',{exact:true}).waitFor();
    await page.locator('#user-form [name=username]').fill('demo-user');
    await page.locator('#user-form [name=password]').fill('demo-account-password-fixture');
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await page.locator('#users').getByText('demo-user',{exact:true}).waitFor();
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Console overflows horizontally');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.resolve(__dirname,'..','..','validation-server-console.png'),fullPage:true});
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Revoke',exact:true}).click();
    await page.getByText('No desktops have been authorized yet.',{exact:true}).waitFor();
    assert.equal((await f.request('/v1/snapshot',{headers:{Authorization:'Bearer '+approved.body.token}})).status,401);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.locator('#login-panel').waitFor();
    assert.deepEqual(errors,[]);
    console.log('SERVER_PORTAL_LOGIN_PAIRING_USERS_AND_RESPONSIVE_LAYOUT_PASS');
  }finally{await browser?.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
