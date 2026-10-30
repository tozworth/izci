import init,{read_embedded_lyrics} from '../generated/libzci_web.js';
import {failure} from '../protocol.js';
const reader=new FileReaderSync();let file:File;
Object.assign(globalThis,{libzciRead:(id:number,position:number,length:number)=>{
  if(id!==1||length<0||length>32768)throw new Error('Invalid bounded lyric read');
  return new Uint8Array(reader.readAsArrayBuffer(file.slice(position,position+length)));
}});
self.onmessage=async event=>{
  try{
    if(file)throw new Error('Lyrics worker already owns a job');
    file=event.data.file;if(!(file instanceof File))throw new Error('Lyrics require a real File');
    await init();const document=read_embedded_lyrics(1,file.size);self.postMessage({document:document?JSON.parse(document):null});
  }catch(error){self.postMessage({error:failure(error)});}
};
