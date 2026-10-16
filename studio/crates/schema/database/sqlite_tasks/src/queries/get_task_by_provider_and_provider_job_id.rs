use crate::connection::TaskDbConnection;
use crate::error::SqliteTasksError;
use crate::queries::task::{RawTask, Task, TASK_COLUMNS};
use enums::common::generation_provider::GenerationProvider;
use rusqlite::OptionalExtension;

pub struct GetTaskByProviderAndProviderJobIdArgs<'a> {
  pub db: &'a TaskDbConnection,
  pub provider: GenerationProvider,
  pub provider_job_id: &'a str,
}


pub async fn get_task_by_provider_and_provider_job_id(
  args: GetTaskByProviderAndProviderJobIdArgs<'_>,
) -> Result<Option<Task>, SqliteTasksError> {

  let sql = format!(r#"
    SELECT {TASK_COLUMNS}
    FROM tasks
    WHERE
      provider = ?
      AND provider_job_id = ?
  "#);

  let raw = args.db.lock()
      .query_row(&sql, rusqlite::params![args.provider.to_str(), args.provider_job_id], RawTask::from_row)
      .optional()?;

  // NB: A row without a provider takes the provider we looked it up by.
  raw.map(|task| task.into_task(Some(args.provider))).transpose()
}
