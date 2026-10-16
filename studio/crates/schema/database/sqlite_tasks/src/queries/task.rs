use crate::error::SqliteTasksError;
use enums::common::generation_provider::GenerationProvider;
use enums::tauri::tasks::task_model_type::TaskModelType;
use enums::tauri::tasks::task_status::TaskStatus;
use enums::tauri::tasks::task_type::TaskType;
use enums::tauri::ux::tauri_command_caller::TauriCommandCaller;
use tokens::tokens::sqlite::tasks::TaskId;

#[derive(Debug, Clone)]
pub struct Task {
  pub id: TaskId,
  pub status: TaskStatus,
  pub task_type: TaskType,
  pub model_type: Option<TaskModelType>,
  pub provider: GenerationProvider,
  pub provider_job_id: Option<String>,
  pub queue_status_url: Option<String>,
  pub queue_response_url: Option<String>,
  pub prompt_token: Option<String>,
  pub frontend_caller: Option<TauriCommandCaller>,
  pub frontend_subscriber_id: Option<String>,
  pub frontend_subscriber_payload: Option<String>,
}

/// The columns `RawTask::from_row` reads, for `SELECT {TASK_COLUMNS} FROM tasks`.
pub (crate) const TASK_COLUMNS: &str = "
      id,
      task_status,
      task_type,
      model_type,
      provider,
      provider_job_id,
      queue_status_url,
      queue_response_url,
      prompt_token,
      frontend_caller,
      frontend_subscriber_id,
      frontend_subscriber_payload";

#[derive(Debug)]
pub (crate) struct RawTask {
  pub (crate) id: String,
  pub (crate) task_status: String,
  pub (crate) task_type: String,
  pub (crate) model_type: Option<String>,
  pub (crate) provider: Option<String>,
  pub (crate) provider_job_id: Option<String>,
  pub (crate) queue_status_url: Option<String>,
  pub (crate) queue_response_url: Option<String>,
  pub (crate) prompt_token: Option<String>,
  pub (crate) frontend_caller: Option<String>,
  pub (crate) frontend_subscriber_id: Option<String>,
  pub (crate) frontend_subscriber_payload: Option<String>,
}

impl RawTask {
  pub (crate) fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
    Ok(Self {
      id: row.get("id")?,
      task_status: row.get("task_status")?,
      task_type: row.get("task_type")?,
      model_type: row.get("model_type")?,
      provider: row.get("provider")?,
      provider_job_id: row.get("provider_job_id")?,
      queue_status_url: row.get("queue_status_url")?,
      queue_response_url: row.get("queue_response_url")?,
      prompt_token: row.get("prompt_token")?,
      frontend_caller: row.get("frontend_caller")?,
      frontend_subscriber_id: row.get("frontend_subscriber_id")?,
      frontend_subscriber_payload: row.get("frontend_subscriber_payload")?,
    })
  }

  /// Parse the stored strings. A row without a provider takes `provider_fallback`
  /// (the provider the query filtered on), if any.
  pub (crate) fn into_task(self, provider_fallback: Option<GenerationProvider>) -> Result<Task, SqliteTasksError> {
    let provider = match (self.provider.as_deref(), provider_fallback) {
      (Some(provider), _) => GenerationProvider::from_str(provider)?,
      (None, Some(provider)) => provider,
      (None, None) => GenerationProvider::from_str("")?,
    };
    Ok(Task {
      id: TaskId::new_from_str(&self.id),
      status: TaskStatus::from_str(&self.task_status)?,
      task_type: TaskType::from_str(&self.task_type)?,
      model_type: self.model_type
          .map(|model| TaskModelType::from_str(&model))
          .transpose()?,
      provider,
      provider_job_id: self.provider_job_id,
      queue_status_url: self.queue_status_url,
      queue_response_url: self.queue_response_url,
      prompt_token: self.prompt_token,
      frontend_caller: self.frontend_caller
          .map(|caller| TauriCommandCaller::from_str(&caller))
          .transpose()?,
      frontend_subscriber_id: self.frontend_subscriber_id,
      frontend_subscriber_payload: self.frontend_subscriber_payload,
    })
  }
}

/// Run a task SELECT and parse every row.
pub (crate) fn query_tasks(
  connection: &rusqlite::Connection,
  sql: &str,
  params: &[String],
  provider_fallback: Option<GenerationProvider>,
) -> Result<Vec<Task>, SqliteTasksError> {
  let mut statement = connection.prepare(sql)?;
  let raw = statement
      .query_map(rusqlite::params_from_iter(params.iter()), RawTask::from_row)?
      .collect::<rusqlite::Result<Vec<_>>>()?;
  raw.into_iter().map(|task| task.into_task(provider_fallback)).collect()
}

/// `?, ?, ?` for an IN list of `count` values.
pub (crate) fn placeholders(count: usize) -> String {
  vec!["?"; count].join(", ")
}
