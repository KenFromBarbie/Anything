use errors::AnyhowResult;
use log::{error, info};
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// The tasks table: the only migration this database has had. Its version is
/// tracked with `PRAGMA user_version`; databases created by the sqlx-based
/// build already have the table and are simply marked current.
const CREATE_TASKS_TABLE: &str =
  include_str!("../../../../../_database/sql/artcraft_migrations/20250708000000_create_tasks_table.sql");
const SCHEMA_VERSION: i64 = 1;

#[derive(Clone)]
pub struct TaskDbConnection {
  connection: Arc<Mutex<Connection>>,
}

impl TaskDbConnection {
  pub async fn connect_and_migrate<P: AsRef<Path>>(database_file: P) -> AnyhowResult<Self> {
    match open_and_migrate(database_file.as_ref()) {
      Ok(connection) => return Ok(Self::wrap(connection)),
      Err(err) => {
        error!("Error running SQLite migrations: {:?}", err);
      }
    }

    info!("Deleting and recreating SQLite database at {:?}", database_file.as_ref());

    if let Err(err) = std::fs::remove_file(&database_file) {
      error!("Error deleting SQLite database file: {:?}", err);
    }

    let connection = open_and_migrate(database_file.as_ref())?;

    Ok(Self::wrap(connection))
  }

  fn wrap(connection: Connection) -> Self {
    Self { connection: Arc::new(Mutex::new(connection)) }
  }

  /// The connection, held for one query at a time. Queries are short, so the
  /// tasks database is serialized through this lock rather than pooled.
  pub(crate) fn lock(&self) -> MutexGuard<'_, Connection> {
    self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
  }
}

fn open_and_migrate(database_file: &Path) -> rusqlite::Result<Connection> {
  let connection = Connection::open(database_file)?; // creates the file if missing
  connection.busy_timeout(Duration::from_secs(5))?;
  let _mode: String = connection.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))?;

  let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
  if version < SCHEMA_VERSION {
    let has_tasks: bool = connection.query_row(
      "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks')",
      [],
      |row| row.get(0),
    )?;
    if !has_tasks {
      connection.execute_batch(CREATE_TASKS_TABLE)?;
    }
    connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
  }

  Ok(connection)
}
