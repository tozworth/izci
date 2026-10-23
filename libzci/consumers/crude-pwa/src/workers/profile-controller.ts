import {openProfile} from './profile-storage.js';
import {Capabilities} from '../capabilities.js';
import type {ProfileState,QueueCommand,QueueLoad,RealFileHandle,SourceReference} from '../profile-types.js';
import type {WebProfile} from '../generated/libzci_web.js';
export class ProfileController {
  private cached:ProfileState|undefined;
  private files=new Map<string,File>();
  private epoch=0;
  access='';
  private constructor(private core:WebProfile,private handles:Capabilities,private load:(file:File,options:QueueLoad)=>void,private stop:()=>void,private settings:(volume:number,mute:boolean)=>void,private publish:()=>void) {}
  static async open(name:string,load:(file:File,options:QueueLoad)=>void,stop:()=>void,settings:(volume:number,mute:boolean)=>void,publish:()=>void):Promise<ProfileController> {
    const core=await openProfile(name),handles=new Capabilities(name);
    const controller=new ProfileController(core,handles,load,stop,settings,publish);
    await handles.recover(new Set(controller.snapshot().sources.filter(s=>s.kind==='browser_handle').map(s=>s.locator)));
    await controller.restore();return controller;
  }
  snapshot():ProfileState {return this.cached??=JSON.parse(this.core.snapshot()) as ProfileState;}
  private request(command:QueueCommand,request?:string) {const result=JSON.parse(this.core.request(JSON.stringify(command),request)) as {appended:number[];load:QueueLoad|null;stop:boolean;duplicate:boolean};this.cached=undefined;return result;}
  async restore():Promise<void> {const load:QueueLoad|null=JSON.parse(this.core.restore());if(load)await this.materialize(load);}
  private async materialize(load:QueueLoad):Promise<void> {
    this.stop();
    const epoch=++this.epoch;this.access='checking';this.publish();
    try {
      const file=load.source.kind==='browser_handle'?await this.handles.resolve(load.source.locator):this.files.get(load.source.key);
      if(epoch!==this.epoch)return;
      if(!file)throw {kind:'non-restorable',detail:'Plain File selection; choose it again after reload'};
      this.access='granted';this.load(file,load);
    }catch(e){if(epoch!==this.epoch)return;this.access=`${(e as {kind?:string}).kind??'unavailable'}: ${(e as {detail?:string}).detail??String(e)}`;}
    this.publish();
  }
  async command(command:QueueCommand,request?:string):Promise<{appended:number[];load:QueueLoad|null;duplicate:boolean}> {
    const outcome=this.request(command,request);
    if(outcome.stop){++this.epoch;this.stop();}
    const s=this.snapshot();this.settings(s.settings.volume,s.settings.mute);this.publish();
    if(!s.queue.current)this.access='no selected source';
    if(outcome.load)await this.materialize(outcome.load);
    if(command.kind==='remove') {
      await this.handles.recover(new Set(s.sources.filter(r=>r.kind==='browser_handle').map(r=>r.locator)));
      for(const key of this.files.keys())if(!s.sources.some(r=>r.key===key))this.files.delete(key);
    }
    return outcome;
  }
  async ingest(files:File[],handles:RealFileHandle[]=[],open=true,request=crypto.randomUUID()):Promise<void> {
    if(!files.length||files.length>10000||handles.length&&handles.length!==files.length)throw new Error('Invalid source batch');
    const sources:SourceReference[]=[];
    for(const file of files) {
      const handle=handles[sources.length];const key=`${request}/${sources.length}`;if(handle)await this.handles.stage(handle,key);
      sources.push({key,kind:handle?'browser_handle':'ephemeral',locator:key,display_path:file.name});
    }
    // Files become reachable only after the durable SQL reference commit.
    const append=await this.command({kind:'append',sources},`${request}/append`);
    sources.forEach((s,n)=>this.files.set(s.key,files[n]!));
    for(const s of sources)if(s.kind==='browser_handle')await this.handles.complete(s.locator);
    if(open&&sources.length) {
      const id=append.appended[0]!;
      const outcome=this.request({kind:'play',id},`${request}/select`);
      if(outcome.load){outcome.load.autoplay=false;await this.materialize(outcome.load);}
    }
    this.publish();
  }
}
