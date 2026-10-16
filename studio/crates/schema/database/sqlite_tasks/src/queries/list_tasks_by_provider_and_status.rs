use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use crate::queries::task::{placeholders, query_tasks, Task, TASK_COLUMNS};
use enums::common::generation_provider::GenerationProvider;
use enums::tauri::tasks::task_status::TaskStatus;
use std::collections::HashSet;

pub struct ListTasksByProviderAndStatusArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub provider: GenerationProvider,
  pub task_statuses: &'a HashSet<TaskStatus>,
}

pub struct TaskList {
  pub tasks: Vec<Task>,
}

pub async fn list_tasks_by_provider_and_status(
  args: ListTasksByProviderAndStatusArgs<'_>,
) -> Result<TaskList, SqliteTasksError> {

  let mut sql = format!(r#"
    SELECT {TASK_COLUMNS}
    FROM tasks
    WHERE provider = ?
  "#);
  let mut params = vec![args.provider.to_string()];

  if !args.task_statuses.is_empty() {
    sql.push_str(&format!(" AND task_status IN ({}) ", placeholders(args.task_statuses.len())));
    params.extend(args.task_statuses.iter().map(|status| status.to_str().to_string()));
  }

  let tasks = query_tasks(&args.db.lock(), &sql, &params, Some(args.provider))?;

  Ok(TaskList {
    tasks,
  })
}
