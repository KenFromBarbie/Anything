use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use crate::queries::task::{placeholders, query_tasks, Task, TASK_COLUMNS};
use enums::common::generation_provider::GenerationProvider;

pub struct ListTasksArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub provider: GenerationProvider,
  pub provider_job_ids: Option<Vec<String>>,
}

pub struct TaskList {
  pub tasks: Vec<Task>,
}

pub async fn list_tasks_by_provider_and_tokens(
  args: ListTasksArgs<'_>,
) -> Result<TaskList, SqliteTasksError> {

  let mut sql = format!(r#"
    SELECT {TASK_COLUMNS}
    FROM tasks
    WHERE provider = ?
  "#);
  let mut params = vec![args.provider.to_string()];

  if let Some(provider_job_ids) = args.provider_job_ids {
    sql.push_str(&format!(" AND provider_job_id IN ({}) ", placeholders(provider_job_ids.len())));
    params.extend(provider_job_ids);
  }

  let tasks = query_tasks(&args.db.lock(), &sql, &params, Some(args.provider))?;

  Ok(TaskList {
    tasks,
  })
}
