import type {BrowserRuntime} from './browser-runtime.js';
import type {CatalogCommand,CatalogQuery,CatalogRow,CatalogGroupBy,ManagedRoot} from './catalog-types.js';
import type {Observation} from './runtime.js';
import type {RealDirectoryHandle,RealFileHandle} from './profile-types.js';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
/** Reference presentation: queries and commands only. */
export class CatalogView {
  private revision=-1;
  private offset=0;
  private epoch=0;
  private selected:CatalogRow|null=null;
  private filter:Pick<CatalogQuery,'artist'|'album'|'genre'|'kind'>={};
  constructor(private runtime:BrowserRuntime,private log:(message:string)=>void){
    element('catalog-refresh').onclick=()=>this.refresh();
    element('catalog-group').onchange=()=>{this.filter={};this.offset=0;this.refresh();};
    element('catalog-group-clear').onclick=()=>{this.filter={};this.offset=0;this.refresh();};
    for(const id of ['catalog-collection','catalog-search','catalog-sort','catalog-descending','catalog-subsong'])element(id).onchange=()=>{this.offset=0;this.refresh();};
    element('catalog-prev').onclick=()=>{this.offset=Math.max(0,this.offset-100);this.refresh();};
    element('catalog-next').onclick=()=>{this.offset+=100;this.refresh();};
    element('catalog-cancel').onclick=()=>this.run(this.runtime.catalogCancel());
    element('catalog-add-files').onclick=()=>this.run(this.runtime.catalogAddFiles(Array.from(element<HTMLInputElement>('file').files??[]),[],element<HTMLInputElement>('verify-unknown').checked));
    element('catalog-add-handles').onclick=()=>this.run((async()=>{
      const picker=(window as unknown as {showOpenFilePicker?:(o:unknown)=>Promise<RealFileHandle[]>}).showOpenFilePicker;
      if(!picker)throw new Error('File System Access picker unavailable');
      const handles=await picker({multiple:true});await this.runtime.catalogAddFiles(await Promise.all(handles.map(h=>h.getFile())),handles,element<HTMLInputElement>('verify-unknown').checked);
    })());
    element('catalog-add-root').onclick=()=>this.run((async()=>{
      const picker=(window as unknown as {showDirectoryPicker?:()=>Promise<RealDirectoryHandle>}).showDirectoryPicker;
      if(!picker)throw new Error('Directory picker unavailable');
      const result=await this.runtime.catalogAddRoot(await picker());await this.runtime.catalogScan(result.root!);
    })());
    element('catalog-bookmark-add').onclick=()=>{
      if(this.selected)this.mutate({kind:'bookmark',media:this.selected.id,subsong:this.subsong(),position_seconds:Number(element<HTMLInputElement>('catalog-bookmark-position').value),label:element<HTMLInputElement>('catalog-bookmark-label').value});
    };
  }
  private run(promise:Promise<unknown>):void{void promise.catch(e=>this.log(String(e)));}
  private mutate(command:CatalogCommand):void{this.run(this.runtime.catalogMutate(command).then(()=>this.refresh()));}
  private subsong():number|null{const value=element<HTMLInputElement>('catalog-subsong').value;return value===''?null:Number(value);}
  observe(observation:Observation):void{
    const scan=observation.scan;
    element('catalog-scan-status').textContent=scan?`${scan.state} · visited ${scan.visited} · accepted ${scan.accepted} · ignored ${scan.ignored} · ${scan.detail}`:'';
    if(observation.profile&&observation.profile.catalog_revision!==this.revision){this.revision=observation.profile.catalog_revision;this.refresh();}
  }
  refresh():void{
    const epoch=++this.epoch;
    const query:CatalogQuery={collection:element<HTMLSelectElement>('catalog-collection').value as CatalogQuery['collection'],search:element<HTMLInputElement>('catalog-search').value,sort:element<HTMLSelectElement>('catalog-sort').value as CatalogQuery['sort'],descending:element<HTMLInputElement>('catalog-descending').checked,offset:this.offset,limit:100};
    const song=this.subsong();if(song!==null)query.subsong=song;
    Object.assign(query,this.filter);
    const by=element<HTMLSelectElement>('catalog-group').value as CatalogGroupBy|'';
    this.run(Promise.all([this.runtime.catalogQuery(query),this.runtime.catalogRoots(),by?this.runtime.catalogGroups(by,query):Promise.resolve(null)]).then(([page,roots,groups])=>{
      if(epoch!==this.epoch)return;
      element('catalog-page').textContent=`${page.total} items · revision ${page.revision} · offset ${this.offset}`;
      element('catalog-rows').replaceChildren(...page.rows.map(row=>this.row(row)));
      element('catalog-roots').replaceChildren(...roots.map(root=>this.root(root)));
      element('catalog-groups').replaceChildren(...groups?.groups.map(group=>this.button(`${group.key.map(v=>v||'Unknown').join(' / ')} (${group.count})`,()=>{
        this.filter=by==='album'?{artist:group.key[0],album:group.key[1]}:by==='artist'?{artist:group.key[0]}:by==='genre'?{genre:group.key[0]}:{kind:group.key[0] as CatalogQuery['kind']};this.offset=0;this.refresh();
      }))??[]);
      if(this.selected){const updated=page.rows.find(r=>r.id===this.selected!.id);if(updated)this.selected=updated;this.details();}
    }));
  }
  private button(label:string,action:()=>void):HTMLButtonElement{const button=document.createElement('button');button.textContent=label;button.onclick=action;return button;}
  private row(row:CatalogRow):HTMLTableRowElement{
    const tr=document.createElement('tr');
    const cell=(value:string)=>{const td=document.createElement('td');td.textContent=value;tr.append(td);return td;};
    cell(`${row.metadata.title} · ${row.metadata.artist}`).append(this.button('Details',()=>{this.selected=row;this.details();}));
    cell(row.source.display_path);const controls=cell('');
    if(row.kind!=='image')controls.append(this.button('Append to Queue',()=>this.run(this.runtime.queue({kind:'append',sources:[row.source]}))));
    controls.append(this.button(row.facts.favorite?'Unfavorite':'Favorite',()=>this.mutate({kind:'favorite',media:row.id,subsong:this.subsong(),favorite:!row.facts.favorite})));
    const rating=document.createElement('input');rating.type='number';rating.min='0';rating.max='10';rating.step='1';rating.value=String(row.facts.rating);rating.title='Rating in half-star steps (0 clears)';rating.style.width='45px';rating.onchange=()=>this.mutate({kind:'rate',media:row.id,subsong:this.subsong(),rating:Number(rating.value)});controls.append(rating,this.button('Remove',()=>this.mutate({kind:'remove',media:[row.id]})));return tr;
  }
  private root(root:ManagedRoot):HTMLElement{
    const div=document.createElement('div');div.append(document.createTextNode(root.config.source.display_path+' '));
    div.append(this.button('Rescan',()=>this.run(this.runtime.catalogScan(root.id))),this.button('Grant access',()=>this.run(this.runtime.grantCapability(root.config.source.locator))),this.button('Remove root',()=>this.mutate({kind:'remove_root',root:root.id})));
    for(const [key,text] of [['recursive','Recursive'],['scan_on_launch','At launch'],['verify_unknown','Verify unknown']] as const){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=root.config.settings[key];input.onchange=()=>this.mutate({kind:'root',root:{...root.config,settings:{...root.config.settings,[key]:input.checked}}});label.append(input,document.createTextNode(text));div.append(label);
    }
    const count=document.createElement('input');count.type='number';count.min='1';count.max='8';count.value=String(root.config.settings.probe_concurrency);count.title='Concurrent probes (1–8)';count.style.width='40px';count.onchange=()=>this.mutate({kind:'root',root:{...root.config,settings:{...root.config.settings,probe_concurrency:Number(count.value)}}});div.append(count);return div;
  }
  private details():void{
    const row=this.selected;if(!row)return;
    element('catalog-details').textContent=JSON.stringify({id:row.id,path:row.source.display_path,metadata:row.metadata,facts:row.facts},null,2);
    this.run(this.runtime.catalogBookmarks(row.id,this.subsong()).then(markers=>{
      if(this.selected?.id!==row.id)return;
      element('catalog-bookmarks').replaceChildren(...markers.map(m=>this.button(`${m.label} @ ${m.position_seconds}s · Remove`,()=>this.mutate({kind:'remove_bookmark',id:m.id}))));
    }));
  }
}
