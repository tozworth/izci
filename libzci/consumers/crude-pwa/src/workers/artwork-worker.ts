import init,{WebArtwork} from '../generated/libzci_web.js';
import {failure} from '../protocol.js';
const reader=new FileReaderSync();let file:File;
Object.assign(globalThis,{libzciRead:(id:number,position:number,length:number)=>{
  if(id!==1||length<0||length>32768)throw new Error('Invalid bounded artwork read');
  return new Uint8Array(reader.readAsArrayBuffer(file.slice(position,position+length)));
}});
self.onmessage=async event=>{
  try{
    if(file)throw new Error('Artwork worker already owns a job');
    file=event.data.file;if(!(file instanceof File))throw new Error('Artwork requires a real File');
    await init();const resource=WebArtwork.from_source(1,file.size);
    if(!resource){self.postMessage({artwork:null});return;}
    try{const bytes=resource.bytes();self.postMessage({artwork:{info:JSON.parse(resource.info()),bytes}},[bytes.buffer]);}
    finally{resource.free();}
  }catch(error){self.postMessage({error:failure(error)});}
};
