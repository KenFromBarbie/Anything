use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;

/// Abandon all in-progress tasks.
/// Marked as user cancellation.
pub async fn nuke_all_tasks(
  db: &TaskDbConnection,
) -> Result<bool, SqliteTasksError> {

  let rows = db.lock().execute(r#"
    UPDATE tasks
    SET task_status = 'cancelled_by_user'
    WHERE task_status NOT IN (
        'complete_success',
        'complete_failure',
        'dead',
        'cancelled_by_user',
        'cancelled_by_provider',
        'cancelled_by_us'
    )
  "#, [])?;

  Ok(rows > 0)
}
