//! ArtCraft hosted inside another Tauri app (Buzz) instead of running on its own.
//!
//! Embedded, ArtCraft has no window of its own: its UI is a child webview of the
//! host's window, labelled `EMBEDDED_WEBVIEW_LABEL`, and everything that sized,
//! moved or decorated ArtCraft's own window is skipped (the host's main window
//! shares ArtCraft's standalone window label, "main"). The host calls
//! `crate::install`, routes `crate::COMMANDS` to `crate::invoke_handler`, calls
//! `crate::Startup::start_embedded` from its setup, and adds the view built by
//! `embedded_webview_builder` to its window wherever it lays ArtCraft out.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::webview::WebviewBuilder;
use tauri::window::Color;
use tauri::{WebviewUrl, Wry};

/// Label of ArtCraft's webview inside the host's window.
pub const EMBEDDED_WEBVIEW_LABEL: &str = "artcraft";

/// Set in the embedded webview before any page script runs; the frontend reads
/// it to drop window chrome (title bar buttons, drag regions) that would act on
/// the host's window.
const EMBEDDED_INIT_SCRIPT: &str = "window.__ARTCRAFT_EMBEDDED__ = true;";

static EMBEDDED: AtomicBool = AtomicBool::new(false);

/// Whether ArtCraft is running inside a host app.
pub fn is_embedded() -> bool {
  EMBEDDED.load(Ordering::Relaxed)
}

pub(crate) fn set_embedded() {
  EMBEDDED.store(true, Ordering::Relaxed);
}

/// ArtCraft's UI as a child webview for the host's window.
pub fn embedded_webview_builder(url: WebviewUrl) -> WebviewBuilder<Wry> {
  WebviewBuilder::new(EMBEDDED_WEBVIEW_LABEL, url)
      .initialization_script(EMBEDDED_INIT_SCRIPT)
      .background_color(Color(0, 0, 0, 0))
      .enable_clipboard_access()
}
