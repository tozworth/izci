import init,{WebImageJob} from '../generated/libzci_web.js';
import {failure} from '../protocol.js';
const reader=new FileReaderSync();let file:File;
Object.assign(globalThis,{libzciRead:(id:number,position:number,length:number)=>{
  if(id!==1||length<0||length>32768)throw new Error('Invalid bounded image read');
  return new Uint8Array(reader.readAsArrayBuffer(file.slice(position,position+length)));
}});
self.onmessage=async event=>{
  try{
    if(file)throw new Error('Image worker already owns a job');
    file=event.data.file;if(!(file instanceof File))throw new Error('Image jobs require a real File');
    await init();const result=WebImageJob.run(1,file.size,JSON.stringify(event.data.request));
    try{const png=result.png();self.postMessage({result:{...JSON.parse(result.info()),png}},[png.buffer]);}
    finally{result.free();}
  }catch(error){self.postMessage({error:failure(error)});}
};
