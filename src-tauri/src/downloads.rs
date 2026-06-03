use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub episode_id: String,
    pub audio_url: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub episode_id: String,
    pub path: String,
    pub bytes: u64,
    pub mime_type: Option<String>,
    pub downloaded_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub bytes: u64,
    pub files: usize,
}

#[tauri::command]
pub async fn download_episode(
    app: AppHandle,
    request: DownloadRequest,
) -> Result<DownloadEntry, String> {
    let dir = downloads_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| error.to_string())?;
    let file_name = safe_file_name(&request.file_name);
    let path = dir.join(format!(
        "{}__{}",
        safe_file_name(&request.episode_id),
        file_name
    ));

    let client = reqwest::Client::builder()
        .user_agent("ElephantPod/0.2 (+https://elephanthand.com)")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(&request.audio_url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let tmp_path = path.with_extension("download");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|error| error.to_string())?;
    let mut bytes = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|error| error.to_string())?;

    let entry = DownloadEntry {
        episode_id: request.episode_id,
        path: path.to_string_lossy().to_string(),
        bytes,
        mime_type,
        downloaded_at: chrono::Utc::now().to_rfc3339(),
    };
    let mut manifest = read_manifest(&app).await?;
    manifest.retain(|item| item.episode_id != entry.episode_id);
    manifest.push(entry.clone());
    write_manifest(&app, &manifest).await?;
    Ok(entry)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_downloaded_episode(app: AppHandle, episode_id: String) -> Result<bool, String> {
    let mut manifest = read_manifest(&app).await?;
    let mut deleted = false;
    let mut next = Vec::new();
    for item in manifest.drain(..) {
        if item.episode_id == episode_id {
            let _ = tokio::fs::remove_file(&item.path).await;
            deleted = true;
        } else {
            next.push(item);
        }
    }
    write_manifest(&app, &next).await?;
    Ok(deleted)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn downloaded_episode_path(
    app: AppHandle,
    episode_id: String,
) -> Result<Option<String>, String> {
    let manifest = read_manifest(&app).await?;
    Ok(manifest
        .into_iter()
        .find(|item| item.episode_id == episode_id)
        .map(|item| item.path))
}

#[tauri::command]
pub async fn download_storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let manifest = read_manifest(&app).await?;
    let mut bytes = 0_u64;
    let mut files = 0_usize;
    for item in manifest {
        if let Ok(metadata) = tokio::fs::metadata(&item.path).await {
            bytes += metadata.len();
            files += 1;
        }
    }
    Ok(StorageStats { bytes, files })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn prune_downloads(app: AppHandle, max_bytes: u64) -> Result<Vec<String>, String> {
    let mut manifest = read_manifest(&app).await?;
    manifest.sort_by(|a, b| a.downloaded_at.cmp(&b.downloaded_at));
    let mut total: u64 = manifest.iter().map(|item| item.bytes).sum();
    let mut deleted_ids = Vec::new();
    let mut kept = Vec::new();

    for item in manifest {
        if total > max_bytes {
            let _ = tokio::fs::remove_file(&item.path).await;
            total = total.saturating_sub(item.bytes);
            deleted_ids.push(item.episode_id);
        } else {
            kept.push(item);
        }
    }
    write_manifest(&app, &kept).await?;
    Ok(deleted_ids)
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("downloads"))
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(downloads_dir(app)?.join("manifest.json"))
}

async fn read_manifest(app: &AppHandle) -> Result<Vec<DownloadEntry>, String> {
    let path = manifest_path(app)?;
    if !Path::new(&path).exists() {
        return Ok(Vec::new());
    }
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

async fn write_manifest(app: &AppHandle, manifest: &[DownloadEntry]) -> Result<(), String> {
    let path = manifest_path(app)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    tokio::fs::write(path, content)
        .await
        .map_err(|error| error.to_string())
}

fn safe_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' => ch,
            _ => '_',
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "episode.mp3".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}
