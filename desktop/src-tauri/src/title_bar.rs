//! The native Windows title bar, coloured to match the app's theme (Windows
//! 11 lets an app set its caption, caption text and border colours).

/// `#rrggbb` → Windows COLORREF (0x00bbggrr).
#[cfg(any(target_os = "windows", test))]
fn colorref(hex: &str) -> Option<u32> {
    let hex = hex.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let value = u32::from_str_radix(hex, 16).ok()?;
    let (r, g, b) = (value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff);
    Some(b << 16 | g << 8 | r)
}

/// Colour the window's title bar: `caption` behind, `text` on it.
#[tauri::command]
pub fn set_title_bar_colors(
    window: tauri::WebviewWindow,
    caption: String,
    text: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let caption = colorref(&caption).ok_or("caption is not #rrggbb")?;
        let text = colorref(&text).ok_or("text is not #rrggbb")?;
        for (attribute, color) in [
            (DWMWA_CAPTION_COLOR, caption),
            (DWMWA_BORDER_COLOR, caption),
            (DWMWA_TEXT_COLOR, text),
        ] {
            // Older Windows (10) ignores these: the bar keeps its colour.
            #[allow(unsafe_code)]
            unsafe {
                DwmSetWindowAttribute(
                    hwnd.0 as _,
                    attribute as u32,
                    &color as *const u32 as *const _,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, caption, text);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn hex_becomes_bgr() {
        assert_eq!(super::colorref("#123456"), Some(0x563412));
        assert_eq!(super::colorref("123"), None);
    }
}
