use std::path::Path;
use windows::{
    core::HRESULT,
    Win32::{
        Foundation::{ERROR_CANCELLED, HWND},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            FileOpenDialog, IFileOpenDialog, FOS_ALLOWMULTISELECT, FOS_FORCEFILESYSTEM,
            FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
        },
    },
};

struct ComApartment;
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub fn pick_paths(owner: usize, folder: bool) -> Result<Option<Vec<String>>, String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() }
        .map_err(|error| error.to_string())?;
    let _apartment = ComApartment;
    let dialog: IFileOpenDialog =
        unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| error.to_string())?;
    let options = unsafe { dialog.GetOptions() }.map_err(|error| error.to_string())?
        | FOS_FORCEFILESYSTEM
        | if folder {
            FOS_PICKFOLDERS
        } else {
            FOS_ALLOWMULTISELECT
        };
    unsafe { dialog.SetOptions(options) }.map_err(|error| error.to_string())?;
    if let Err(error) = unsafe { dialog.Show(Some(HWND(owner as *mut _))) } {
        if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
            return Ok(None);
        }
        return Err(error.to_string());
    }
    let results = unsafe { dialog.GetResults() }.map_err(|error| error.to_string())?;
    let count = unsafe { results.GetCount() }.map_err(|error| error.to_string())?;
    let mut paths = Vec::new();
    for index in 0..count {
        let item = unsafe { results.GetItemAt(index) }.map_err(|error| error.to_string())?;
        let value =
            unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }.map_err(|error| error.to_string())?;
        let path = unsafe { value.to_string() };
        unsafe {
            CoTaskMemFree(Some(value.0.cast()));
        }
        paths.push(crate::native_filesystem::canonical_path(
            Path::new(&path.map_err(|error| error.to_string())?),
            folder,
        )?);
    }
    Ok(Some(paths))
}
