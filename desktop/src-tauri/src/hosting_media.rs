//! A small S3-compatible object store on disk, inside the app, for servers
//! the hosting kit runs (uploads, avatars, attachments). It speaks the subset
//! of S3 the relay's rust-s3 client uses: bucket head/list, object
//! put/get(range)/head/delete, multipart upload, bulk delete, version
//! listing and tagging. Requests aren't signature-checked: it listens on
//! 127.0.0.1 only. Started once per app run; a store already answering on
//! the port (another copy of the app) is left to serve.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use axum::body::{Body, Bytes};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;

static STARTED: OnceLock<u16> = OnceLock::new();

#[derive(Clone)]
struct Store {
    root: PathBuf,
}

fn enc(part: &str) -> String {
    let mut out = String::new();
    for b in part.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn dec(part: &str) -> String {
    let bytes = part.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&part[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// An object's ETag: a hash of its bytes, quoted, in the shape S3 uses.
fn etag_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
    format!("\"{hex}\"")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn xml(status: StatusCode, body: String) -> Response {
    (
        status,
        [("content-type", "application/xml")],
        format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{body}"),
    )
        .into_response()
}

fn not_found(key: &str) -> Response {
    xml(
        StatusCode::NOT_FOUND,
        format!(
            "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>{}</Key></Error>",
            xml_escape(key)
        ),
    )
}

impl Store {
    fn bucket_dir(&self, bucket: &str) -> PathBuf {
        self.root.join(enc(bucket))
    }
    /// One flat file per key: the key is encoded, so it can't climb out.
    fn object(&self, bucket: &str, key: &str) -> PathBuf {
        self.bucket_dir(bucket).join(enc(key))
    }
    fn meta(file: &Path) -> PathBuf {
        let mut name = file.file_name().unwrap_or_default().to_os_string();
        name.push(".meta.json");
        file.with_file_name(name)
    }
    fn uploads(&self) -> PathBuf {
        self.root.join(".uploads")
    }

    fn write(
        &self,
        bucket: &str,
        key: &str,
        body: &[u8],
        content_type: &str,
    ) -> std::io::Result<String> {
        std::fs::create_dir_all(self.bucket_dir(bucket))?;
        let file = self.object(bucket, key);
        let etag = etag_of(body);
        let tmp = file.with_extension(format!("tmp-{}", std::process::id()));
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, &file)?;
        let meta = serde_json::json!({
            "contentType": if content_type.is_empty() { "application/octet-stream" } else { content_type },
            "etag": etag,
            "modified": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        });
        std::fs::write(Self::meta(&file), meta.to_string())?;
        Ok(etag)
    }

    fn read_meta(file: &Path) -> serde_json::Value {
        std::fs::read_to_string(Self::meta(file))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    fn keys(&self, bucket: &str, prefix: &str) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.bucket_dir(bucket)) else {
            return Vec::new();
        };
        let mut keys: Vec<String> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.ends_with(".meta.json") && !n.contains(".tmp-"))
            .map(|n| dec(&n))
            .filter(|k| k.starts_with(prefix))
            .collect();
        keys.sort();
        keys
    }

    fn entry(&self, bucket: &str, key: &str) -> Option<(u64, String, String)> {
        let file = self.object(bucket, key);
        let size = std::fs::metadata(&file).ok()?.len();
        let meta = Self::read_meta(&file);
        let etag = meta["etag"].as_str().unwrap_or("\"\"").to_string();
        let modified = meta["modified"]
            .as_str()
            .unwrap_or("1970-01-01T00:00:00.000Z")
            .to_string();
        Some((size, etag, modified))
    }
}

/// aws-chunked bodies: "<hex>;chunk-signature=…\r\n<data>\r\n…0;…".
fn decode_aws_chunked(buf: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < buf.len() {
        let Some(nl) = buf[i..].windows(2).position(|w| w == b"\r\n") else {
            break;
        };
        let head = String::from_utf8_lossy(&buf[i..i + nl]);
        let size =
            usize::from_str_radix(head.split(';').next().unwrap_or("0").trim(), 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        let start = i + nl + 2;
        out.extend_from_slice(&buf[start..(start + size).min(buf.len())]);
        i = start + size + 2;
    }
    out
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}

async fn handle(
    State(store): State<Store>,
    method: Method,
    uri: Uri,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let path = uri.path().trim_start_matches('/');
    let mut parts = path.splitn(2, '/');
    let bucket = dec(parts.next().unwrap_or(""));
    let key = parts
        .next()
        .map(|k| k.split('/').map(dec).collect::<Vec<_>>().join("/"))
        .unwrap_or_default();
    let body = if header(&headers, "content-encoding").contains("aws-chunked") {
        decode_aws_chunked(&body)
    } else {
        body.to_vec()
    };
    let result =
        tokio::task::spawn_blocking(move || serve(store, method, bucket, key, q, headers, body))
            .await;
    result.unwrap_or_else(|e| {
        xml(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "<Error><Code>InternalError</Code><Message>{}</Message></Error>",
                xml_escape(&e.to_string())
            ),
        )
    })
}

fn serve(
    store: Store,
    method: Method,
    bucket: String,
    key: String,
    q: HashMap<String, String>,
    headers: HeaderMap,
    body: Vec<u8>,
) -> Response {
    let fail = |e: std::io::Error| {
        xml(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!(
                "<Error><Code>InternalError</Code><Message>{}</Message></Error>",
                xml_escape(&e.to_string())
            ),
        )
    };
    if bucket.is_empty() {
        return xml(
            StatusCode::OK,
            "<ListAllMyBucketsResult><Buckets/></ListAllMyBucketsResult>".into(),
        );
    }

    // ── bucket level ──
    if key.is_empty() {
        if method == Method::HEAD {
            return StatusCode::OK.into_response();
        }
        if method == Method::PUT {
            return match std::fs::create_dir_all(store.bucket_dir(&bucket)) {
                Ok(()) => StatusCode::OK.into_response(),
                Err(e) => fail(e),
            };
        }
        if method == Method::POST && q.contains_key("delete") {
            let text = String::from_utf8_lossy(&body);
            let mut deleted = String::new();
            for chunk in text.split("<Key>").skip(1) {
                let raw = chunk.split("</Key>").next().unwrap_or("");
                let k = raw
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&quot;", "\"")
                    .replace("&apos;", "'")
                    .replace("&amp;", "&");
                let file = store.object(&bucket, &k);
                let _ = std::fs::remove_file(&file);
                let _ = std::fs::remove_file(Store::meta(&file));
                deleted.push_str(&format!("<Deleted><Key>{}</Key></Deleted>", xml_escape(&k)));
            }
            return xml(
                StatusCode::OK,
                format!("<DeleteResult>{deleted}</DeleteResult>"),
            );
        }
        if method == Method::GET && q.contains_key("versions") {
            let prefix = q.get("prefix").cloned().unwrap_or_default();
            let mut out = String::new();
            for k in store.keys(&bucket, &prefix) {
                if let Some((size, etag, modified)) = store.entry(&bucket, &k) {
                    out.push_str(&format!(
                        "<Version><Key>{}</Key><VersionId>null</VersionId><IsLatest>true</IsLatest><LastModified>{modified}</LastModified><ETag>{}</ETag><Size>{size}</Size><StorageClass>STANDARD</StorageClass></Version>",
                        xml_escape(&k),
                        xml_escape(&etag)
                    ));
                }
            }
            return xml(
                StatusCode::OK,
                format!(
                    "<ListVersionsResult><Name>{}</Name><Prefix>{}</Prefix><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>{out}</ListVersionsResult>",
                    xml_escape(&bucket),
                    xml_escape(&prefix)
                ),
            );
        }
        if method == Method::GET {
            let prefix = q.get("prefix").cloned().unwrap_or_default();
            let max: usize = q
                .get("max-keys")
                .and_then(|m| m.parse().ok())
                .unwrap_or(1000)
                .min(1000);
            let after = q
                .get("continuation-token")
                .or_else(|| q.get("start-after"))
                .or_else(|| q.get("marker"))
                .cloned()
                .unwrap_or_default();
            let all: Vec<String> = store
                .keys(&bucket, &prefix)
                .into_iter()
                .filter(|k| after.is_empty() || k.as_str() > after.as_str())
                .collect();
            let page = &all[..all.len().min(max)];
            let truncated = all.len() > page.len();
            let mut contents = String::new();
            for k in page {
                if let Some((size, etag, modified)) = store.entry(&bucket, k) {
                    contents.push_str(&format!(
                        "<Contents><Key>{}</Key><LastModified>{modified}</LastModified><ETag>{}</ETag><Size>{size}</Size><StorageClass>STANDARD</StorageClass></Contents>",
                        xml_escape(k),
                        xml_escape(&etag)
                    ));
                }
            }
            let next = match (truncated, page.last()) {
                (true, Some(last)) => format!(
                    "<NextContinuationToken>{0}</NextContinuationToken><NextMarker>{0}</NextMarker>",
                    xml_escape(last)
                ),
                _ => String::new(),
            };
            return xml(
                StatusCode::OK,
                format!(
                    "<ListBucketResult><Name>{}</Name><Prefix>{}</Prefix><KeyCount>{}</KeyCount><MaxKeys>{max}</MaxKeys><IsTruncated>{truncated}</IsTruncated>{next}{contents}</ListBucketResult>",
                    xml_escape(&bucket),
                    xml_escape(&prefix),
                    page.len()
                ),
            );
        }
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }

    let file = store.object(&bucket, &key);

    // ── tagging (accepted, not kept) ──
    if q.contains_key("tagging") {
        return match method {
            Method::GET => xml(StatusCode::OK, "<Tagging><TagSet/></Tagging>".into()),
            Method::DELETE => StatusCode::NO_CONTENT.into_response(),
            _ => StatusCode::OK.into_response(),
        };
    }

    // ── multipart ──
    if method == Method::POST && q.contains_key("uploads") {
        let mut id = [0u8; 12];
        let _ = getrandom::getrandom(&mut id);
        let id: String = id.iter().map(|b| format!("{b:02x}")).collect();
        let dir = store.uploads().join(&id);
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return fail(e);
        }
        let _ = std::fs::write(dir.join("content-type"), header(&headers, "content-type"));
        return xml(
            StatusCode::OK,
            format!(
                "<InitiateMultipartUploadResult><Bucket>{}</Bucket><Key>{}</Key><UploadId>{id}</UploadId></InitiateMultipartUploadResult>",
                xml_escape(&bucket),
                xml_escape(&key)
            ),
        );
    }
    if let Some(upload) = q.get("uploadId") {
        let id: String = upload.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        let dir = store.uploads().join(&id);
        match method {
            Method::PUT => {
                let n: u32 = q
                    .get("partNumber")
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0);
                if let Err(e) = std::fs::write(dir.join(format!("part-{n:06}")), &body) {
                    return fail(e);
                }
                let etag = etag_of(&body);
                let mut res = StatusCode::OK.into_response();
                if let Ok(v) = HeaderValue::from_str(&etag) {
                    res.headers_mut().insert("etag", v);
                }
                return res;
            }
            Method::POST => {
                let mut parts: Vec<PathBuf> = std::fs::read_dir(&dir)
                    .map(|rd| {
                        rd.filter_map(|e| e.ok())
                            .map(|e| e.path())
                            .filter(|p| {
                                p.file_name()
                                    .is_some_and(|n| n.to_string_lossy().starts_with("part-"))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                parts.sort();
                let mut whole = Vec::new();
                for part in parts {
                    match std::fs::read(&part) {
                        Ok(bytes) => whole.extend_from_slice(&bytes),
                        Err(e) => return fail(e),
                    }
                }
                let content_type =
                    std::fs::read_to_string(dir.join("content-type")).unwrap_or_default();
                let etag = match store.write(&bucket, &key, &whole, &content_type) {
                    Ok(etag) => etag,
                    Err(e) => return fail(e),
                };
                let _ = std::fs::remove_dir_all(&dir);
                return xml(
                    StatusCode::OK,
                    format!(
                        "<CompleteMultipartUploadResult><Bucket>{}</Bucket><Key>{}</Key><ETag>{}</ETag></CompleteMultipartUploadResult>",
                        xml_escape(&bucket),
                        xml_escape(&key),
                        xml_escape(&etag)
                    ),
                );
            }
            Method::DELETE => {
                let _ = std::fs::remove_dir_all(&dir);
                return StatusCode::NO_CONTENT.into_response();
            }
            _ => {}
        }
    }

    // ── objects ──
    match method {
        Method::PUT => match store.write(&bucket, &key, &body, header(&headers, "content-type")) {
            Ok(etag) => {
                let mut res = StatusCode::OK.into_response();
                if let Ok(v) = HeaderValue::from_str(&etag) {
                    res.headers_mut().insert("etag", v);
                }
                res
            }
            Err(e) => fail(e),
        },
        Method::DELETE => {
            let _ = std::fs::remove_file(&file);
            let _ = std::fs::remove_file(Store::meta(&file));
            StatusCode::NO_CONTENT.into_response()
        }
        Method::GET | Method::HEAD => {
            let Ok(size) = std::fs::metadata(&file).map(|m| m.len()) else {
                return if method == Method::HEAD {
                    StatusCode::NOT_FOUND.into_response()
                } else {
                    not_found(&key)
                };
            };
            let meta = Store::read_meta(&file);
            let content_type = meta["contentType"]
                .as_str()
                .unwrap_or("application/octet-stream")
                .to_string();
            let etag = meta["etag"].as_str().unwrap_or("\"\"").to_string();
            let modified = meta["modified"]
                .as_str()
                .and_then(|m| chrono::DateTime::parse_from_rfc3339(m).ok())
                .map(|d| d.to_rfc2822())
                .unwrap_or_default();
            let mut builder = Response::builder()
                .header("content-type", content_type)
                .header("etag", etag)
                .header("accept-ranges", "bytes");
            if !modified.is_empty() {
                builder = builder.header("last-modified", modified);
            }
            if method == Method::HEAD {
                return builder
                    .status(StatusCode::OK)
                    .header("content-length", size.to_string())
                    .body(Body::empty())
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }
            let bytes = match std::fs::read(&file) {
                Ok(b) => b,
                Err(e) => return fail(e),
            };
            let range = header(&headers, "range")
                .strip_prefix("bytes=")
                .map(str::to_string);
            if let Some(range) = range {
                let (a, b) = range.split_once('-').unwrap_or(("", ""));
                let len = bytes.len() as u64;
                let (start, end) = if a.is_empty() {
                    let n: u64 = b.parse().unwrap_or(0);
                    (len.saturating_sub(n), len.saturating_sub(1))
                } else {
                    let s: u64 = a.parse().unwrap_or(0);
                    let e: u64 = if b.is_empty() {
                        len.saturating_sub(1)
                    } else {
                        b.parse::<u64>().unwrap_or(0).min(len.saturating_sub(1))
                    };
                    (s, e)
                };
                if len == 0 || start > end || start >= len {
                    return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
                }
                return builder
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("content-range", format!("bytes {start}-{end}/{len}"))
                    .body(Body::from(bytes[start as usize..=end as usize].to_vec()))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }
            builder
                .status(StatusCode::OK)
                .body(Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

/// Start the store on `port` (once per run).
pub fn ensure_running(root: PathBuf, port: u16) -> Result<(), String> {
    if STARTED.get().is_some() {
        return Ok(());
    }
    std::fs::create_dir_all(root.join(".uploads"))
        .map_err(|e| format!("make {}: {e}", root.display()))?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("the file store couldn't use port {port}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let _ = STARTED.set(port);
    let store = Store { root };
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .fallback(handle)
            .layer(axum::extract::DefaultBodyLimit::max(600 * 1024 * 1024))
            .with_state(store);
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("buzz-desktop: hosting file store stopped: {e}");
                }
            }
            Err(e) => eprintln!("buzz-desktop: hosting file store: {e}"),
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_through_file_names() {
        let key = "communities/abc/sha256 x+y.png";
        assert_eq!(dec(&enc(key)), key);
        assert!(!enc("../escape").contains('/'));
    }

    #[test]
    fn aws_chunked_bodies_decode() {
        let body = b"5;chunk-signature=abc\r\nhello\r\n0;chunk-signature=def\r\n\r\n";
        assert_eq!(decode_aws_chunked(body), b"hello");
    }

    #[test]
    fn objects_write_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store {
            root: dir.path().to_path_buf(),
        };
        store.write("b", "a/one.txt", b"1", "text/plain").unwrap();
        store.write("b", "a/two.txt", b"22", "").unwrap();
        assert_eq!(store.keys("b", "a/"), vec!["a/one.txt", "a/two.txt"]);
        assert_eq!(store.entry("b", "a/two.txt").unwrap().0, 2);
    }
}
