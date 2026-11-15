'use strict';
const {configFromEnv}=require('./lib/config.cjs');
const {createService}=require('./app.cjs');
(async()=>{
  const config=configFromEnv();
  const service=await createService({config});
  await new Promise((resolve,reject)=>{
    service.server.once('error',reject);service.server.listen(config.port,config.host,resolve);
  });
  console.log(JSON.stringify({event:'server_started',version:require('./package.json').version,port:config.port}));
  let stopping=false;
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
    await service.close();clearTimeout(deadline);process.exitCode=0;
  });
})().catch(error=>{
  // Startup errors describe configuration/filesystem failures, never request bodies.
  console.error('ShiroTerm Server could not start: '+error.message);process.exitCode=1;
});
