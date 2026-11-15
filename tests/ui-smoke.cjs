'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
(async()=>{
  const {preview}=await import('vite');
  const server=await preview({root:path.resolve(__dirname,'..'),
    preview:{host:'127.0.0.1',port:0,strictPort:false}});
  const address=server.httpServer.address();
  const url='http://127.0.0.1:'+address.port+'/';
  const browser=await chromium.launch({
    ...(process.env.SHIROTERM_CHROMIUM?{executablePath:process.env.SHIROTERM_CHROMIUM}:
      process.platform==='win32'?{executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'}:
      {channel:'chrome'}),
    headless:true,args:['--disable-gpu','--no-sandbox']
  });
  const outputs=path.join(__dirname,'screenshots');
  fs.mkdirSync(outputs,{recursive:true});
  const summary=[];
  try {
    for(const [width,height] of [[1440,900],[1100,720],[900,640]]){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        const rows=Array.from({length:8},(_,i)=>({
          Id:'test-'+i,Name:i===0?'Production gateway':'Server '+(i+1),
          Host:'192.0.2.'+(i+1),User:i===6?'':'operator',
          Protocol:i===1?'SFTP':i===6?'RDP':i===7?'TELNET':'SSH',
          Port:i===6?3389:i===7?23:22,
          FolderId:'',CredentialId:i===0?'cred-demo':'',Tags:'linux',Notes:'',Favorite:i===0,
          KeyFile:'',JumpHost:'',AutoReconnect:false,SshKeepAliveSeconds:30
        }));
        const listeners=[];
        window.__lastSession='';
        window.__listCount=0;
        window.__cancelledRetry='';
        window.__fakeFiles=[
          {name:'notes.txt',directory:false,size:120,mtime:1720000000,folder:'/'},
          {name:'docs',directory:true,size:0,mtime:1720000000,folder:'/'}
        ];
        window.__emitSSH=event=>{for(const callback of [...listeners])callback(event);};
        window.shiro={
          syncStatus:async()=>({connected:false,url:'',autoConflicts:[]}),
          syncCertificateInfo:async()=>null,
          syncCertificateImport:async()=>null,
          syncCertificateRemove:async()=>true,
          syncReady:async()=>({connected:false,url:'',autoConflicts:[]}),
          syncAutoTick:async()=>({connected:false,autoConflicts:[]}),
          onSyncRestored:()=>()=>{},
          vaultStatus:async()=>({configured:false,connected:false}),
          commanderHome:async()=>'C:\\fixture',
          commanderLocalList:async folder=>({folder,entries:[]}),
          onCommanderProgress:()=>()=>{},
          profiles:async()=>({Sessions:rows,Folders:[],Macros:[
            {Id:'quick',Name:'Check uptime',Command:'uptime'}
          ],
            Credentials:[{Id:'cred-demo',Name:'Network Operators',User:'operator',Notes:'',HasStoredPassword:true}],
            imported:true}),
          saveHost:async host=>{window.__savedHost=host;return host;},removeHost:async()=>true,
          saveCredential:async item=>item,removeCredential:async()=>true,
          saveCredentialPassword:async()=>true,
          savePassword:async()=>true,
          selectKey:async()=>'C:\\fixture\\authorized-client.key',
          openRdp:async id=>{
            window.__openedRdp=id;
            return {address:'192.0.2.7',external:true,processId:7654};
          },
          connectTelnet:async args=>{
            window.__lastTelnet=args;
            setTimeout(()=>window.__emitSSH({
              type:'status',sessionId:args.sessionId,status:'shell-ready'
            }),25);
            return {sessionId:args.sessionId};
          },
          connect:async args=>{
            window.__lastSession=args.sessionId;
            window.__lastConnectArgs=args;
            window.__authenticated=!!args.password;
            return {sessionId:args.sessionId};
          },
          cancelReconnect:async id=>{
            window.__cancelledRetry=id;
            window.__emitSSH({type:'status',sessionId:id,status:'reconnect-stopped'});
            return true;
          },
          write:async(id,data)=>{window.__lastTerminalWrite={id,data};},
          resize:async()=>{},disconnect:async()=>{},
          terminalHistory:()=>'',forgetTerminal:()=>{},
          trust:async(id,accepted)=>{
            window.__lastTrust={id,accepted};
            return true;
          },
          listFiles:async(_id,folder)=>{
            window.__listCount++;
            return window.__fakeFiles.filter(f=>f.folder===folder).map(({folder,...file})=>file);
          },
          sftpAction:async(_id,request)=>{
            window.__lastSftpAction=request;
            const {operation,folder,name,newName}=request;
            if(operation==='mkdir'){
              window.__fakeFiles.push({folder,name,directory:true,size:0,mtime:1720000000});
            }else if(operation==='rename'){
              const existing=window.__fakeFiles.find(f=>f.folder===folder&&f.name===name);
              if(!existing)throw Error('Missing file');
              if(window.__fakeFiles.some(f=>f.folder===folder&&f.name===newName))throw Error('Already exists');
              existing.name=newName;
            }else if(operation==='delete'){
              window.__fakeFiles=window.__fakeFiles.filter(f=>!(f.folder===folder&&f.name===name));
            }
            return {operation,path:folder+'/'+(newName||name)};
          },
          transfer:async()=>({canceled:true}),
          listForwards:async()=>[],startForward:async()=>({}),stopForward:async()=>true,
          listActivity:async()=>[{
            id:'event-a',type:'status',sessionId:'test',host:'Production gateway',
            status:'shell-ready',message:'',changed:false,time:new Date().toISOString()
          }],
          clearActivity:async()=>true,
          readClipboard:async()=>window.__clipboardText||'',
          copyText:async text=>{
            window.__copiedTerminal=text;
            return true;
          },
          windowState:async()=>({maximized:window.__maximized||false}),
          onWindowState:callback=>{
            window.__onWindowState=callback;
            return ()=>{window.__onWindowState=null;};
          },
          windowAction:async action=>{
            window.__lastWindowAction=action;
            if(action==='toggleMaximize'){
              window.__maximized=!window.__maximized;
              window.__onWindowState?.({maximized:window.__maximized});
            }
          },
          onSshEvent:handler=>{
            listeners.push(handler);
            return ()=>{const index=listeners.indexOf(handler);if(index>=0)listeners.splice(index,1);};
          }
        };
      });
      await page.goto(url,{waitUntil:'networkidle'});
      await page.locator('.host-card').first().waitFor();
      const dragRegion=await page.evaluate(()=>{
        const prop=el=>getComputedStyle(document.querySelector(el))
          .getPropertyValue('-webkit-app-region').trim();
        return {brand:prop('.titlebar .brand'),titlebar:prop('.titlebar'),
          tabs:prop('.titlebar .title-tabs'),
          menu:prop('.titlebar .sidebar-toggle'),
          home:prop('.titlebar .title-tab-home'),
          controls:prop('.titlebar .window-controls button')};
      });
      if(dragRegion.titlebar){
        assert.equal(dragRegion.titlebar,'drag','Top bar should be a native draggable region');
        assert.equal(dragRegion.brand,'drag','Brand/title area should move the window');
        assert.equal(dragRegion.tabs,'drag','Blank tab-strip space should move the window');
        assert.equal(dragRegion.menu,'no-drag','Sidebar button must remain clickable');
        assert.equal(dragRegion.home,'no-drag','Session tabs must remain clickable');
        assert.equal(dragRegion.controls,'no-drag','Window controls must remain clickable');
      }
      const maxButton=page.getByRole('button',{name:'Maximize'});
      await maxButton.click();
      await page.getByRole('button',{name:'Restore window'}).waitFor();
      assert.equal(await page.evaluate(()=>window.__lastWindowAction),'toggleMaximize');
      await page.getByRole('button',{name:'Restore window'}).click();
      await page.getByRole('button',{name:'Maximize'}).waitFor();
      const themesTrigger=page.getByRole('button',{name:'Open themes sidebar'});
      const snippetsTrigger=page.getByRole('button',{name:'Open snippets sidebar'});
      assert.equal(await themesTrigger.count(),1,'Theme icon must be in the titlebar');
      assert.equal(await snippetsTrigger.count(),1,'Snippets icon must be in the titlebar');
      assert.equal(await page.locator('.session-tools.is-open').count(),0,
        'Right drawer must be closed by default');
      await snippetsTrigger.click();
      await page.locator('.session-tools.is-open').waitFor();
      await page.waitForTimeout(350);
      assert.equal(await page.getByRole('tab',{name:'Snippets'}).getAttribute('aria-selected'),'true',
        'Snippets icon must open the correct drawer section');
      const panelPosition=await page.locator('.session-tools').evaluate(el=>{
        const r=el.getBoundingClientRect();
        return {left:r.left,right:r.right,width:r.width,win:innerWidth};
      });
      assert.ok(panelPosition.right<=panelPosition.win+1 &&
        panelPosition.left>=panelPosition.win*0.48 &&
        panelPosition.width>=280,
        'Drawer must dock to the right edge and remain within the window');
      await themesTrigger.click();
      assert.equal(await page.locator('.session-tools.is-open').count(),1,
        'Switching icons must reuse the same open drawer');
      assert.equal(await page.getByRole('tab',{name:'Themes'}).getAttribute('aria-selected'),'true');
      await themesTrigger.click();
      assert.equal(await page.locator('.session-tools.is-open').count(),0,
        'Second click on the same icon must close the drawer');
      if(width>920){
        const menu=page.getByRole('button',{name:'Toggle sidebar'});
        await menu.click();
        await page.waitForTimeout(250);
        assert.ok(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width)<=57,
          'Collapsed sidebar must have icon-only width');
        await menu.click();
        await page.waitForTimeout(250);
        assert.ok(await page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width)>=160,
          'Expanded sidebar must restore labels');
      }
      await page.getByText('Production gateway').first().click();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.host-inspector.open').count(),0,
        'Single click highlights without opening Host Details');
      assert.equal(await page.locator('.host-card.selected').count(),1);
      const firstHost=page.locator('.host-card').first();
      await firstHost.click({button:'right'});
      await page.getByRole('menu',{name:'Host actions for Production gateway'}).waitFor();
      await page.getByRole('menuitem',{name:'Copy address'}).click();
      assert.equal(await page.evaluate(()=>window.__copiedTerminal),'192.0.2.1',
        'Right click Copy address must copy the host address');
      await firstHost.click({button:'right'});
      await page.getByRole('menuitem',{name:'Remove favorite'}).click();
      assert.equal(await page.evaluate(()=>window.__savedHost?.Favorite),false,
        'Context menu must update favorites in saved profiles');
      await firstHost.click({button:'right'});
      await page.getByRole('menuitem',{name:/Edit host/}).click();
      assert.equal(await page.locator('.host-inspector.open').count(),1,
        'Context menu Edit must open Host Details');
      await page.getByRole('button',{name:'Close inspector'}).click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.host-inspector.open').count(),0);
      await firstHost.getByRole('button',{name:'Edit Production gateway'}).click();
      await page.waitForTimeout(330);
      assert.equal(await page.locator('.host-inspector.open').count(),1,
        'Pencil must open host details');
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.getByRole('button',{name:'Theme Alpine Paper'}).click();
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      const hostDetailPalette=await page.evaluate(()=>{
        const app=document.querySelector('.app');
        const inspector=document.querySelector('.host-inspector');
        const css=getComputedStyle(app);
        const bg=el=>getComputedStyle(document.querySelector(el)).backgroundColor;
        const color=el=>getComputedStyle(document.querySelector(el)).color;
        const expected=key=>{
          const span=document.createElement('span');
          span.style.backgroundColor=css.getPropertyValue(key).trim();
          app.appendChild(span);
          const result=getComputedStyle(span).backgroundColor;
          span.remove();
          return result;
        };
        return {
          theme:app.dataset.appTheme,
          background:bg('.host-inspector'),
          expectedSidebar:expected('--ui-sidebar'),
          header:bg('.inspector-header'),
          expectedTitle:expected('--ui-title'),
          card:bg('.editor-card'),
          expectedCard:expected('--ui-raised'),
          input:bg('.inspector-scroll .field input'),
          expectedInput:expected('--ui-bg'),
          footer:bg('.inspector-footer'),
          formText:color('.inspector-scroll .field input'),
          text:getComputedStyle(app).color,
          scheme:getComputedStyle(inspector).colorScheme,
          compositorTransform:getComputedStyle(inspector).transform,
          fontSize:parseFloat(getComputedStyle(document.querySelector('.inspector-scroll .field input')).fontSize),
          labelSize:parseFloat(getComputedStyle(document.querySelector('.inspector-scroll .field>span')).fontSize),
          captionSize:parseFloat(getComputedStyle(document.querySelector('.card-caption')).fontSize),
          fontSmoothing:getComputedStyle(document.body).webkitFontSmoothing||'auto',
          labelText:color('.inspector-scroll .field>span')
        };
      });
      assert.equal(hostDetailPalette.theme,'paper');
      assert.equal(hostDetailPalette.background,hostDetailPalette.expectedSidebar,
        'Host Details background must follow Alpine Paper');
      assert.equal(hostDetailPalette.header,hostDetailPalette.expectedTitle,
        'Host Details header must follow Alpine Paper');
      assert.equal(hostDetailPalette.card,hostDetailPalette.expectedCard,
        'Editor cards must use the active theme');
      assert.equal(hostDetailPalette.input,hostDetailPalette.expectedInput,
        'Editor input fields must use the active theme');
      assert.equal(hostDetailPalette.footer,hostDetailPalette.expectedTitle,
        'Host Details footer must use the active theme');
      assert.equal(hostDetailPalette.formText,hostDetailPalette.text,
        'Editor text must use the active theme');
      assert.equal(hostDetailPalette.scheme,'light','Host Details must inherit light color scheme');
      assert.equal(hostDetailPalette.compositorTransform,'none',
        'Host Details must not rasterize text inside a translated GPU layer');
      assert.notEqual(hostDetailPalette.fontSmoothing,'antialiased',
        'Disable forced grayscale antialiasing: preserve native Windows font rendering');
      assert.ok(hostDetailPalette.fontSize>=13.5,
        'Form values need readable native Windows font sizes');
      assert.ok(hostDetailPalette.labelSize>=12.5,
        'Field labels need clearer, readable font sizes');
      assert.ok(hostDetailPalette.captionSize>=13,
        'Section headings must remain legible');
      assert.equal(hostDetailPalette.labelText,hostDetailPalette.text,
        'Field labels must use high-contrast theme text');
      await page.screenshot({path:path.join(outputs,'host-details-alpine-'+width+'.png')});
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.getByRole('button',{name:'Theme Shiro Aurora'}).click();
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'aurora');
      const result=await page.evaluate(()=>{
        const inspector=document.querySelector('.host-inspector');
        const scroll=document.querySelector('.inspector-scroll');
        const x=inspector.getBoundingClientRect();
        const controls=[...inspector.querySelectorAll('input,select,textarea')];
        const outside=controls.filter(el=>{
          const r=el.getBoundingClientRect();
          return r.width<=0||r.left<x.left-2||r.right>x.right+2;
        }).map(el=>el.outerHTML.slice(0,100));
        return {
          inspectorWidth:x.width,
          pageHorizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          inspectorHorizontalOverflow:scroll.scrollWidth-scroll.clientWidth,
          outside,controls:controls.length,
          hostCards:document.querySelectorAll('.host-card').length,
          topbarHeight:document.querySelector('.titlebar').clientHeight
        };
      });
      const darkSharpness=await page.locator('.host-inspector').evaluate(panel=>{
        const field=panel.querySelector('.field input');
        const section=panel.querySelector('.card-caption');
        const label=panel.querySelector('.field>span');
        return {
          transform:getComputedStyle(panel).transform,
          fieldSize:parseFloat(getComputedStyle(field).fontSize),
          sectionSize:parseFloat(getComputedStyle(section).fontSize),
          labelSize:parseFloat(getComputedStyle(label).fontSize),
          opacity:getComputedStyle(panel).opacity
        };
      });
      assert.equal(darkSharpness.transform,'none','Dark inspector text must stay on an untransformed layer');
      assert.ok(darkSharpness.fieldSize>=13.5 && darkSharpness.sectionSize>=13 && darkSharpness.labelSize>=12.5);
      await page.screenshot({path:path.join(outputs,'hosts-'+width+'.png')});
      assert.equal(errors.length,0,'Browser errors: '+errors.join(', '));
      assert.equal(result.pageHorizontalOverflow,0,'Page horizontal overflow');
      assert.ok(result.inspectorHorizontalOverflow<=2,'Inspector horizontal overflow');
      assert.deepEqual(result.outside,[],'Inputs beyond inspector');
      assert.equal(result.hostCards,8);
      assert.equal(await page.locator('.inspector-scroll option[value="cred-demo"]').count(),1,
        'Host editor must offer shared credentials');
      await page.locator('.inspector-scroll .card-caption').filter({hasText:'Advanced'}).click();
      const autoToggle=page.getByRole('checkbox',{name:'Auto reconnect on unexpected disconnect'});
      await autoToggle.check();
      assert.equal(await autoToggle.isChecked(),true);
      await autoToggle.uncheck();
      const jump=page.getByLabel('Jump host (SSH gateway)');
      await jump.selectOption('test-2');
      assert.equal(await jump.inputValue(),'test-2','Gateway selection must use saved host ID');
      assert.equal(await jump.locator('option[value="test-0"]').count(),0,
        'A host must not be allowed to select itself as gateway');
      const accordionOverflow=await page.locator('.inspector-scroll').evaluate(
        el=>el.scrollWidth-el.clientWidth);
      assert.ok(accordionOverflow<=2,'Expanded advanced form must not overflow');
      await page.getByRole('button',{name:'Close inspector'}).click();
      await page.waitForTimeout(75);
      assert.equal(await page.locator('.inspector-content').count(),1,
        'Inspector contents should remain during closing animation');
      await page.locator('nav button.nav-link').filter({hasText:'Port Forwarding'}).click({timeout:3000});
      try{await page.getByRole('heading',{name:'Port Forwarding',exact:true}).waitFor({timeout:5000});}
      catch(e){console.log('UI_ERROR_STATE',JSON.stringify(errors),await page.locator('body').innerText().then(x=>x.slice(0,1400)));throw e;}
      await page.locator('nav button.nav-link').filter({hasText:'Keychain'}).click();
      await page.getByText('Network Operators').click();
      await page.getByPlaceholder('Zapisane — pozostaw puste, aby zachować').waitFor();
      const credentialsOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.equal(credentialsOverflow,0,'Keychain must not overflow horizontally');
      await page.locator('.sidebar button.nav-link').first().click({timeout:3000});
      await page.locator('.host-card').nth(1).dblclick();
      await page.getByRole('form',{name:'SSH authentication'}).waitFor();
      await page.locator('.credential-modal').getByLabel('Password',{exact:true}).fill('fixture-password-only');
      await page.locator('.credential-modal button[type=submit]').click();
      await page.locator('.commander-v2').waitFor({timeout:6500});
      assert.equal(await page.evaluate(()=>window.__authenticated),true,
        'Double-click must pass entered SSH password to the native connection');
      const terminalHidden=await page.locator('.terminal-stack').evaluate(el=>getComputedStyle(el).display);
      assert.equal(terminalHidden,'none','SFTP view must not overlap terminal');
      assert.equal(await page.locator('.title-tabs .title-tab').count(),2,
        'SFTP-only session must not create duplicate tabs');
      assert.equal(await page.locator('.title-tabs .title-tab').nth(1)
        .locator('.platform-icon').count(),0,
        'SFTP-only tab uses the SFTP icon, not an unrelated OS badge');
      // SSH brand geometry is verified below after opening the Proxmox terminal.
      const tabMeasurements=async()=>page.locator('.title-tabs').evaluate(rail=>{
        const elements=Array.from(rail.querySelectorAll('.title-tab'));
        return {
          widths:elements.map(el=>el.getBoundingClientRect().width),
          selected:elements.map(el=>el.getAttribute('aria-selected')),
          transition:getComputedStyle(elements[1]).transitionProperty,
          overflow:rail.scrollWidth>rail.clientWidth
        };
      });
      await page.waitForTimeout(370);
      const opened=await tabMeasurements();
      assert.equal(opened.selected[1],'true');
      assert.ok(opened.widths[1]>opened.widths[0]+10,
        'Active SFTP tab must expand visibly');
      assert.ok(opened.transition.includes('flex-basis'),
        'Active tab expansion needs a smooth width transition');
      await page.locator('.title-tabs .title-tab').first().click();
      await page.waitForTimeout(370);
      const homeActive=await tabMeasurements();
      assert.equal(homeActive.selected[0],'true');
      assert.ok(homeActive.widths[0]>opened.widths[0]+15,
        'Vaults tab must expand when selected');
      assert.ok(homeActive.widths[1]<opened.widths[1]-15,
        'Inactive tab must shrink again');
      await page.locator('.title-tabs .title-tab').nth(1).click();
      await page.locator('.commander-v2').waitFor();
      const originalSession=await page.evaluate(()=>window.__lastSession);
      const beforeRefresh=await page.evaluate(()=>window.__listCount);
      await page.evaluate(()=>window.__emitSSH({
        type:'status',status:'reconnect-wait',sessionId:window.__lastSession,
        attempt:1,maxAttempts:5,delayMs:2000
      }));
      await page.getByRole('button',{name:'Cancel retry'}).waitFor();
      await page.evaluate(()=>window.__emitSSH({
        type:'status',status:'sftp-ready',sessionId:window.__lastSession
      }));
      await page.waitForFunction(n=>window.__listCount>n,beforeRefresh);
      await page.evaluate(()=>window.__emitSSH({
        type:'status',status:'reconnect-wait',sessionId:window.__lastSession,
        attempt:2,maxAttempts:5,delayMs:4000
      }));
      await page.getByRole('button',{name:'Cancel retry'}).click();
      assert.equal(await page.evaluate(()=>window.__cancelledRetry),originalSession);
      await page.getByRole('button',{name:'Reconnect'}).click();
      await page.getByRole('form',{name:'SSH authentication'}).waitFor();
      await page.locator('.credential-modal').getByLabel('Password',{exact:true})
        .fill('fixture-password-only');
      await page.locator('.credential-modal button[type=submit]').click();
      const refreshedSession=await page.evaluate(()=>window.__lastSession);
      assert.notEqual(originalSession,refreshedSession,
        'Reconnection should create a new transport session');
      assert.equal(await page.locator('.title-tabs .title-tab').count(),2,
        'Reconnect should replace old tab, not duplicate it');
      await page.locator('nav button.nav-link').filter({hasText:'Logs'}).click();
      await page.getByText('Connection activity').waitFor();
      await page.getByText('Production gateway').last().waitFor();
      await page.evaluate(()=>window.__emitSSH({
        type:'verify',sessionId:'test-key',requestId:'trust-demo',
        host:'127.0.0.1',port:22,fingerprint:'demo-fingerprint',changed:false
      }));
      await page.getByRole('button',{name:'Trust this key'}).click();
      assert.equal(await page.evaluate(()=>window.__lastTrust?.id),'trust-demo');
      assert.equal(await page.evaluate(()=>window.__lastTrust?.accepted),true);
      await page.locator('.sidebar button.nav-link').first().click();
      await page.locator('.host-card').nth(2).dblclick();
      await page.getByRole('form',{name:'SSH authentication'}).waitFor();
      await page.getByRole('button',{name:'Choose key'}).click();
      assert.equal(await page.getByLabel('Selected SSH private key').inputValue(),
        'C:\\fixture\\authorized-client.key');
      await page.locator('.credential-modal button[type=submit]').click();
      assert.equal(await page.evaluate(()=>window.__savedHost?.KeyFile),
        'C:\\fixture\\authorized-client.key',
        'Selected private key must be saved to the host profile');
      assert.equal(await page.evaluate(()=>window.__lastConnectArgs?.password),'',
        'Key-based authentication must not require a password');
      await page.evaluate(()=>window.__emitSSH({
        type:'error',sessionId:window.__lastSession,
        message:'All configured authentication methods failed'
      }));
      await page.getByRole('form',{name:'SSH authentication'}).waitFor();
      await page.getByRole('alert').filter({hasText:'All configured authentication methods failed'}).waitFor();
      await page.getByRole('button',{name:'Cancel authentication'}).click();
      await page.evaluate(()=>window.__emitSSH({
        type:'platform',sessionId:window.__lastSession,hostId:'test-2',
        platform:'proxmox',role:'hypervisor',version:'pve-manager/9.1',confidence:.98
      }));
      await page.waitForFunction(()=>document.querySelector('.title-tabs .title-tab.active .platform-proxmox'));
      const measurePlatformTab=async()=>page.locator('.title-tabs .title-tab .platform-proxmox').evaluate(icon=>{
        const r=icon.getBoundingClientRect();
        const svg=icon.querySelector('svg'),s=svg.getBoundingClientRect();
        const label=icon.parentElement.querySelector('.tab-label');
        const labelBox=label.getBoundingClientRect();
        const style=getComputedStyle(icon);
        return {width:r.width,height:r.height,svgWidth:s.width,svgHeight:s.height,
          centerX:Math.abs((s.left+s.right-r.left-r.right)/2),
          centerY:Math.abs((s.top+s.bottom-r.top-r.bottom)/2),
          labelStart:labelBox.left,iconEnd:r.right,
          flexGrow:Number(style.flexGrow),background:style.backgroundColor,
          radius:parseFloat(style.borderTopLeftRadius)};
      });
      for(const mode of ['active','inactive']){
        if(mode==='inactive')await page.locator('.title-tab-home').click();
        await page.waitForTimeout(370);
        const icon=await measurePlatformTab();
        assert.ok(Math.abs(icon.width-23)<=1&&Math.abs(icon.height-23)<=1,
          mode+' platform badge must remain 23x23, not stretch: '+JSON.stringify(icon));
        assert.ok(Math.abs(icon.svgWidth-15)<=1&&Math.abs(icon.svgHeight-15)<=1,
          mode+' SVG must have adequate padding: '+JSON.stringify(icon));
        assert.ok(icon.centerX<1&&icon.centerY<1,
          mode+' SVG must stay centered: '+JSON.stringify(icon));
        assert.ok(icon.labelStart>=icon.iconEnd+4&&icon.flexGrow===0,
          mode+' logo must not overlap the tab title or grow: '+JSON.stringify(icon));
        assert.equal(icon.background,'rgb(195, 84, 0)');
        assert.ok(icon.radius>=6,'Brand tile should be softly rounded');
      }
      await page.getByRole('tab',{name:'Server 3'}).click();
      await page.screenshot({path:path.join(outputs,'proxmox-tab-logo-'+width+'.png')});
      assert.equal(await page.locator('.host-card').nth(2).locator('.platform-icon[aria-label="Proxmox VE"]').count(),1,
        'Host card must identify Proxmox rather than Debian after SSH detection');
      const proxmoxLogo=await page.locator('.host-card').nth(2).locator('.platform-proxmox')
        .evaluate(el=>({
          background:getComputedStyle(el).backgroundColor,
          vectorPaths:el.querySelectorAll('svg path').length,
          iconSize:parseFloat(getComputedStyle(el).width)
        }));
      assert.equal(proxmoxLogo.background,'rgb(195, 84, 0)',
        'Proxmox must have its own branded colored tile');
      assert.ok(proxmoxLogo.vectorPaths>=1,'Proxmox must render real vector artwork');
      assert.ok(proxmoxLogo.iconSize>=40,
        'Brand logo tile must be legible: '+JSON.stringify(proxmoxLogo));
      const themeButton=page.getByRole('button',{name:'Open themes sidebar'});
      await themeButton.click();
      await page.getByRole('group',{name:'Terminal color themes'}).waitFor();
      assert.equal(await page.locator('.theme-choice').count(),6,'Six real terminal palettes are available');
      const terminalCountBefore=await page.locator('.terminal-view').count();
      await page.getByRole('button',{name:'Theme Alpine Paper'}).click();
      const applicationColors=await page.evaluate(()=>{
        const app=document.querySelector('.app');
        return {
          theme:app.dataset.appTheme,
          title:getComputedStyle(document.querySelector('.titlebar')).backgroundColor,
          sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
          surface:getComputedStyle(document.querySelector('.host-card')).backgroundColor,
          text:getComputedStyle(app).color
        };
      });
      assert.equal(applicationColors.theme,'paper');
      assert.notEqual(applicationColors.title,'rgb(21, 25, 39)',
        'Top bar must follow the selected theme');
      assert.ok(applicationColors.text.startsWith('rgb(36, 51, 75)'),
        'Light theme should use dark application text');
      assert.notEqual(applicationColors.sidebar,applicationColors.surface,
        'Layered UI surfaces should stay visually distinct');
      assert.equal(await page.getByRole('button',{name:'Theme Alpine Paper'}).getAttribute('aria-pressed'),
        'true','Selected palette is announced to assistive technologies');
      const themeResult=await page.evaluate(()=>{
        const panel=document.querySelector('.session-tools');
        const rect=panel.getBoundingClientRect();
        const prefs=JSON.parse(localStorage.getItem('shiroterm:terminal-themes:v1'));
        return {
          background:getComputedStyle(document.querySelector('.terminal-stack')).backgroundColor,
          terminalBackground:getComputedStyle(document.querySelector('.terminal-view')).backgroundColor,
          stored:prefs.byHost['test-2'],
          fits:rect.right<=innerWidth&&rect.left>=0&&rect.bottom<=innerHeight,
          viewport:[innerWidth,innerHeight],drawerRect:[rect.left,rect.top,rect.right,rect.bottom],
          css:[getComputedStyle(panel).position,getComputedStyle(panel).top,getComputedStyle(panel).left,getComputedStyle(panel).maxHeight],
          ancestor:panel.parentElement?.className
        };
      });
      assert.equal(themeResult.background,'rgb(243, 245, 249)');
      assert.equal(themeResult.terminalBackground,'rgb(243, 245, 249)');
      assert.equal(themeResult.stored,'paper','Host theme must persist locally');
      assert.equal(themeResult.fits,true,'Theme menu must fit viewport: '+JSON.stringify(themeResult));
      assert.equal(await page.locator('.terminal-view').count(),terminalCountBefore,
        'Theme change must not recreate terminal tabs');
      await page.getByRole('button',{name:'Set as default'}).click();
      assert.equal(await page.evaluate(()=>
        JSON.parse(localStorage.getItem('shiroterm:terminal-themes:v1')).defaultId),'paper');
      await page.getByRole('button',{name:'Theme Shiro Aurora'}).click();
      assert.equal(await page.locator('.terminal-stack').evaluate(el=>
        getComputedStyle(el).backgroundColor),'rgb(17, 25, 39)');
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'aurora',
        'The entire application changes color when the active terminal changes');
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      assert.equal(await page.locator('.session-tools.is-open').count(),0);
      await page.locator('.title-tabs .title-tab').first().click();
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'aurora',
        'Vaults must restore the independent main UI theme');
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.getByRole('button',{name:'Theme Copper Ember'}).click();
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'ember');
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.locator('.title-tabs .title-tab').last().click();
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'aurora',
        'Host tab must keep its own theme after editing Vaults theme');
      await page.locator('.title-tabs .title-tab').first().click();
      assert.equal(await page.locator('.app').getAttribute('data-app-theme'),'ember',
        'Vaults theme must survive switching away and back');
      await page.locator('.title-tabs .title-tab').last().click();
      await page.screenshot({path:path.join(outputs,'terminal-colors-'+width+'.png')});
      await page.reload({waitUntil:'networkidle'});
      await page.locator('.host-card').nth(2).dblclick();
      await page.getByRole('form',{name:'SSH authentication'}).waitFor();
      await page.locator('.credential-modal').getByLabel('Password',{exact:true})
        .fill('fixture-password-only');
      await page.locator('.credential-modal button[type=submit]').click();
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      assert.equal(await page.getByRole('button',{name:'Theme Shiro Aurora'})
        .getAttribute('aria-pressed'),'true','Selected host theme must survive page reload');
      assert.equal(await page.getByRole('button',{name:'Theme Alpine Paper'})
        .locator('.theme-choice-meta svg').count(),1,'Saved default theme indicator must survive reload');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.querySelector('.session-tools')?.classList.contains('is-open'));
      await page.evaluate(()=>window.__emitSSH({
        type:'status',status:'shell-ready',sessionId:window.__lastSession
      }));
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.getByRole('tab',{name:'Snippets'}).click();
      await page.getByRole('button',{name:'Run'}).click();
      assert.equal(await page.evaluate(()=>window.__lastTerminalWrite?.data),'uptime\n',
        'Run snippet must send its command followed by Enter');
      await page.getByRole('button',{name:'Open themes sidebar'}).click();
      await page.getByRole('tab',{name:'Snippets'}).click();
      await page.getByRole('button',{name:'Insert'}).click();
      assert.equal(await page.evaluate(()=>window.__lastTerminalWrite?.data),'uptime',
        'Insert snippet must not execute it');
      await page.evaluate(()=>window.__emitSSH({
        type:'data',sessionId:window.__lastSession,
        data:'connected 192.0.2.220 at 2026-10-28\\r\\nERROR file /var/log/nginx/error.log\\r\\n'
      }));
      await page.waitForTimeout(450);
      const terminalArea=page.locator('.terminal-view').last();
      await terminalArea.click({button:'right',position:{x:95,y:90}});
      await page.getByRole('menu',{name:'Terminal context menu'}).waitFor();
      assert.equal(await page.getByRole('menuitem',{name:/^Copy All/}).count(),1);
      assert.equal(await page.getByRole('menuitem',{name:/^Copy Selection/}).isDisabled(),true,
        'Copy requires an actual terminal selection');
      await page.getByRole('menuitem',{name:/^Copy All/}).click();
      await page.waitForFunction(()=>String(window.__copiedTerminal||'').includes('192.0.2.220'));
      assert.ok((await page.evaluate(()=>window.__copiedTerminal)).includes('/var/log/nginx/error.log'));
      const termBox=await terminalArea.boundingBox();
      await page.mouse.move(termBox.x+22,termBox.y+18);
      await page.mouse.down();
      await page.mouse.move(termBox.x+172,termBox.y+18,{steps:8});
      await page.mouse.up();
      await terminalArea.click({button:'right',position:{x:110,y:90}});
      const copySelection=page.getByRole('menuitem',{name:/^Copy Selection/});
      assert.equal(await copySelection.isEnabled(),true,'Terminal selection enables Copy');
      await copySelection.click();
      const selectedCopy=await page.evaluate(()=>window.__copiedTerminal);
      assert.ok(selectedCopy.length>0&&selectedCopy.length<100,
        'Copy must contain only the selected range, not full scrollback');
      await page.evaluate(()=>{
        window.__clipboardText='echo pasted-from-context';
        window.__lastTerminalWrite=null;
      });
      await terminalArea.click({button:'right',position:{x:115,y:90}});
      const pasteOption=page.getByRole('menuitem',{name:/^Paste/});
      assert.equal(await pasteOption.count(),1,'Paste must be in terminal context menu');
      await pasteOption.click();
      await page.waitForFunction(()=>window.__lastTerminalWrite?.data==='echo pasted-from-context');
      assert.equal(await page.getByText('Pasted',{exact:true}).count(),1);
      assert.equal(await page.getByRole('menu',{name:'Terminal context menu'}).count(),0,
        'Paste closes context menu after successful use');
      // Ctrl+Shift+V should paste into the focused xterm using the same bridge.
      await page.evaluate(()=>{
        window.__clipboardText='echo pasted-from-shortcut';
        window.__lastTerminalWrite=null;
      });
      await terminalArea.locator('textarea.xterm-helper-textarea').focus();
      await page.keyboard.press('Control+Shift+V');
      await page.waitForFunction(()=>window.__lastTerminalWrite?.data==='echo pasted-from-shortcut');
      // Multiline pastes must not execute without explicit approval.
      await page.evaluate(()=>{
        window.__clipboardText=['echo first','echo second'].join(String.fromCharCode(10));
        window.__lastTerminalWrite=null;
      });
      await terminalArea.click({button:'right',position:{x:115,y:90}});
      const rejection=page.waitForEvent('dialog').then(async dialog=>{
        assert.match(dialog.message(),/multiple lines/);
        await dialog.dismiss();
      });
      await pasteOption.click();
      await rejection;
      assert.equal(await page.evaluate(()=>window.__lastTerminalWrite),null,
        'Declined multiline paste must not send any input');
      await page.screenshot({path:path.join(outputs,'app-theme-'+width+'.png')});
      await page.evaluate(()=>window.__emitSSH({
        type:'platform',sessionId:window.__lastSession,hostId:'test-2',
        platform:'proxmox',role:'hypervisor',version:'pve-manager/9.1',confidence:.98
      }));
      await page.getByRole('img',{name:'Proxmox VE'}).first().waitFor();
      await page.locator('.title-tabs .title-tab').first().click();
      const detectedCard=page.locator('.host-card').filter({hasText:'Server 3'});
      await detectedCard.getByText('Proxmox VE',{exact:false}).waitFor();
      await detectedCard.getByRole('button',{name:'Edit Server 3'}).click();
      await page.waitForTimeout(300);
      const selector=page.getByLabel('Platform icon override');
      await selector.selectOption('debian');
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await detectedCard.getByRole('img',{name:'Debian'}).waitFor();
      await page.evaluate(()=>window.__emitSSH({
        type:'platform',sessionId:window.__lastSession,hostId:'test-2',
        platform:'proxmox',role:'hypervisor',version:'pve-manager/9.2'
      }));
      assert.equal(await detectedCard.getByRole('img',{name:'Debian'}).count(),1,
        'Manual icon override must not be replaced by auto detection');
      const rdpCard=page.locator('.host-card').filter({hasText:'Server 7'});
      const telnetCard=page.locator('.host-card').filter({hasText:'Server 8'});
      await rdpCard.getByRole('button',{name:'Edit Server 7'}).click();
      await page.getByText('Windows Remote Desktop / Remmina',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Save & Open RDP'}).isEnabled(),true);
      const tabCountBeforeRdp=await page.locator('.title-tabs .title-tab').count();
      await page.getByRole('button',{name:'Save & Open RDP'}).click();
      await page.getByText('Windows Remote Desktop client started',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>window.__openedRdp),'test-6',
        'Save & Open RDP must work even when no SSH username is set');
      assert.equal(await page.locator('.host-inspector.open').count(),0);
      await rdpCard.dblclick();
      await page.getByText('Windows Remote Desktop client started',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>window.__openedRdp),'test-6');
      assert.equal(await page.locator('.title-tabs .title-tab').count(),tabCountBeforeRdp,
        'Native RDP must not create a fake SSH terminal tab');
      page.on('dialog',dialog=>dialog.accept());
      await telnetCard.dblclick();
      await page.getByText('Unencrypted',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.__lastTelnet?.id),'test-7');
      assert.equal(await page.locator('.session-bar button').filter({hasText:'SFTP'}).count(),0,
        'Telnet does not provide SSH/SFTP features');
      await page.getByRole('button',{name:'Back to hosts'}).click();
      await page.locator('.title-tabs .title-tab').filter({hasText:'Server 3'}).click();
      await page.getByRole('button',{name:'SFTP',exact:true}).click();
      const remotePane=page.locator('.commander-pane').nth(1);
      await remotePane.locator('.commander-file-list').click({position:{x:8,y:8}});
      await page.getByRole('button',{name:'New folder',exact:true}).click();
      const actionModal=page.getByRole('form',{name:'SFTP file action'});
      await actionModal.waitFor();
      await actionModal.locator('input').fill('backups');
      await actionModal.getByRole('button',{name:'Confirm',exact:true}).click();
      await remotePane.locator('.commander-file').filter({hasText:'backups'}).waitFor();
      assert.equal(await page.evaluate(()=>window.__lastSftpAction?.operation),'mkdir');
      await remotePane.locator('.commander-file').filter({hasText:'notes.txt'}).click({button:'right'});
      await page.getByRole('menu').getByRole('button',{name:'Rename',exact:true}).click();
      await actionModal.locator('input').fill('report.txt');
      await actionModal.getByRole('button',{name:'Confirm',exact:true}).click();
      await remotePane.locator('.commander-file').filter({hasText:'report.txt'}).waitFor();
      assert.equal(await page.evaluate(()=>window.__lastSftpAction?.operation),'rename');
      await remotePane.locator('.commander-file').filter({hasText:'report.txt'}).click({button:'right'});
      await page.getByRole('menu').getByRole('button',{name:'Delete',exact:true}).click();
      await page.getByText('This cannot be undone.',{exact:false}).waitFor();
      await actionModal.getByRole('button',{name:'Confirm',exact:true}).click();
      await page.waitForFunction(()=>![...document.querySelectorAll('.commander-file')].some(e=>e.textContent.includes('report.txt')));
      assert.equal(await page.evaluate(()=>window.__lastSftpAction?.operation),'delete');
      assert.equal(errors.length,0,'SFTP and RDP must not throw: '+errors.join(' | '));
      await page.locator('.title-tabs .title-tab-home').click();
      // Many active sessions require scrollable tabs, and selection should
      // keep the widened active tab visible without horizontal page overflow.
      for(let i=0;i<6;i++){
        await page.locator('.host-card').filter({hasText:'Production gateway'}).dblclick();
        await page.locator('.title-tabs .title-tab-home').click();
      }
      const rail=page.locator('.title-tabs');
      assert.ok(await page.locator('.title-tabs .title-tab').count()>=8,
        'Session tabs should be created without replacing previous tabs');
      await page.locator('.title-tabs .title-tab').last().click();
      await page.waitForTimeout(650);
      const overflowTabs=await rail.evaluate(el=>{
        const active=el.querySelector('.title-tab.active');
        const a=active.getBoundingClientRect(),r=el.getBoundingClientRect();
        return {scroll:el.scrollWidth,visible:el.clientWidth,activeLeft:a.left,
          activeRight:a.right,railLeft:r.left,railRight:r.right};
      });
      assert.ok(overflowTabs.scroll>overflowTabs.visible,
        'Many open tabs should scroll inside the titlebar instead of shrinking to illegibility');
      assert.ok(overflowTabs.activeLeft>=overflowTabs.railLeft-3 &&
        overflowTabs.activeRight<=overflowTabs.railRight+3,
        'Expanded current tab must scroll into the visible part of the titlebar: '+JSON.stringify(overflowTabs));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),0);
      // Reorder two existing tabs. Session identity and the current terminal must
      // remain stable; drag-and-drop must never call SSH disconnect/connect.
      const tab3=page.getByRole('tab',{name:'Server 3'});
      const tab8=page.getByRole('tab',{name:'Server 8'});
      const order=()=>page.locator('.title-tabs>.title-tab').evaluateAll(tabs=>
        tabs.map(tab=>tab.getAttribute('aria-label')));
      const beforeDrag=await order();
      const disconnectBefore=await page.evaluate(()=>window.__disconnected||[]);
      await tab8.dragTo(tab3,{timeout:7000});
      await page.waitForTimeout(380);
      const afterDrag=await order();
      assert.notDeepEqual(afterDrag,beforeDrag,'Dragging a tab changes session order: '+
        JSON.stringify({beforeDrag,afterDrag}));
      assert.ok(afterDrag.indexOf('Server 8')<afterDrag.indexOf('Server 3'),
        'Dragged tab moved before target');
      assert.deepEqual(await page.evaluate(()=>window.__disconnected||[]),disconnectBefore,
        'Reordering tabs must not disconnect sessions');
      // Ctrl+Tab switches from the active tab, including when there are many.
      await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{
        key:'Tab',ctrlKey:true,bubbles:true,cancelable:true
      })));
      assert.equal(await page.locator('.title-tabs>.title-tab.active').count(),1,
        'Ctrl+Tab must preserve one selected tab');
      await tab3.click({button:'right',timeout:7000});
      await page.getByRole('menu',{name:'Actions for tab Server 3'}).waitFor();
      assert.equal(await page.getByRole('menuitem',{name:'Close other tabs'}).isEnabled(),true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.tab-context-menu').count(),0,
        'Escape closes tab context menu');
      const totalBeforeMiddle=await page.locator('.title-tabs>.title-tab').count();
      await tab8.click({button:'middle',timeout:7000});
      await page.waitForFunction(prev=>
        document.querySelectorAll('.title-tabs>.title-tab').length===prev-1,
        totalBeforeMiddle);
      assert.equal(await page.getByRole('tab',{name:'Server 8'}).count(),0,
        'Middle mouse button closes only clicked session tab');
      assert.equal(errors.length,0,'Session tab actions must not throw: '+errors.join(' | '));
      summary.push({viewport:width+'x'+height,...result});
      await page.close();
    }
    console.log(JSON.stringify(summary,null,2));
    console.log('UI_SMOKE_PASS');
  } finally{
    await browser.close();
    await new Promise(resolve=>server.httpServer.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
