use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

#[cfg(target_os = "android")]
struct JavaBridge(tauri::plugin::PluginHandle<tauri::Wry>);

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
}

#[derive(Serialize)]
struct Response {
    url: String,
    body: String,
    status: u16,
    headers: HashMap<String, String>,
}

#[tauri::command]
async fn fetch_text(request: Request, client: tauri::State<'_, reqwest::Client>) -> Result<Response, String> {
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
    let encoding = encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (body, _, _) = encoding.decode(&bytes);
    let body = body.into_owned();
    Ok(Response { url: final_url, body, status, headers })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .cookie_store(true)
        .user_agent("LegadoTauri/3.26.1124")
        .build().expect("HTTP client");
    let builder = tauri::Builder::default();
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
        .manage(client)
        .invoke_handler(tauri::generate_handler![fetch_text, java_bridge])
        .run(tauri::generate_context!())
        .expect("failed to run reader");
}
