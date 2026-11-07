#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};
use tauri::{ipc::Response, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[cfg(test)]
mod tests;

const FILE_LIMIT: u64 = 20 * 1024 * 1024;

struct Grant {
    id: u32,
    root: PathBuf,
    paths: HashSet<String>,
}

#[derive(Default)]
struct Session {
    current: Mutex<Option<Arc<Grant>>>,
}

#[derive(Serialize)]
struct PickedSource {
    id: u32,
    name: String,
    documents: Vec<String>,
}

fn markdown(path: &Path) -> bool {
    matches!(extension(path).as_str(), "md" | "markdown")
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn visible(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        && !matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "__macosx" | "thumbs.db"
        )
}

fn excluded(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_REPARSE_POINT,
        };
        if metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        {
            return true;
        }
    }
    false
}

fn file_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "파일이 이동되었거나 삭제되었습니다. 다시 선택하세요.",
        io::ErrorKind::PermissionDenied => "파일 접근이 거부되었습니다. 접근 권한을 확인하세요.",
        _ => "파일을 읽을 수 없습니다. 파일 상태와 접근 권한을 확인하세요.",
    }
    .to_owned()
}

fn scan(root: &Path) -> Result<HashSet<String>, String> {
    let mut paths = HashSet::new();
    let mut pending = vec![(root.to_path_buf(), String::new())];
    while let Some((directory, prefix)) = pending.pop() {
        let actual = match fs::canonicalize(&directory) {
            Ok(actual) => actual,
            Err(error) if directory == root => return Err(file_error(error)),
            Err(_) => continue,
        };
        if actual != directory || !actual.starts_with(root) {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == root => return Err(file_error(error)),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str().filter(|name| visible(name)) else {
                continue;
            };
            let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if excluded(&metadata) {
                continue;
            }
            let relative = format!("{prefix}{name}");
            if metadata.is_dir() {
                pending.push((entry.path(), format!("{relative}/")));
            } else if metadata.is_file()
                && matches!(
                    extension(&entry.path()).as_str(),
                    "md" | "markdown" | "png" | "jpg" | "jpeg" | "gif" | "webp"
                )
            {
                paths.insert(relative);
            }
        }
    }
    Ok(paths)
}

fn prepare_source(app: &AppHandle, selected: &Path, folder: bool) -> Result<PickedSource, String> {
    let metadata = fs::symlink_metadata(selected).map_err(file_error)?;
    if excluded(&metadata) {
        return Err("숨김 파일, 심볼릭 링크 및 연결 지점은 열 수 없습니다.".into());
    }
    let canonical = fs::canonicalize(selected).map_err(file_error)?;
    let label = selected
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("선택한 폴더");
    let (root, paths) = if folder && metadata.is_dir() {
        let paths = scan(&canonical)?;
        (canonical, paths)
    } else if !folder && metadata.is_file() && markdown(&canonical) && visible(label) {
        let root = canonical
            .parent()
            .ok_or("선택한 파일의 폴더를 찾을 수 없습니다.")?;
        let basename = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("지원하지 않는 파일명입니다.")?;
        (root.to_path_buf(), HashSet::from([basename.to_owned()]))
    } else {
        return Err("Markdown 파일(.md, .markdown) 또는 문서 폴더를 선택하세요.".into());
    };
    let documents = paths
        .iter()
        .filter(|path| markdown(Path::new(path)))
        .cloned()
        .collect();
    let state = app.state::<Session>();
    let mut current = state
        .current
        .lock()
        .map_err(|_| "선택 상태를 불러올 수 없습니다.")?;
    let id = current.as_ref().map_or(1, |grant| grant.id.wrapping_add(1));
    *current = Some(Arc::new(Grant { id, root, paths }));
    Ok(PickedSource {
        id,
        name: if folder { label } else { "선택한 파일" }.into(),
        documents,
    })
}

#[tauri::command]
async fn choose_source(app: AppHandle, folder: bool) -> Result<Option<PickedSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let selected = if folder {
            dialog.blocking_pick_folder()
        } else {
            dialog
                .add_filter("Markdown", &["md", "markdown"])
                .blocking_pick_file()
        };
        selected
            .map(|path| {
                let path = path
                    .into_path()
                    .map_err(|_| "로컬 경로만 열 수 있습니다.")?;
                prepare_source(&app, &path, folder)
            })
            .transpose()
    })
    .await
    .map_err(|_| "파일 선택을 완료할 수 없습니다.")?
}

#[cfg(windows)]
fn opened_path(file: &File) -> io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let mut buffer = vec![0u16; 32768];
    let count = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if count == 0 {
        return Err(io::Error::last_os_error());
    }
    if count >= buffer.len() {
        return Err(io::Error::other("path too long"));
    }
    Ok(PathBuf::from(OsString::from_wide(&buffer[..count])))
}

fn read_granted(grant: &Grant, relative: &str, limit: u64) -> Result<Response, String> {
    if !grant.paths.contains(relative) {
        return Err("선택 범위에 해당 파일이 없습니다.".into());
    }
    let mut path = grant.root.clone();
    for name in relative.split('/') {
        if !visible(name) {
            return Err("허용되지 않은 파일 경로입니다.".into());
        }
        path.push(name);
        if excluded(&fs::symlink_metadata(&path).map_err(file_error)?) {
            return Err("숨김 파일 및 연결 지점은 열 수 없습니다.".into());
        }
    }
    let canonical = fs::canonicalize(&path).map_err(file_error)?;
    if canonical != path || !canonical.starts_with(&grant.root) {
        return Err("선택 범위를 벗어난 경로입니다.".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(&canonical).map_err(file_error)?;
    #[cfg(windows)]
    if opened_path(&file).map_err(file_error)? != canonical {
        return Err("선택 범위를 벗어난 경로입니다.".into());
    }
    let metadata = file.metadata().map_err(file_error)?;
    if !metadata.is_file() || excluded(&metadata) {
        return Err("일반 파일만 읽을 수 있습니다.".into());
    }
    let limit = limit.min(FILE_LIMIT);
    if metadata.len() > limit {
        return Err("파일 크기가 20 MiB를 초과합니다.".into());
    }
    let milliseconds = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |time| time.as_secs_f64() * 1000.0);
    let mut bytes = Vec::with_capacity(metadata.len() as usize + 8);
    bytes.extend_from_slice(&milliseconds.to_le_bytes());
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(file_error)?;
    if bytes.len() as u64 > limit + 8 {
        return Err("파일 크기가 20 MiB를 초과합니다.".into());
    }
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn read_selected_file(
    state: State<'_, Session>,
    id: u32,
    path: String,
    limit: u64,
) -> Result<Response, String> {
    let grant = state
        .current
        .lock()
        .map_err(|_| "선택 상태를 불러올 수 없습니다.")?
        .as_ref()
        .filter(|grant| grant.id == id)
        .cloned()
        .ok_or("파일이나 폴더를 다시 선택하세요.")?;
    tauri::async_runtime::spawn_blocking(move || read_granted(&grant, &path, limit))
        .await
        .map_err(|_| "파일 읽기를 완료할 수 없습니다.")?
}

fn main() {
    tauri::Builder::default()
        .manage(Session::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![choose_source, read_selected_file])
        .run(tauri::generate_context!())
        .expect("could not start Markdown Viewer");
}
