use crate::core::commands::cost_estimate::estimate_audio_cost_command::estimate_audio_cost_command;
use crate::core::commands::cost_estimate::estimate_mesh_cost_command::estimate_mesh_cost_command;
use crate::core::commands::generate::generate_splat_command::generate_splat_command;
use crate::core::commands::generate::generate_audio_command::generate_audio_command;
use crate::core::commands::generate::generate_mesh_command::generate_mesh_command;
pub mod core;
pub mod services;
pub mod version;

use tauri::Manager;

use crate::core::commands::app_preferences::get_app_preferences_command::get_app_preferences_command;
use crate::core::commands::app_preferences::update_app_preference_command::update_app_preferences_command;
use crate::core::commands::cost_estimate::estimate_image_cost_command::estimate_image_cost_command;
use crate::core::commands::cost_estimate::estimate_splat_cost_command::estimate_splat_cost_command;
use crate::core::commands::cost_estimate::estimate_video_cost_command::estimate_video_cost_command;
use crate::core::commands::generate::models::image::list_image_models_command::list_image_models_command;
use crate::core::commands::generate::models::video::list_video_models_command::list_video_models_command;
use crate::core::commands::download::download_directory_reveal_command::download_directory_reveal_command;
use crate::core::commands::download::download_media_file_command::download_media_file_command;
use crate::core::commands::download::download_url_command::download_url_command;
use crate::core::commands::download::get_download_path_command::get_download_path_command;
use crate::core::commands::enqueue::image_bg_removal::enqueue_image_bg_removal_command::enqueue_image_bg_removal_command;
use crate::core::commands::enqueue::image_to_gaussian::enqueue_image_to_gaussian_command::enqueue_image_to_gaussian_command;
use crate::core::commands::enqueue::image_to_object::enqueue_image_to_3d_object_command::enqueue_image_to_3d_object_command;
use crate::core::commands::generate::generate_image::generate_image_command::generate_image_command;
use crate::core::commands::generate::generate_video::generate_video_command::generate_video_command;
use crate::core::commands::flip_image::flip_image;
use crate::core::commands::get_app_info_command::get_app_info_command;
use crate::core::commands::load_without_cors_command::load_without_cors_command;
use crate::core::commands::media_files::media_file_delete_command::media_file_delete_command;
use crate::core::commands::platform_info_command::platform_info_command;
use crate::core::commands::providers::deprecated::get_provider_order_command::get_provider_order_command;
use crate::core::commands::providers::deprecated::set_provider_order_command::set_provider_order_command;
use crate::core::commands::providers::provider_clear_command::provider_clear_command;
use crate::core::commands::providers::provider_list_command::provider_list_command;
use crate::core::commands::providers::provider_set_api_key_command::provider_set_api_key_command;
use crate::core::commands::task_queue::get_task_queue_command::get_task_queue_command;
use crate::core::commands::task_queue::mark_task_as_dismissed_command::mark_task_as_dismissed_command;
use crate::core::commands::task_queue::tasks_nuke_all_command::tasks_nuke_all_command;
use crate::core::lifecycle::startup::handle_tauri_startup::handle_tauri_startup;
use crate::core::lifecycle::startup::setup_main_window::setup_main_window;
use crate::core::state::app_env_configs::app_env_configs::AppEnvConfigs;
use crate::core::state::app_preferences::app_preferences_manager::load_app_preferences_or_default;
use crate::core::state::artcraft_platform_info::ArtcraftPlatformInfo;
use crate::core::state::data_dir::app_data_root::AppDataRoot;
use crate::core::state::provider_priority::ProviderPriorityStore;
use crate::core::threads::discord_presence_thread::discord_presence_thread;
use crate::core::threads::main_window_thread::main_window_thread::main_window_thread;
use crate::services::grok::commands::grok_clear_credentials_command::grok_clear_credentials_command;
use crate::services::grok::commands::grok_get_credential_info_command::grok_get_credential_info_command;
use crate::services::grok::commands::grok_open_login_command::grok_open_login_command;
use crate::services::grok::state::grok_credential_manager::GrokCredentialManager;
use crate::services::grok::state::grok_image_prompt_queue::GrokImagePromptQueue;
use crate::services::midjourney::commands::midjourney_clear_credentials_command::midjourney_clear_credentials_command;
use crate::services::midjourney::commands::midjourney_get_credential_info_command::midjourney_get_credential_info_command;
use crate::services::midjourney::commands::midjourney_open_login_command::midjourney_open_login_command;
use crate::services::midjourney::state::midjourney_credential_manager::MidjourneyCredentialManager;
use crate::services::sora::commands::check_sora_session_command::check_sora_session_command;
use crate::services::sora::commands::open_sora_login_command::open_sora_login_command;
use crate::services::sora::commands::sora_get_credential_info_command::sora_get_credential_info_command;
use crate::services::sora::commands::sora_logout_command::sora_logout_command;
use crate::services::sora::state::sora_credential_manager::SoraCredentialManager;
use crate::services::sora::state::sora_task_queue::SoraTaskQueue;
use crate::services::sora::threads::sora_task_polling::sora_task_polling_thread::sora_task_polling_thread;
use crate::services::storyteller::commands::login_bridge::DesktopLoginBridgeState;
use crate::services::storyteller::commands::storyteller_cancel_login_challenge_command::storyteller_cancel_login_challenge_command;
use crate::services::storyteller::commands::storyteller_create_login_challenge_command::storyteller_create_login_challenge_command;
use crate::services::storyteller::commands::storyteller_get_login_session_command::storyteller_get_login_session_command;
use crate::services::storyteller::commands::storyteller_password_login_command::storyteller_password_login_command;
use crate::services::storyteller::commands::storyteller_password_signup_command::storyteller_password_signup_command;
use crate::services::storyteller::commands::storyteller_poll_login_challenge_command::storyteller_poll_login_challenge_command;
use crate::services::storyteller::commands::storyteller_get_credits_command::storyteller_get_credits_command;
use crate::services::storyteller::commands::storyteller_get_subscription_command::storyteller_get_subscription_command;
use crate::services::storyteller::commands::storyteller_purge_credentials_command::storyteller_purge_credentials_command;
use crate::services::storyteller::commands::stripe_checkout::storyteller_open_credits_purchase_command::storyteller_open_credits_purchase_command;
use crate::services::storyteller::commands::stripe_checkout::storyteller_open_subscription_purchase_command::storyteller_open_subscription_purchase_command;
use crate::services::storyteller::commands::stripe_customer_portal::storyteller_open_customer_portal_cancel_plan_command::storyteller_open_customer_portal_cancel_plan_command;
use crate::services::storyteller::commands::stripe_customer_portal::storyteller_open_customer_portal_manage_plan_command::storyteller_open_customer_portal_manage_plan_command;
use crate::services::storyteller::commands::stripe_customer_portal::storyteller_open_customer_portal_switch_plan_command::storyteller_open_customer_portal_switch_plan_command;
use crate::services::storyteller::commands::stripe_customer_portal::storyteller_open_customer_portal_update_payment_method_command::storyteller_open_customer_portal_update_payment_method_command;
use crate::services::storyteller::state::storyteller_credential_manager::StorytellerCredentialManager;
use crate::services::worldlabs::commands::worldlabs_clear_credentials_command::worldlabs_clear_credentials_command;
use crate::services::worldlabs::commands::worldlabs_get_credential_info_command::worldlabs_get_credential_info_command;
use crate::services::worldlabs::commands::worldlabs_open_login_command::worldlabs_open_login_command;
use crate::services::worldlabs::commands::worldlabs_receive_bearer_command::worldlabs_receive_bearer_command;
use crate::services::worldlabs::state::worldlabs_bearer_bridge::WorldlabsBearerBridge;
use crate::services::worldlabs::state::worldlabs_credential_manager::WorldlabsCredentialManager;
use log::error;

use crate::core::state::artcraft_usage_tracker::artcraft_usage_tracker::ArtcraftUsageTracker;
use tauri_plugin_dialog;
use tauri_plugin_http;
use tauri_plugin_log::Target;
use tauri_plugin_log::TargetKind;

/// ArtCraft's commands, listed once for both the handler and `COMMANDS`.
macro_rules! artcraft_commands {
  ($($emit:tt)+) => {
    $($emit)+![
      check_sora_session_command,
      download_directory_reveal_command,
      download_media_file_command,
      download_url_command,
      get_download_path_command,
      enqueue_image_bg_removal_command,
      enqueue_image_to_3d_object_command,
      enqueue_image_to_gaussian_command,
      estimate_image_cost_command,
      estimate_splat_cost_command,
      estimate_video_cost_command,
      estimate_audio_cost_command,
      estimate_mesh_cost_command,
      list_image_models_command,
      list_video_models_command,
      flip_image,
      generate_image_command,
      generate_video_command,
      generate_splat_command,
      generate_audio_command,
      generate_mesh_command,
      get_app_info_command,
      get_app_preferences_command,
      get_provider_order_command,
      get_task_queue_command,
      provider_clear_command,
      provider_list_command,
      provider_set_api_key_command,
      grok_clear_credentials_command,
      grok_get_credential_info_command,
      grok_open_login_command,
      load_without_cors_command,
      mark_task_as_dismissed_command,
      media_file_delete_command,
      midjourney_clear_credentials_command,
      midjourney_get_credential_info_command,
      midjourney_open_login_command,
      open_sora_login_command,
      platform_info_command,
      set_provider_order_command,
      sora_get_credential_info_command,
      sora_logout_command,
      storyteller_get_login_session_command,
      storyteller_password_login_command,
      storyteller_password_signup_command,
      storyteller_create_login_challenge_command,
      storyteller_poll_login_challenge_command,
      storyteller_cancel_login_challenge_command,
      storyteller_get_credits_command,
      storyteller_get_subscription_command,
      storyteller_open_credits_purchase_command,
      storyteller_open_customer_portal_cancel_plan_command,
      storyteller_open_customer_portal_manage_plan_command,
      storyteller_open_customer_portal_switch_plan_command,
      storyteller_open_customer_portal_update_payment_method_command,
      storyteller_open_subscription_purchase_command,
      storyteller_purge_credentials_command,
      tasks_nuke_all_command,
      update_app_preferences_command,
      worldlabs_clear_credentials_command,
      worldlabs_get_credential_info_command,
      worldlabs_open_login_command,
      worldlabs_receive_bearer_command,
    ]
  };
}

macro_rules! command_names {
  ($($command:ident),* $(,)?) => {
    &[$(stringify!($command)),*]
  };
}

/// Names of ArtCraft's commands. A host app with commands of its own routes
/// invokes of these names to `invoke_handler`.
pub const COMMANDS: &[&str] = artcraft_commands!(command_names);

/// ArtCraft's command handler.
pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
  // TODO: Break this out into another module, because RustRover/IntelliJ lags with these macros.
  //  My first attempt at naively doing this didn't work because the macros can't find their codegen'd targets.
  artcraft_commands!(tauri::generate_handler)
}

/// What ArtCraft's startup needs, captured while `install` builds its state.
pub struct Startup {
  app_data_root: AppDataRoot,
  app_env_configs: AppEnvConfigs,
  artcraft_platform_info: ArtcraftPlatformInfo,
  artcraft_usage_tracker: ArtcraftUsageTracker,
  storyteller_creds_manager: StorytellerCredentialManager,
  sora_creds_manager: SoraCredentialManager,
  sora_task_queue: SoraTaskQueue,
  midjourney_creds_manager: MidjourneyCredentialManager,
  grok_creds_manager: GrokCredentialManager,
  grok_prompt_queue: GrokImagePromptQueue,
  worldlabs_bearer_bridge: WorldlabsBearerBridge,
  worldlabs_creds_manager: WorldlabsCredentialManager,
  provider_credential_cache: crate::core::providers::credentials::provider_credential_loading_cache::ProviderCredentialLoadingCache,
}

impl Startup {
  async fn start(self, app: tauri::AppHandle) -> errors::AnyhowResult<()> {
    handle_tauri_startup(
      app,
      self.app_data_root,
      self.app_env_configs,
      self.artcraft_platform_info,
      self.artcraft_usage_tracker,
      self.storyteller_creds_manager,
      self.sora_creds_manager,
      self.sora_task_queue,
      self.midjourney_creds_manager,
      self.grok_creds_manager,
      self.grok_prompt_queue,
      self.worldlabs_bearer_bridge,
      self.worldlabs_creds_manager,
      self.provider_credential_cache,
    ).await
  }

  /// Start ArtCraft inside a host app (see `core::embedding`): its background
  /// work, without a window of its own. Call from the host's setup. A failure
  /// is logged rather than taking the host down.
  pub fn start_embedded(self, app: &tauri::AppHandle) {
    crate::core::embedding::set_embedded();
    let app = app.clone();
    tauri::async_runtime::block_on(async move {
      if let Err(err) = self.start(app).await {
        error!("Failed to start embedded ArtCraft: {:?}", err);
      }
    });
  }
}

/// ArtCraft's plugins and state, added to `builder`. The dialog and opener
/// plugins are left to the caller, since a host app usually registers its own.
pub fn install(builder: tauri::Builder<tauri::Wry>) -> (tauri::Builder<tauri::Wry>, Startup) {
  // NB: Tauri wants to install the logger itself, so we can't rely on the logger crate
  // until the tauri runtime begins.
  println!("Loading config...");
  let app_data_root = AppDataRoot::create_default().expect("data directory should be created");
  let app_data_root_2 = app_data_root.clone();

  println!("Getting platform info...");
  let artcraft_platform_info = ArtcraftPlatformInfo::get();
  let artcraft_platform_info_2 = artcraft_platform_info.clone();

  println!("Platform info: {:?}", artcraft_platform_info);

  println!("Loading app preferences...");
  let app_preferences = load_app_preferences_or_default(&app_data_root);
  
  let provider_credential_cache = crate::core::providers::credentials::provider_credential_loading_cache::ProviderCredentialLoadingCache::new(app_data_root.clone());
  let provider_credential_cache_2 = provider_credential_cache.clone();

  // NB: tauri-plugin-http stores the credentials on disk, so we can defer to that for now.
  // println!("Attempting to read existing artcraft credentials...");
  // let storyteller_creds_manager = StorytellerCredentialManager::initialize_from_disk_infallible(&app_data_root);
  let storyteller_creds_manager = StorytellerCredentialManager::initialize_empty(&app_data_root);
  let storyteller_creds_manager_2 = storyteller_creds_manager.clone();
  let storyteller_creds_manager_3 = storyteller_creds_manager.clone();
  
  println!("Attempting to read existing sora credentials...");
  let sora_creds_manager = SoraCredentialManager::initialize_from_disk_infallible(&app_data_root);
  let sora_creds_manager_2 = sora_creds_manager.clone();
  
  // Other state
  let sora_task_queue = SoraTaskQueue::new();
  let sora_task_queue_2 = sora_task_queue.clone();

  let app_env_configs = AppEnvConfigs::load_from_filesystem(&app_data_root)
    .expect("AppEnvConfigs should be loaded from disk");
  
  let app_env_configs_2 = app_env_configs.clone();

  let midjourney_creds_manager = MidjourneyCredentialManager::initialize_from_disk_infallible(&app_data_root);
  let midjourney_creds_manager_2 = midjourney_creds_manager.clone();

  let grok_creds_manager = GrokCredentialManager::initialize_from_disk_infallible(&app_data_root);
  let grok_creds_manager_2 = grok_creds_manager.clone();

  let grok_prompt_queue = GrokImagePromptQueue::new();
  let grok_prompt_queue_2 = grok_prompt_queue.clone();

  let worldlabs_creds_manager = WorldlabsCredentialManager::initialize_from_disk_infallible(&app_data_root);
  let worldlabs_creds_manager_2 = worldlabs_creds_manager.clone();

  let worldlabs_bearer_bridge = WorldlabsBearerBridge::empty();
  let worldlabs_bearer_bridge_2 = worldlabs_bearer_bridge.clone();
  
  let artcraft_usage_tracker = ArtcraftUsageTracker::new();
  let artcraft_usage_tracker_2 = artcraft_usage_tracker.clone();

  println!("Initializing backend runtime...");

  let startup = Startup {
    app_data_root: app_data_root_2,
    app_env_configs: app_env_configs_2,
    artcraft_platform_info: artcraft_platform_info_2,
    artcraft_usage_tracker: artcraft_usage_tracker_2,
    storyteller_creds_manager: storyteller_creds_manager_2,
    sora_creds_manager: sora_creds_manager_2,
    sora_task_queue: sora_task_queue_2,
    midjourney_creds_manager: midjourney_creds_manager_2,
    grok_creds_manager: grok_creds_manager_2,
    grok_prompt_queue: grok_prompt_queue_2,
    worldlabs_bearer_bridge: worldlabs_bearer_bridge_2,
    worldlabs_creds_manager: worldlabs_creds_manager_2,
    provider_credential_cache: provider_credential_cache_2,
  };

  let builder = builder
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_upload::init())
    .manage(app_data_root)
    .manage(app_env_configs)
    .manage(DesktopLoginBridgeState::default())
    .manage(app_preferences)
    .manage(artcraft_platform_info)
    .manage(artcraft_usage_tracker)
    .manage(grok_creds_manager)
    .manage(grok_prompt_queue)
    .manage(midjourney_creds_manager)
    .manage(sora_creds_manager)
    .manage(sora_task_queue)
    .manage(storyteller_creds_manager_3)
    .manage(worldlabs_bearer_bridge)
    .manage(provider_credential_cache)
    .manage(worldlabs_creds_manager);

  (builder, startup)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init());
  let (builder, startup) = install(builder);

  builder
    .setup(move |app| {
      // TODO(bt): This is broken on windows
      // log_environment_details();
      let app = app.handle().clone();

      tauri::async_runtime::block_on(async move {
        let _result = setup_main_window(&app).await;

        let result = startup.start(app).await;

        if let Err(err) = result {
          error!("Failed to handle Tauri startup: {:?}", err);
          panic!("Failed to handle Tauri startup: {:?}", err);
        }
      });

      Ok(())
    })
    .invoke_handler(invoke_handler())
    .run(tauri::generate_context!("tauri.conf.json"))
    .expect("error while running tauri application");
}
