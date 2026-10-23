export function installPwa(log:(s:string)=>void):void {
  if(!import.meta.env.PROD||!('serviceWorker' in navigator))return;
  const status=document.getElementById('pwa-status')!,update=document.getElementById('update')!,install=document.getElementById('install')!;
  let restarting=false;
  const version=document.querySelector<HTMLMetaElement>('meta[name="libzci-version"]')?.content;
  const report=()=>navigator.serviceWorker.controller?.postMessage({type:'client-version',version});
  addEventListener('pageshow',report);setInterval(report,30000);
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();install.hidden=false;install.onclick=()=>void (event as Event & {prompt():Promise<void>}).prompt().catch(e=>log(String(e)));});
  void navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(registration=>{
    status.textContent=navigator.onLine?'Offline assets registered':'Offline';
    report();
    const waiting=()=>void (async()=>{
      if(restarting)return;
      const current=await navigator.serviceWorker.getRegistration(),candidate=current?.waiting;
      if(!candidate||!current.active){update.hidden=true;return;}
      const identity=await new Promise<string|undefined>(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(undefined);},3000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data.version);};candidate.postMessage({type:'identify'},[channel.port2]);});
      // The first installation can briefly be waiting before automatic activation.
      // Only offer an actual different, fully installed candidate to the user.
      if(!identity||identity===version||candidate.state!=='installed'||restarting)return;
      update.hidden=false;status.textContent='Update ready; restart when playback can stop';
      update.onclick=()=>{if(candidate.state!=='installed'){waiting();return;}restarting=true;status.textContent='Restarting with update…';candidate.postMessage({type:'activate'});};
    })().catch(e=>log(String(e)));
    waiting();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',waiting));
    navigator.serviceWorker.addEventListener('controllerchange',()=>{report();if(restarting)location.reload();});
    if(navigator.onLine)void registration.update().catch(e=>{if(navigator.onLine)log(String(e));});
  }).catch(e=>{status.textContent=`Offline setup failed: ${String(e)}`;log(String(e));});
}
