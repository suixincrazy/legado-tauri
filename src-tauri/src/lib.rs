use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize)]
struct Response {
    url: String,
    body: String,
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
    let mut response = builder.send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let final_url = response.url().to_string();
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let charset = content_type.split(';').find_map(|p| p.trim().strip_prefix("charset=")).unwrap_or("utf-8").trim_matches('"');
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 20 * 1024 * 1024 { return Err("Response exceeds 20 MiB".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let encoding = encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (body, _, _) = encoding.decode(&bytes);
    let body = body.into_owned();
    Ok(Response { url: final_url, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .cookie_store(true)
        .user_agent("LegadoTauri/3.26.1123")
        .build().expect("HTTP client");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(client)
        .invoke_handler(tauri::generate_handler![fetch_text])
        .run(tauri::generate_context!())
        .expect("failed to run reader");
}
