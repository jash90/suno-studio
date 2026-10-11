// Cienka powłoka: UI i logika to apps/web (tryb `tauri`, silnik data/local), dane leżą
// lokalnie w katalogu danych aplikacji. Rust dostarcza tylko pluginy natywne — pliki,
// dialogi, HTTP bez CORS (OpenAI/Anthropic/Suno), store, aktualizacje.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        // foldery wybrane w dialogu (domyślny folder zapisu) zostają dostępne po restarcie
        .plugin(tauri_plugin_persisted_scope::init())
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
