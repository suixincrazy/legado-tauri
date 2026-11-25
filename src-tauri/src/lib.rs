use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};

#[derive(Default)]
struct HttpClients(Mutex<HashMap<String, reqwest::Client>>);
fn http_client(cookies: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(30)).connect_timeout(Duration::from_secs(10))
        .cookie_store(cookies).user_agent("LegadoTauri/3.26.1125").build().map_err(|e| e.to_string())
}
#[tauri::command]
fn clear_source_cookies(source_key: String, clients: tauri::State<'_, HttpClients>) -> Result<(), String> {
    clients.0.lock().map_err(|e| e.to_string())?.remove(&source_key);
    Ok(())
}

#[cfg(target_os = "android")]
struct JavaBridge(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
async fn source_browser(app: tauri::AppHandle, request: serde_json::Value) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let mut payload = request;
        payload["operation"] = serde_json::json!("browser");
        tauri::async_runtime::spawn_blocking(move || app.state::<JavaBridge>().0.run_mobile_plugin::<serde_json::Value>("execute", serde_json::json!({ "payload": payload.to_string() })).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
    }
    #[cfg(target_os = "ios")]
    { tauri_plugin_source_browser::open(app, request).await }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    { let _ = (app, request); Err("Source browser requires Android or iOS".into()) }
}

#[tauri::command]
async fn java_bridge(app: tauri::AppHandle, payload: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || app.state::<JavaBridge>().0.run_mobile_plugin::<serde_json::Value>("execute", serde_json::json!({ "payload": payload })).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    { let _ = (app, payload); Err("JVM bridge is available on Android".into()) }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    charset: Option<String>,
    source_key: Option<String>,
    cookie_jar: Option<bool>,
    response_hex: Option<bool>,
}

#[derive(Serialize)]
struct Response {
    url: String,
    body: String,
    status: u16,
    headers: HashMap<String, String>,
}

#[tauri::command]
async fn fetch_text(request: Request, clients: tauri::State<'_, HttpClients>) -> Result<Response, String> {
    let client = if request.cookie_jar == Some(false) { http_client(false)? } else {
        let mut stored = clients.0.lock().map_err(|e| e.to_string())?;
        let key = request.source_key.clone().unwrap_or_default();
        if !stored.contains_key(&key) { stored.insert(key.clone(), http_client(true)?); }
        stored[&key].clone()
    };
    let url = url::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS URLs are supported".into());
    }
    let method = request.method.as_deref().unwrap_or("GET").parse::<reqwest::Method>().map_err(|e| e.to_string())?;
    if method != reqwest::Method::GET && method != reqwest::Method::POST {
        return Err("Only GET and POST are supported".into());
    }
    let mut builder = client.request(method, url);
    for (key, value) in request.headers.unwrap_or_default() {
        builder = builder.header(key, value);
    }
    if let Some(body) = request.body { builder = builder.body(body); }
    let mut response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response.headers().iter().filter_map(|(key, value)| value.to_str().ok().map(|value| (key.to_string(), value.to_string()))).collect();
    let final_url = response.url().to_string();
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let charset = request.charset.as_deref().unwrap_or_else(|| content_type.split(';').find_map(|p| p.trim().strip_prefix("charset=")).unwrap_or("utf-8")).trim_matches('"');
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 20 * 1024 * 1024 { return Err("Response exceeds 20 MiB".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let body = if request.response_hex == Some(true) {
        bytes.iter().map(|byte| format!("{:02x}", byte)).collect::<String>()
    } else {
        let encoding = encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
        encoding.decode(&bytes).0.into_owned()
    };
    Ok(Response { url: final_url, body, status, headers })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_source_browser::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri::plugin::Builder::<tauri::Wry>::new("java-bridge").setup(|app, api| {
        use tauri::Manager;
        let handle = api.register_android_plugin("com.suixincrazy.legado", "JavaBridgePlugin")?;
        app.manage(JavaBridge(handle));
        Ok(())
    }).build());
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(HttpClients::default())
        .invoke_handler(tauri::generate_handler![fetch_text, java_bridge, source_browser, clear_source_cookies])
        .run(tauri::generate_context!())
        .expect("failed to run reader");
}
