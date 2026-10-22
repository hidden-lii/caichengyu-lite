//! 猜成语（精简版）后端。
//!
//! 前端（Vue + TS）承担全部解题逻辑；这里只负责「用户数据目录」里的文件读写，
//! 以及平台信息。词库索引、多音字表等只读资源随前端打包，经 `fetch` 读取，不走这里。

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

/// 用户数据目录里的相对路径。只允许普通路径段：拒绝绝对路径、`..`、盘符前缀和空路径，
/// 避免前端（或被注入的脚本）经由命令读写数据目录之外的文件。
fn safe_relative(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('\\') || name.contains('\0') {
        return Err(format!("非法的数据文件名：{name:?}"));
    }
    let path = Path::new(name);
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => return Err(format!("非法的数据文件名：{name:?}")),
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("非法的数据文件名：{name:?}"));
    }
    Ok(out)
}

/// 数据目录：缺省为系统的应用数据目录（macOS：`~/Library/Application Support/<identifier>/`）。
/// 环境变量 `CAICHENGYU_SUPPORT_DIR` 可重定向，用于验证 / 测试时不污染真实数据。
fn support_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("CAICHENGYU_SUPPORT_DIR").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn resolve(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(support_dir(app)?.join(safe_relative(name)?))
}

/// 先写同目录下的临时文件再改名：写到一半崩溃不会留下半个文件。
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("数据文件没有父目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("dat")
    ));
    {
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// 当前操作系统：`macos` / `windows` / `linux`。前端据此决定是否给红绿灯留位置等。
#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

/// 仅调试构建：读取环境变量 `CAICHENGYU_SCENE` / `CAICHENGYU_STYLE`，让验证脚本能在真实窗口里直接布置截图场景
/// 并临时指定主题（见前端 `src/dev/scenes.ts`）。发布构建恒为空。
#[derive(serde::Serialize)]
struct DebugEnv {
    scene: Option<String>,
    style: Option<String>,
}

#[tauri::command]
fn debug_env() -> DebugEnv {
    let read = |name: &str| {
        if cfg!(debug_assertions) {
            std::env::var(name).ok().filter(|v| !v.is_empty())
        } else {
            None
        }
    };
    DebugEnv {
        scene: read("CAICHENGYU_SCENE"),
        style: read("CAICHENGYU_STYLE"),
    }
}

/// 仅调试构建：把前端的一行诊断输出到标准错误（供验证脚本收取）。发布构建什么也不做。
#[tauri::command]
fn debug_log(message: String) {
    if cfg!(debug_assertions) {
        eprintln!("{message}");
    }
}

/// 用户数据目录的绝对路径（仅用于在界面里提示 / 排查问题）。
#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(support_dir(&app)?.to_string_lossy().into_owned())
}

/// 读文本文件；不存在返回 `None`。
#[tauri::command]
fn read_data(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = resolve(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取 {name} 失败：{e}")),
    }
}

/// 原子地写文本文件（自动建父目录）。
#[tauri::command]
fn write_data(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    write_atomic(&resolve(&app, &name)?, contents.as_bytes())
}

/// 读二进制文件，走 IPC 的原始字节通道（不经 JSON）。不存在时返回错误 `NOT_FOUND`。
#[tauri::command]
fn read_data_bytes(app: AppHandle, name: String) -> Result<Response, String> {
    let path = resolve(&app, &name)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("NOT_FOUND".into()),
        Err(e) => Err(format!("读取 {name} 失败：{e}")),
    }
}

/// 原子地写二进制文件。请求体是原始字节，文件名放在请求头 `x-name`（需 `encodeURIComponent`）。
#[tauri::command]
fn write_data_bytes(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_data_bytes 需要原始字节请求体".into());
    };
    let raw = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("缺少 x-name 请求头")?;
    let name = percent_decode(raw)?;
    write_atomic(&resolve(&app, &name)?, bytes)
}

/// 删除数据文件；不存在不算错。
#[tauri::command]
fn remove_data(app: AppHandle, name: String) -> Result<(), String> {
    match fs::remove_file(resolve(&app, &name)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 {name} 失败：{e}")),
    }
}

/// 改名（覆盖目标）。损坏的数据文件留档时用。
#[tauri::command]
fn rename_data(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let dest = resolve(&app, &to)?;
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    fs::rename(resolve(&app, &from)?, dest).map_err(|e| e.to_string())
}

/// 文件是否存在。
#[tauri::command]
fn data_exists(app: AppHandle, name: String) -> Result<bool, String> {
    Ok(resolve(&app, &name)?.is_file())
}

/// 只解 `encodeURIComponent` 产生的 `%XX`；其余字节原样保留。
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3).ok_or("x-name 编码不完整")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "x-name 编码非法")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "x-name 不是合法的 UTF-8".into())
}

pub fn run() {
    tauri::Builder::default()
        // 仅调试构建：把页面加载事件打到标准错误，便于确认窗口真的加载了随包前端
        .on_page_load(|_webview, payload| {
            if cfg!(debug_assertions) {
                eprintln!("CC_PAGE {:?} {}", payload.event(), payload.url());
            }
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            platform,
            debug_env,
            debug_log,
            data_dir,
            read_data,
            write_data,
            read_data_bytes,
            write_data_bytes,
            remove_data,
            rename_data,
            data_exists,
        ])
        .run(tauri::generate_context!())
        .expect("启动「猜成语」失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_relative_paths() {
        assert_eq!(
            safe_relative("settings.json").unwrap(),
            PathBuf::from("settings.json")
        );
        assert_eq!(
            safe_relative("cache/meta.json").unwrap(),
            PathBuf::from("cache").join("meta.json")
        );
    }

    #[test]
    fn rejects_escaping_or_odd_paths() {
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../../x",
            "a\\b",
            ".",
            "..",
            "./a.json",
            "a\0b",
        ] {
            assert!(safe_relative(bad).is_err(), "应拒绝 {bad:?}");
        }
    }

    #[test]
    fn percent_decode_handles_utf8() {
        assert_eq!(percent_decode("a%2Fb.json").unwrap(), "a/b.json");
        assert_eq!(percent_decode("%E7%8C%9C.json").unwrap(), "猜.json");
        assert!(percent_decode("%E7%8").is_err());
        assert!(percent_decode("%ZZ").is_err());
    }

    #[test]
    fn atomic_write_replaces_file_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("cc-lite-test-{}", std::process::id()));
        let file = dir.join("sub").join("data.json");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"two");
        let leftovers: Vec<_> = fs::read_dir(file.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(leftovers.len(), 1, "不应留下临时文件：{leftovers:?}");
        let _ = fs::remove_dir_all(&dir);
    }
}
