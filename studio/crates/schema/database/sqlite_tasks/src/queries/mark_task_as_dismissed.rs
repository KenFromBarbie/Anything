use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use tokens::tokens::sqlite::tasks::TaskId;

/// Returns true if rows were updated.
pub async fn mark_task_as_dismissed(
  db: &TaskDbConnection,
  task_id: &TaskId,
) -> Result<bool, SqliteTasksError> {

  let rows = db.lock().execute(r#"
    UPDATE tasks
    SET is_dismissed_by_user = 1
    WHERE id = ?
  "#, [task_id.as_str()])?;

  Ok(rows > 0)
}
