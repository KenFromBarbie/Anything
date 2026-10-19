fn main() {
  // Built into Anything, the Tauri CLI passes the host app's merged
  // config (TAURI_CONFIG) to every crate in the build. It describes the host
  // (its resources, binary name), not ArtCraft, so don't merge it into this
  // crate's own config.
  std::env::remove_var("TAURI_CONFIG");
  tauri_build::build()
}
