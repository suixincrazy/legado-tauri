use tauri::{Manager, plugin::{PluginHandle, TauriPlugin}};
tauri::ios_plugin_binding!(init_plugin_source_browser);
struct Browser(PluginHandle<tauri::Wry>);
pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("source-browser").setup(|app, api| {
        let handle = api.register_ios_plugin(init_plugin_source_browser)?;
        app.manage(Browser(handle));
        Ok(())
    }).build()
}
pub async fn open(app: tauri::AppHandle, request: serde_json::Value) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Browser>().0.run_mobile_plugin::<serde_json::Value>("open", serde_json::json!({ "payload": request.to_string() })).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}
