// Cienka powłoka: cała aplikacja to apps/web (tryb `tauri`), backend to Convex.
// Rust dostarcza tylko pluginy natywne — zapis plików, dialogi, HTTP bez CORS,
// lokalny store (ustawienia per maszyna + import danych sprzed migracji).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());
    // Aktualizacje z GitHub Releases (latest.json podpisany kluczem z TAURI_SIGNING_*)
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
