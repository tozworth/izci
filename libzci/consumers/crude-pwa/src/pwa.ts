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
    const waiting=()=>{if(registration.waiting){update.hidden=false;status.textContent='Update ready; restart when playback can stop';update.onclick=()=>{restarting=true;registration.waiting?.postMessage({type:'activate'});};}};
    waiting();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',waiting));
    navigator.serviceWorker.addEventListener('controllerchange',()=>{report();if(restarting)location.reload();});
    void registration.update().catch(e=>log(String(e)));
  }).catch(e=>{status.textContent=`Offline setup failed: ${String(e)}`;log(String(e));});
}
