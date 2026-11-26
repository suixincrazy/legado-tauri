use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, time::{Duration,Instant}, sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}, net::{TcpListener,IpAddr}};
use tauri::Manager;

const LIMIT: u64 = 512 * 1024 * 1024;
const CHUNK: usize = 256 * 1024;
#[derive(Default)]
pub struct LanSessions(Mutex<HashMap<String,Arc<AtomicBool>>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    operation: String,
    id: Option<String>,
    directory: Option<String>,
    name: Option<String>,
    hex: Option<String>,
    offset: Option<u64>,
    url: Option<String>,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    token: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    status: u16,
    body: String,
    size: u64,
}
fn safe_name(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 220 || value.contains(['/', '\\', ':']) || value == "." || value == ".." {
        return Err("Invalid backup filename".into());
    }
    Ok(value)
}
fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if value.len() > CHUNK * 2 || value.len() % 2 != 0 { return Err("Invalid backup chunk size".into()); }
    value.as_bytes().chunks_exact(2).map(|pair| {
        let text = std::str::from_utf8(pair).map_err(|_| "Invalid backup chunk")?;
        u8::from_str_radix(text, 16).map_err(|_| "Invalid backup chunk".to_string())
    }).collect()
}
fn directory(app: &tauri::AppHandle, requested: Option<&str>) -> Result<PathBuf, String> {
    match requested.filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = PathBuf::from(value);
            if !path.is_absolute() { return Err("Backup directory must be absolute".into()); }
            Ok(path)
        }
        None => app.path().document_dir().map(|p| p.join("Legado Backups")).map_err(|e| e.to_string()),
    }
}
fn file_info(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"name":path.file_name().and_then(|s|s.to_str()).unwrap_or(""),"size":metadata.len(),"modified":metadata.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis()).unwrap_or(0)}))
}

#[tauri::command]
pub async fn backup_transfer(app: tauri::AppHandle, request: Request) -> Result<Response, String> {
    let cache = app.path().app_cache_dir().map_err(|e|e.to_string())?.join("backup-transfer");
    fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
    let id = request.id.as_deref().unwrap_or("backup");
    if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') || id.len() > 80 || id.is_empty() { return Err("Invalid transfer identifier".into()); }
    let staged = cache.join(id);
    #[cfg(target_os = "android")]
    if request.directory.as_deref().is_some_and(|value|value.starts_with("content://")) {
        let payload=serde_json::json!({"operation":"backupDirectory","action":request.operation,"directory":request.directory,"name":request.name,"staged":staged});
        let result=crate::java_bridge(app,payload.to_string()).await?;
        let body:serde_json::Value=serde_json::from_str(result["json"].as_str().ok_or("Invalid backup directory response")?).map_err(|e|e.to_string())?;
        return Ok(Response{status:200,body:body["body"].as_str().unwrap_or("").into(),size:body["size"].as_u64().unwrap_or(0)});
    }
    #[cfg(target_os = "ios")]
    if request.directory.as_deref().is_some_and(|value|value.starts_with("bookmark:")) {
        let payload=serde_json::json!({"mode":"backupDirectory","action":request.operation,"directory":request.directory,"name":request.name,"staged":staged});
        let result=tauri_plugin_source_browser::open(app,payload).await?;
        let body:serde_json::Value=serde_json::from_str(result["json"].as_str().ok_or("Invalid backup directory response")?).map_err(|e|e.to_string())?;
        return Ok(Response{status:200,body:body["body"].as_str().unwrap_or("").into(),size:body["size"].as_u64().unwrap_or(0)});
    }
    let ok = |body:String,size:u64| Ok(Response {status:200,body,size});
    match request.operation.as_str() {
        "lanStop" => {
            if let Some(stop)=app.state::<LanSessions>().0.lock().map_err(|e|e.to_string())?.remove(id){stop.store(true,Ordering::Relaxed);}
            ok(String::new(),0)
        }
        "lanStart" => {
            let token=request.token.ok_or("Missing LAN session token")?;
            if token.len()!=32||!token.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Invalid LAN session token".into());}
            let size=fs::metadata(&staged).map_err(|e|e.to_string())?.len();if !(17..=32*1024*1024).contains(&size){return Err("LAN backup exceeds 32 MiB".into());}
            let hosts:Vec<String>=if_addrs::get_if_addrs().map_err(|e|e.to_string())?.into_iter().filter_map(|interface|match interface.ip(){IpAddr::V4(ip) if ip.is_private()&&!ip.is_loopback()=>Some(ip.to_string()),_=>None}).collect();
            if hosts.is_empty(){return Err("未找到可用的局域网地址".into());}
            let listener=TcpListener::bind("0.0.0.0:0").map_err(|e|e.to_string())?;
            let port=listener.local_addr().map_err(|e|e.to_string())?.port();listener.set_nonblocking(true).map_err(|e|e.to_string())?;
            let stop=Arc::new(AtomicBool::new(false));
            app.state::<LanSessions>().0.lock().map_err(|e|e.to_string())?.insert(id.into(),stop.clone());
            std::thread::spawn(move||{
                let start=Instant::now();
                while !stop.load(Ordering::Relaxed)&&start.elapsed()<Duration::from_secs(300){
                    let Ok((mut stream,_))=listener.accept()else{std::thread::sleep(Duration::from_millis(100));continue;};
                    let _=stream.set_read_timeout(Some(Duration::from_secs(5)));let _=stream.set_write_timeout(Some(Duration::from_secs(30)));
                    let mut bytes=[0u8;8192];let mut count=0;
                    while count<bytes.len(){match stream.read(&mut bytes[count..]){Ok(0)|Err(_)=>break,Ok(n)=>count+=n}if bytes[..count].windows(4).any(|part|part==b"\r\n\r\n"){break;}}
                    let line=String::from_utf8_lossy(&bytes[..count]);
                    if !line.starts_with(&format!("GET /backup/{token} HTTP/1.")){let _=stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");continue;}
                    if let Ok(mut file)=fs::File::open(&staged){
                        let header=format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nContent-Type: application/octet-stream\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
                        if stream.write_all(header.as_bytes()).is_ok(){let _=std::io::copy(&mut file,&mut stream);}
                    }
                }
                let _=fs::remove_file(staged);
            });
            ok(serde_json::json!({"hosts":hosts.into_iter().take(8).collect::<Vec<_>>(),"port":port}).to_string(),size)
        }
        "write" => {
            let offset=request.offset.unwrap_or(0);
            let bytes=decode_hex(request.hex.as_deref().unwrap_or(""))?;
            if offset + bytes.len() as u64 > LIMIT { return Err("Backup exceeds 512 MiB".into()); }
            let mut file=OpenOptions::new().write(true).create(offset==0).truncate(offset==0).open(&staged).map_err(|e|e.to_string())?;
            if offset>0 && file.metadata().map_err(|e|e.to_string())?.len()!=offset { return Err("Backup chunk is out of sequence".into()); }
            file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
            file.write_all(&bytes).map_err(|e|e.to_string())?;
            ok(String::new(),offset+bytes.len() as u64)
        }
        "read" => {
            let mut file=fs::File::open(&staged).map_err(|e|e.to_string())?;
            let size=file.metadata().map_err(|e|e.to_string())?.len();
            file.seek(SeekFrom::Start(request.offset.unwrap_or(0))).map_err(|e|e.to_string())?;
            let mut data=vec![0u8;CHUNK];let count=file.read(&mut data).map_err(|e|e.to_string())?;
            ok(data[..count].iter().map(|b|format!("{b:02x}")).collect(),size)
        }
        "discard" => { if staged.exists(){fs::remove_file(&staged).map_err(|e|e.to_string())?;} ok(String::new(),0) }
        "localList" | "legacyList" => {
            let root=directory(&app,request.directory.as_deref())?;fs::create_dir_all(&root).map_err(|e|e.to_string())?;
            let mut files=Vec::new();
            for item in fs::read_dir(&root).map_err(|e|e.to_string())? {
                let path=item.map_err(|e|e.to_string())?.path();
                if path.is_file()&&path.file_name().and_then(|n|n.to_str()).is_some_and(|n|if request.operation=="legacyList"{["myBookShelf.json","myBookSource.json","myBookReplaceRule.json"].contains(&n)}else{n.starts_with("backup")&&n.ends_with(".zip")}){files.push(file_info(&path)?);}
            }
            ok(serde_json::json!({"directory":root,"files":files}).to_string(),0)
        }
        "localSave" | "localLoad" | "localDelete" => {
            let root=directory(&app,request.directory.as_deref())?;
            let name=safe_name(request.name.as_deref().unwrap_or(""))?;
            let target=root.join(name);
            if request.operation=="localDelete" {fs::remove_file(target).map_err(|e|e.to_string())?;return ok(String::new(),0);}
            if request.operation=="localLoad" {
                let size=fs::metadata(&target).map_err(|e|e.to_string())?.len();
                if size>LIMIT{return Err("Backup exceeds 512 MiB".into());}
                fs::copy(target,&staged).map_err(|e|e.to_string())?;return ok(String::new(),size);
            }
            fs::create_dir_all(&root).map_err(|e|e.to_string())?;
            let pending=root.join(format!(".{id}.tmp"));
            let size=fs::copy(&staged,&pending).map_err(|e|e.to_string())?;
            // Replacement is atomic on the mobile platforms; retain the previous file on failure.
            fs::rename(&pending,&target).map_err(|e| {let _=fs::remove_file(&pending);e.to_string()})?;
            ok(target.to_string_lossy().to_string(),size)
        }
        "request" => {
            let url=url::Url::parse(request.url.as_deref().unwrap_or("")).map_err(|_|"Invalid WebDAV URL")?;
            if !matches!(url.scheme(),"http"|"https")||!url.username().is_empty()||url.password().is_some(){return Err("Invalid WebDAV URL".into());}
            let method=request.method.as_deref().unwrap_or("PROPFIND");
            if !matches!(method,"PROPFIND"|"MKCOL"|"PUT"|"GET"|"DELETE"|"HEAD"){return Err("Unsupported WebDAV method".into());}
            let client=reqwest::Client::builder().timeout(Duration::from_secs(300)).connect_timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Could not create WebDAV connection")?;
            let mut builder=client.request(method.parse::<reqwest::Method>().map_err(|_|"Invalid method")?,url);
            for(key,value)in request.headers.unwrap_or_default(){builder=builder.header(key,value);}
            if method=="PUT" {
                let file=tokio::fs::File::open(&staged).await.map_err(|e|e.to_string())?;
                let size=file.metadata().await.map_err(|e|e.to_string())?.len();
                builder=builder.header(reqwest::header::CONTENT_LENGTH,size).body(reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file)));
            }else if let Some(body)=request.body{builder=builder.body(body);}
            let mut response=builder.send().await.map_err(|e|if e.is_timeout(){"WebDAV connection timed out"}else{"WebDAV connection failed; check the address, network and certificate"}.to_string())?;
            let status=response.status().as_u16();
            if method=="GET"&&response.status().is_success(){
                let mut file=fs::File::create(&staged).map_err(|e|e.to_string())?;let mut size=0;
                while let Some(chunk)=response.chunk().await.map_err(|_|"WebDAV download interrupted")?{
                    size+=chunk.len()as u64;if size>LIMIT{return Err("Backup exceeds 512 MiB".into());}file.write_all(&chunk).map_err(|e|e.to_string())?;
                }
                return Ok(Response{status,body:String::new(),size});
            }
            let mut bytes=Vec::new();
            while let Some(chunk)=response.chunk().await.map_err(|_|"WebDAV response interrupted")?{
                if bytes.len()+chunk.len()>8*1024*1024{return Err("WebDAV directory response is too large".into());}bytes.extend_from_slice(&chunk);
            }
            Ok(Response{status,body:String::from_utf8_lossy(&bytes).to_string(),size:bytes.len()as u64})
        }
        _ => Err("Unknown backup operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn rejects_paths_and_bad_chunks(){
        assert!(safe_name("../backup.zip").is_err());assert!(safe_name("C:\\backup.zip").is_err());assert!(safe_name("backup测试.zip").is_ok());
        assert_eq!(decode_hex("00ff807f").unwrap(),vec![0,255,128,127]);assert!(decode_hex("abg0").is_err());assert!(decode_hex("abc").is_err());
    }
}
