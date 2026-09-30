use serde::Serialize;
use thiserror::Error;

use crate::error_codes::{self, ErrorCode};

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{code}: {detail}")]
    Coded { code: &'static str, detail: String },
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Db(#[from] diesel::result::Error),
    #[error(transparent)]
    Connection(#[from] diesel::ConnectionError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (code, detail) = self.code_and_detail();
        ErrorPayload {
            code,
            detail: Some(detail.as_str()).filter(|s| !s.is_empty()),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn coded(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self::Coded {
            code: code.code,
            detail: detail.into(),
        }
    }

    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }

    #[must_use]
    pub const fn registry() -> &'static [ErrorCode] {
        error_codes::ALL_CODES
    }

    pub fn code_and_detail(&self) -> (&'static str, String) {
        match self {
            Self::Coded { code, detail } => (*code, detail.clone()),
            Self::Message(s) => {
                if s.contains("sample not found") {
                    (error_codes::SAMPLE_NOT_FOUND.code, s.clone())
                } else if s.contains("missing") {
                    (error_codes::SAMPLE_MISSING_FILE.code, s.clone())
                } else {
                    (error_codes::GENERIC.code, s.clone())
                }
            }
            Self::Db(e) => (error_codes::GENERIC.code, e.to_string()),
            Self::Connection(e) => (error_codes::GENERIC.code, e.to_string()),
            Self::Io(e) => (error_codes::GENERIC.code, e.to_string()),
            Self::Json(e) => (error_codes::GENERIC.code, e.to_string()),
            Self::Other(e) => (error_codes::GENERIC.code, e.to_string()),
        }
    }
}
