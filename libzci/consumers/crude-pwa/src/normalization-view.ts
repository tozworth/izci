import type {Observation} from './runtime.js';
import type {BrowserRuntime} from './browser-runtime.js';
import type {ReplayGainSettings} from './profile-types.js';
let rendered='';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const numbers=['preamp_db','missing_gain_db','r128_target_lufs'] as const;
const flags=['fallback','prevent_clipping'] as const;
export function normalizationView(o:Observation,runtime:BrowserRuntime,log:(s:string)=>void):void {
  if(!o.profile)return;
  const {settings}=o.profile,rg=settings.replay_gain,n=o.snapshot.normalization;
  el('normalization-status').textContent=`${n.origin}: ${n.gain_db.toFixed(2)} dB · ×${n.linear.toFixed(4)}${n.clipping_limited?' · peak limited':''}`;
  el('normalization-apply').onclick=()=>{
    const next:ReplayGainSettings={...rg,mode:el<HTMLSelectElement>('normalization-mode').value as ReplayGainSettings['mode']};
    for(const key of numbers)next[key]=Number(el<HTMLInputElement>(`normalization-${key}`).value);
    for(const key of flags)next[key]=el<HTMLInputElement>(`normalization-${key}`).checked;
    void runtime.queue({kind:'settings',settings:{...settings,replay_gain:next}}).catch(e=>log(String(e)));
  };
  const key=JSON.stringify(rg);if(key===rendered)return;rendered=key;
  el<HTMLSelectElement>('normalization-mode').value=rg.mode;
  for(const name of numbers)el<HTMLInputElement>(`normalization-${name}`).value=String(rg[name]);
  for(const name of flags)el<HTMLInputElement>(`normalization-${name}`).checked=rg[name];
}
