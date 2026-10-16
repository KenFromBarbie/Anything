//! The Studio: ArtCraft (AI image, video and 3D creation) built into Buzz.
//!
//! ArtCraft's Rust side runs in this process (`artcraft_app_lib`, from the
//! artcraft checkout next to this repo): its plugins and state are added to
//! Buzz's builder, its commands are routed by name, and its startup runs in
//! embedded mode, without a window of its own. Its UI is a child webview of
//! Buzz's main window, created the first time the Studio page is shown and laid
//! over that page's content area by `studio_place`.

use artcraft_app_lib::core::embedding::{embedded_webview_builder, EMBEDDED_WEBVIEW_LABEL};
use tauri::ipc::Invoke;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, Wry};

/// ArtCraft's UI, built into Buzz's public dir by `just studio-web` so it is
/// served from Buzz's own origin.
const STUDIO_APP_PATH: &str = "studio-app/index.html";

pub use artcraft_app_lib::Startup;

/// ArtCraft's plugins and state. Buzz registers the dialog and opener plugins
/// ArtCraft also uses.
pub fn install(builder: tauri::Builder<Wry>) -> (tauri::Builder<Wry>, Startup) {
    artcraft_app_lib::install(builder)
}

/// Buzz's command handler with ArtCraft's commands routed to ArtCraft's. The
/// two sets of names don't overlap.
pub fn with_artcraft_commands(
    buzz: impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    let artcraft = artcraft_app_lib::invoke_handler();
    move |invoke| {
        if artcraft_app_lib::COMMANDS.contains(&invoke.message.command()) {
            artcraft(invoke)
        } else {
            buzz(invoke)
        }
    }
}

/// Show ArtCraft's view over the Studio page's content area (logical pixels,
/// relative to the main window), or hide it when the page isn't showing.
#[tauri::command]
pub async fn studio_place(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));
    let webview = match app.get_webview(EMBEDDED_WEBVIEW_LABEL) {
        Some(webview) => webview,
        None if !visible => return Ok(()),
        None => {
            let window = app.get_window("main").ok_or("main window not found")?;
            let url = WebviewUrl::App(STUDIO_APP_PATH.into());
            return window
                .add_child(embedded_webview_builder(url), position, size)
                .map(|_| ())
                .map_err(|e| format!("could not open the Studio: {e}"));
        }
    };
    if visible {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
    } else {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
