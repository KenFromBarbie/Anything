use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use crate::queries::task::{placeholders, query_tasks, Task, TASK_COLUMNS};
use enums::common::generation_provider::GenerationProvider;
use enums::tauri::tasks::task_status::TaskStatus;
use std::collections::HashSet;

pub struct ListNonArtcraftPendingTasksArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub task_statuses: &'a HashSet<TaskStatus>,
}

pub struct NonArtcraftTaskList {
  pub tasks: Vec<Task>,
}

/// List all tasks that are NOT from the Artcraft provider and match the given statuses.
pub async fn list_non_artcraft_pending_tasks(
  args: ListNonArtcraftPendingTasksArgs<'_>,
) -> Result<NonArtcraftTaskList, SqliteTasksError> {
  let mut sql = format!(r#"
    SELECT {TASK_COLUMNS}
    FROM tasks
    WHERE provider != ?
  "#);
  let mut params = vec![GenerationProvider::Artcraft.to_string()];

  if !args.task_statuses.is_empty() {
    sql.push_str(&format!(" AND task_status IN ({}) ", placeholders(args.task_statuses.len())));
    params.extend(args.task_statuses.iter().map(|status| status.to_str().to_string()));
  }

  let tasks = query_tasks(&args.db.lock(), &sql, &params, None)?;

  Ok(NonArtcraftTaskList { tasks })
}
