//! Consumer assembly/jobs. Domain and transport decisions remain in libzci.
use libzci::*;
use libzci_native::{*,probe::ProbeJob,render::{RenderOptions,RenderStep}};
use std::{path::Path,sync::{Arc,mpsc::{self,Receiver}}};
pub struct Controller {
    pub runtime:Arc<NativeRuntime>,pub session:SessionId,pub source:Option<SourceId>,pub hint:Option<String>,
    output:Option<OutputId>,pub error:String,pub probe:Option<ProbeJob>,pub inspection:Option<Inspection>,
    pub render:Option<(CancelFlag,Receiver<Result<u64>>)>,pub render_status:String,
}
impl Controller {
    pub fn new()->Self {
        let runtime=NativeRuntime::new();
        runtime.register_provider(Arc::new(libzci_codecs::OpusFactory::default())).unwrap();
        runtime.register_provider(Arc::new(libzci_symphonia::SymphoniaFactory)).unwrap();
        runtime.register_provider(Arc::new(libzci_codecs::OpenmptFactory::default())).unwrap();
        runtime.register_provider(Arc::new(libzci_codecs::HivelyFactory::default())).unwrap();
        let session=runtime.create_session();
        Self {runtime,session,source:None,hint:None,output:None,error:String::new(),probe:None,inspection:None,render:None,render_status:String::new()}
    }
    pub fn open(&mut self,path:&Path) {
        let result=(||->Result<()> {
            let source=self.runtime.insert_source(Arc::new(NativeFileSource::open(path)?));
            let hint=path.extension().and_then(|s|s.to_str()).map(str::to_ascii_lowercase);
            self.runtime.submit(&Command::Load {session:self.session,request_id:RequestId::fresh(),source,extension_hint:hint.clone(),options:LoadOptions::default()},&CancelFlag::default())?;
            if let Some(old)=self.source.replace(source) {self.runtime.release_source(old);}
            self.hint=hint;Ok(())
        })();self.record(result);
    }
    pub fn command(&mut self,make:impl FnOnce(SessionId,RequestId)->Command) {
        let result=self.runtime.submit(&make(self.session,RequestId::fresh()),&CancelFlag::default()).map(|_|());self.record(result);
    }
    pub fn module(&mut self,control:ModuleControl) {self.command(|session,request_id|Command::Module {session,request_id,control});}
    pub fn snapshot(&self)->Snapshot {self.runtime.snapshot(self.session).unwrap()}
    fn record(&mut self,r:Result<()>) {match r {Ok(())=>self.error.clear(),Err(e)=>self.error=format!("{}: {e}",e.kind())}}
    pub fn tick(&mut self) {
        let s=self.snapshot();
        if self.output.is_none() && s.layout.is_some() && !s.pending_operation && s.error.is_none() {
            match self.runtime.start_output(self.session,&OutputSpec::default()) {Ok(id)=>self.output=Some(id),Err(e)=>self.error=e.to_string()}
        }
        if let Some(p)=&self.probe {if let Some(result)=p.poll() {
            match result {Ok(i)=>self.inspection=Some(i),Err(e)=>self.error=e.to_string()};self.probe=None;
        }}
        if let Some((_,rx))=&self.render {if let Ok(result)=rx.try_recv() {
            self.render_status=match result {Ok(n)=>format!("Rendered {n} stereo frames at 48000 Hz"),Err(e)=>e.to_string()};self.render=None;
        }}
    }
    pub fn inspect(&mut self,verify_unknown:bool) {
        if let Some(source)=self.source {let result=self.runtime.start_probe(source,self.hint.as_deref(),verify_unknown,&CancelFlag::default());
            match result {Ok(job)=>self.probe=Some(job),Err(e)=>self.error=e.to_string()}}
    }
    pub fn render(&mut self,path:&Path) {
        self.cancel_jobs();let Some(source)=self.source else {return};
        let runtime=self.runtime.clone();let hint=self.hint.clone();let path=path.to_owned();
        let cancel=CancelFlag::default();let token=cancel.clone();let (tx,rx)=mpsc::sync_channel(1);
        self.render=Some((cancel,rx));self.render_status="Rendering independent source…".into();
        std::thread::spawn(move|| {let result=(||->Result<u64>{
            use std::io::Write;
            let mut job=runtime.start_render(source,hint.as_deref(),RenderOptions::default(),&token)?;
            let mut file=std::fs::File::create(path).map_err(|e|LibzciError::Unavailable {detail:e.to_string()})?;
            loop {match job.next()? {
                RenderStep::Data {samples,..}=>{for sample in samples {file.write_all(&sample.to_le_bytes()).map_err(|e|LibzciError::Unavailable {detail:e.to_string()})?;}},
                RenderStep::Pending=>std::thread::yield_now(),RenderStep::Complete(result)=>return Ok(result.output_frames),
            }}
        })();let _=tx.send(result);});
    }
    pub fn cancel_jobs(&mut self) {self.probe=None;if let Some((c,_))=self.render.take() {c.cancel();self.render_status="Cancelled".into();}}
    pub fn dispose(&mut self) {
        self.cancel_jobs();self.runtime.dispose_session(self.session);self.output=None;
        if let Some(s)=self.source.take() {self.runtime.release_source(s);}self.session=self.runtime.create_session();
    }
    pub fn output(&self)->Option<OutputObservation> {self.output.and_then(|id|self.runtime.output_state(id))}
}
impl Drop for Controller {fn drop(&mut self) {self.cancel_jobs();self.runtime.dispose_session(self.session);}}
