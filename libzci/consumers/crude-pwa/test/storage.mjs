import {chromium} from 'playwright';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));const server=await createServer({root,server:{port:5197,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
try {const page=await browser.newPage();await page.goto('http://localhost:5197/test/reference.html');
  const result=await page.evaluate(()=>new Promise(resolve=>{const worker=new Worker('/test/storage-worker.ts',{type:'module'});worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=e=>resolve({error:e.message});worker.postMessage(null);}));
  assert(!result.error,result.error);console.log(result);await writeFile(new URL('../../../../.local/libzci/m2-storage-evidence.json',import.meta.url),JSON.stringify(result,null,2));
}finally{await browser.close();await server.close();}
