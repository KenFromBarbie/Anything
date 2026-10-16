use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use enums::tauri::tasks::task_media_file_class::TaskMediaFileClass;
use enums::tauri::tasks::task_status::TaskStatus;
use tokens::tokens::batch_generations::BatchGenerationToken;
use tokens::tokens::media_files::MediaFileToken;
use tokens::tokens::sqlite::tasks::TaskId;

const SUCCESSFUL_STATUS : &str = TaskStatus::CompleteSuccess.to_str();

pub struct UpdateSuccessfulTaskArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub task_id: &'a TaskId,
  pub maybe_batch_token: Option<&'a BatchGenerationToken>,
  pub maybe_primary_media_file_token: Option<&'a MediaFileToken>,
  pub maybe_primary_media_file_class: Option<TaskMediaFileClass>,
  pub maybe_primary_media_file_cdn_url: Option<&'a str>,
  pub maybe_primary_media_file_thumbnail_url_template: Option<&'a str>,
}

/// Returns true if rows were updated.
pub async fn update_successful_task_status_with_metadata(
  args: UpdateSuccessfulTaskArgs<'_>,
) -> Result<bool, SqliteTasksError> {

  let rows = args.db.lock().execute(r#"
    UPDATE tasks
    SET
      task_status = ?,
      on_complete_batch_token = ?,
      on_complete_primary_media_file_token = ?,
      on_complete_primary_media_file_class = ?,
      on_complete_primary_media_file_cdn_url = ?,
      on_complete_primary_media_file_thumbnail_url_template = ?
    WHERE id = ?
  "#,
    rusqlite::params![
      SUCCESSFUL_STATUS,
      args.maybe_batch_token.map(|t| t.as_str()),
      args.maybe_primary_media_file_token.map(|t| t.as_str()),
      args.maybe_primary_media_file_class.map(|c| c.to_str()),
      args.maybe_primary_media_file_cdn_url,
      args.maybe_primary_media_file_thumbnail_url_template,
      args.task_id.as_str(),
    ],
  )?;

  Ok(rows > 0)
}
