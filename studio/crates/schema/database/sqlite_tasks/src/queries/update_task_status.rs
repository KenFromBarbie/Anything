use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use enums::tauri::tasks::task_status::TaskStatus;
use tokens::tokens::sqlite::tasks::TaskId;

pub struct UpdateTaskArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub task_id: &'a TaskId,
  pub status: TaskStatus,
}

/// Returns true if rows were updated.
pub async fn update_task_status(
  args: UpdateTaskArgs<'_>,
) -> Result<bool, SqliteTasksError> {

  let rows = args.db.lock().execute(r#"
    UPDATE tasks
    SET task_status = ?
    WHERE id = ?
  "#, [args.status.to_str(), args.task_id.as_str()])?;

  Ok(rows > 0)
}
