//! The task database against real SQLite: migrate, write, read, update.

use enums::common::generation_provider::GenerationProvider;
use enums::tauri::tasks::task_failure_type::TaskFailureType;
use enums::tauri::tasks::task_status::TaskStatus;
use enums::tauri::tasks::task_type::TaskType;
use sqlite_tasks::connection::TaskDbConnection;
use sqlite_tasks::queries::create_task::{create_task, CreateTaskArgs};
use sqlite_tasks::queries::dismiss_all_tasks::dismiss_all_tasks;
use sqlite_tasks::queries::get_task_by_provider_and_provider_job_id::{
  get_task_by_provider_and_provider_job_id, GetTaskByProviderAndProviderJobIdArgs,
};
use sqlite_tasks::queries::list_non_artcraft_pending_tasks::{
  list_non_artcraft_pending_tasks, ListNonArtcraftPendingTasksArgs,
};
use sqlite_tasks::queries::list_tasks_by_provider_and_status::{
  list_tasks_by_provider_and_status, ListTasksByProviderAndStatusArgs,
};
use sqlite_tasks::queries::list_tasks_by_provider_and_tokens::{list_tasks_by_provider_and_tokens, ListTasksArgs};
use sqlite_tasks::queries::list_tasks_for_frontend::list_tasks_for_frontend;
use sqlite_tasks::queries::mark_task_as_dismissed::mark_task_as_dismissed;
use sqlite_tasks::queries::nuke_all_tasks::nuke_all_tasks;
use sqlite_tasks::queries::update_task_status::{update_task_status, UpdateTaskArgs};
use sqlite_tasks::queries::update_task_status_with_rich_failure::{
  update_task_status_with_rich_failure, UpdateTaskWithRichFailureArgs,
};
use std::collections::HashSet;

fn args<'a>(db: &'a TaskDbConnection, provider: GenerationProvider, job_id: &'a str) -> CreateTaskArgs<'a> {
  CreateTaskArgs {
    db,
    status: TaskStatus::Pending,
    task_type: TaskType::ImageGeneration,
    model_type: None,
    provider,
    provider_job_id: Some(job_id),
    queue_status_url: None,
    queue_response_url: None,
    prompt_token: None,
    frontend_caller: None,
    frontend_subscriber_id: Some("sub-1"),
    frontend_subscriber_payload: None,
  }
}

#[tokio::test]
async fn tasks_round_trip_through_sqlite() {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join("tasks.sqlite");
  let db = TaskDbConnection::connect_and_migrate(&path).await.unwrap();

  let fal = create_task(args(&db, GenerationProvider::Fal, "fal-1")).await.unwrap();
  let _grok = create_task(args(&db, GenerationProvider::Grok, "grok-1")).await.unwrap();
  let _ours = create_task(args(&db, GenerationProvider::Artcraft, "ours-1")).await.unwrap();

  let found = get_task_by_provider_and_provider_job_id(GetTaskByProviderAndProviderJobIdArgs {
    db: &db,
    provider: GenerationProvider::Fal,
    provider_job_id: "fal-1",
  }).await.unwrap().expect("task by provider job id");
  assert_eq!(found.id, fal);
  assert_eq!(found.status, TaskStatus::Pending);
  assert_eq!(found.frontend_subscriber_id.as_deref(), Some("sub-1"));
  assert!(get_task_by_provider_and_provider_job_id(GetTaskByProviderAndProviderJobIdArgs {
    db: &db,
    provider: GenerationProvider::Fal,
    provider_job_id: "missing",
  }).await.unwrap().is_none());

  let pending: HashSet<TaskStatus> = [TaskStatus::Pending].into_iter().collect();
  let others = list_non_artcraft_pending_tasks(ListNonArtcraftPendingTasksArgs { db: &db, task_statuses: &pending })
      .await.unwrap();
  assert_eq!(others.tasks.len(), 2, "fal + grok, not artcraft");

  let by_status = list_tasks_by_provider_and_status(ListTasksByProviderAndStatusArgs {
    db: &db,
    provider: GenerationProvider::Fal,
    task_statuses: &pending,
  }).await.unwrap();
  assert_eq!(by_status.tasks.len(), 1);

  let by_tokens = list_tasks_by_provider_and_tokens(ListTasksArgs {
    db: &db,
    provider: GenerationProvider::Grok,
    provider_job_ids: Some(vec!["grok-1".to_string(), "nope".to_string()]),
  }).await.unwrap();
  assert_eq!(by_tokens.tasks.len(), 1);

  assert!(update_task_status(UpdateTaskArgs { db: &db, task_id: &fal, status: TaskStatus::Started }).await.unwrap());
  let long_message = "é".repeat(200); // 400 bytes: trimmed on a character boundary
  assert!(update_task_status_with_rich_failure(UpdateTaskWithRichFailureArgs {
    db: &db,
    task_id: &fal,
    status: TaskStatus::CompleteFailure,
    maybe_failure_type: Some(TaskFailureType::Unknown),
    maybe_failure_message: Some(&long_message),
  }).await.unwrap());

  let frontend = list_tasks_for_frontend(&db).await.unwrap();
  assert_eq!(frontend.tasks.len(), 3);
  let failed = frontend.tasks.iter().find(|t| t.id == fal).unwrap();
  assert_eq!(failed.status, TaskStatus::CompleteFailure);
  assert_eq!(failed.on_failure_message.as_deref().map(str::len), Some(254));
  assert!(failed.created_at.timestamp() > 1_700_000_000, "unix seconds decoded");

  // Everything not finished is cancelled; the failed task keeps its status.
  assert!(nuke_all_tasks(&db).await.unwrap());
  let after = list_tasks_for_frontend(&db).await.unwrap();
  assert!(after.tasks.iter().filter(|t| t.id != fal).all(|t| t.status == TaskStatus::CancelledByUser));

  assert!(mark_task_as_dismissed(&db, &fal).await.unwrap());
  assert_eq!(list_tasks_for_frontend(&db).await.unwrap().tasks.len(), 2);
  assert!(dismiss_all_tasks(&db).await.unwrap());
  assert!(list_tasks_for_frontend(&db).await.unwrap().tasks.is_empty());
}

#[tokio::test]
async fn reopening_keeps_data_and_does_not_migrate_twice() {
  let dir = tempfile::tempdir().unwrap();
  let path = dir.path().join("tasks.sqlite");
  {
    let db = TaskDbConnection::connect_and_migrate(&path).await.unwrap();
    create_task(args(&db, GenerationProvider::Fal, "fal-1")).await.unwrap();
  }
  let db = TaskDbConnection::connect_and_migrate(&path).await.unwrap();
  assert_eq!(list_tasks_for_frontend(&db).await.unwrap().tasks.len(), 1);
}
