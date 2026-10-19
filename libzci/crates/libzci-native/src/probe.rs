//! Independent cancellable metadata/pattern job; no audio output is constructed.
use libzci::*;
use crate::NativeRuntime;
use std::sync::mpsc::{self, Receiver, TryRecvError};
pub struct ProbeJob { cancel: CancelFlag, result: Receiver<Result<Inspection>> }
impl ProbeJob {
    pub fn cancel(&self) { self.cancel.cancel(); }
    pub fn poll(&self) -> Option<Result<Inspection>> {
        match self.result.try_recv() {
            Ok(r) => Some(r), Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(LibzciError::Cancelled)),
        }
    }
}
impl Drop for ProbeJob { fn drop(&mut self) { self.cancel(); } }
impl NativeRuntime {
    pub fn start_probe(&self, source: SourceId, hint: Option<&str>, verify_unknown: bool, parent: &CancelFlag) -> Result<ProbeJob> {
        let source = self.get_source(source).ok_or_else(|| LibzciError::Unavailable { detail: "unknown source".into() })?;
        let registry = self.registry_snapshot();
        let hint = hint.map(str::to_owned);
        let cancel = CancelFlag::child_of(parent); let worker = cancel.clone();
        let (tx,result) = mpsc::sync_channel(1);
        std::thread::Builder::new().name("libzci-probe".into()).spawn(move || {
            let _ = tx.send(registry.inspect(source,hint.as_deref(),verify_unknown,&worker));
        }).map_err(|e| LibzciError::ResourceExhausted { detail: e.to_string() })?;
        Ok(ProbeJob { cancel,result })
    }
}
