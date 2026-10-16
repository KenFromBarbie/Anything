use enums::error::enum_error::EnumError;
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum SqliteTasksError {
  SqliteError(rusqlite::Error),
  EnumError(EnumError),
  //TaskNotFound,
  //TaskAlreadyExists,
  //InvalidTaskStatus,
  //InvalidTaskType,
  //InvalidGenerationProvider,
}

impl Error for SqliteTasksError {}

impl Display for SqliteTasksError {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    match self {
      SqliteTasksError::SqliteError(err) => write!(f, "SQLite error: {:?}", err),
      SqliteTasksError::EnumError(err) => write!(f, "Error parsing enum: {:?}", err),
    }
  }
}

impl From<rusqlite::Error> for SqliteTasksError {
  fn from(err: rusqlite::Error) -> Self {
    SqliteTasksError::SqliteError(err)
  }
}

impl From<EnumError> for SqliteTasksError {
  fn from(err: EnumError) -> Self {
    SqliteTasksError::EnumError(err)
  }
}
