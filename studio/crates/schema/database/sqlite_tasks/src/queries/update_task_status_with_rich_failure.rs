use enums::tauri::tasks::task_failure_type::TaskFailureType;
use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use enums::tauri::tasks::task_status::TaskStatus;
use tokens::tokens::sqlite::tasks::TaskId;

pub struct UpdateTaskWithRichFailureArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub task_id: &'a TaskId,
  pub status: TaskStatus,
  pub maybe_failure_type: Option<TaskFailureType>,
  pub maybe_failure_message: Option<&'a str>,
}

const MAX_FAILURE_MESSAGE_BYTES: usize = 255;

/// Returns true if rows were updated.
pub async fn update_task_status_with_rich_failure(
  args: UpdateTaskWithRichFailureArgs<'_>,
) -> Result<bool, SqliteTasksError> {

  // Trim the message so it doesn't overflow the database column (on a
  // character boundary, so multi-byte text can't panic the slice).
  let maybe_failure_message = args.maybe_failure_message.map(|s| {
    let mut end = s.len().min(MAX_FAILURE_MESSAGE_BYTES);
    while !s.is_char_boundary(end) {
      end -= 1;
    }
    &s[..end]
  });

  let rows = args.db.lock().execute(r#"
    UPDATE tasks
    SET task_status = ?,
    on_failure_type = ?,
    on_failure_message = ?
    WHERE id = ?
  "#,
    rusqlite::params![
      args.status.to_str(),
      args.maybe_failure_type.map(|val| val.to_str()),
      maybe_failure_message,
      args.task_id.as_str(),
    ],
  )?;

  Ok(rows > 0)
}
