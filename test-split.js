const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
(async()=>{
 const port = await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zhidao-api-test-'));
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),API_MOCK:'true',CACHE_BACKEND:'local',CACHE_DIR:tmp,USER_STORE_DIR:path.join(tmp,'users'),CARD_STORE_DIR:path.join(tmp,'cards'),STATIC_DIR:'',CORS_ORIGINS:'http://localhost:8080'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const base=`http://127.0.0.1:${port}`;
 try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'API did not start: '+logs);
  const health=await (await fetch(base+'/api/health')).json();assert.equal(health.ok,true);assert.equal(health.mock,true);assert.equal(health.face.ready,null);
  assert.equal((await fetch(base+'/')).status,404);
  assert.equal((await fetch(base+'/server.js')).status,404);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/api/grades')).status,200);
  const pre=await fetch(base+'/api/tutor',{method:'OPTIONS',headers:{Origin:'http://localhost:8080','Access-Control-Request-Method':'POST'}});
  assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'http://localhost:8080');
  const tutor=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'开心',subject:'chinese',grade:'小学一年级'})});
  assert.equal(tutor.status,200);assert.ok(await tutor.json());
  console.log('API split smoke tests passed (mock, API-only, CORS, grades, tutor).');
 } finally {child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
