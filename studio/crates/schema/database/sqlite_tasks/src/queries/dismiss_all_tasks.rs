use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;

/// Mark everything as dismissed.
pub async fn dismiss_all_tasks(
  db: &TaskDbConnection,
) -> Result<bool, SqliteTasksError> {

  let rows = db.lock().execute(r#"
    UPDATE tasks
    SET is_dismissed_by_user = 1
    WHERE is_dismissed_by_user != 1
  "#, [])?;

  Ok(rows > 0)
}
