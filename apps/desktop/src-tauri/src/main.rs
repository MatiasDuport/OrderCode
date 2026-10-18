#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chatgpt;
mod xai;

use serde::Serialize;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use std::{collections::{hash_map::DefaultHasher, HashMap}, env, fs, hash::{Hash, Hasher}, io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, Command, Stdio}, sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc, Arc, Mutex}, thread, time::Duration};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

struct BrokerState {
    workspace_root: Mutex<Option<PathBuf>>,
    active_session: Mutex<Option<String>>,
    harness: Mutex<Option<Arc<HarnessProcess>>>,
    harness_lifecycle: tauri::async_runtime::Mutex<()>,
    account_operation: tauri::async_runtime::Mutex<()>,
    terminals: Mutex<HashMap<String, Arc<TerminalProcess>>>,
    update_installing: AtomicBool,
    active_harness_requests: AtomicUsize,
}

#[derive(Default)]
struct UpdaterState {
    operation: tauri::async_runtime::Mutex<()>,
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

fn update_artifact_identity(update: &Update) -> serde_json::Value {
    serde_json::json!({
        "currentVersion": update.current_version,
        "version": update.version,
        "target": update.target,
        "url": update.download_url.as_str(),
        "signature": update.signature,
        "notes": update.body,
        "publishedAt": update.date.map(|date| date.to_string()),
        "manifest": update.raw_json,
    })
}

fn retain_matching_update_download(previous: Option<&serde_json::Value>, current: &serde_json::Value, downloaded: &mut Option<Vec<u8>>) {
    if previous != Some(current) { *downloaded = None; }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTransferProgress {
    downloaded_bytes: u64,
    content_length: Option<u64>,
    complete: bool,
}

struct HarnessProcess {
    instance_id: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>,
}

struct TerminalProcess {
    session_id: String,
    child: Mutex<Box<dyn PtyChild + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
}

impl TerminalProcess {
    fn terminate(&self) {
        if let Ok(mut child) = self.child.lock() {
            if child.try_wait().ok().flatten().is_none() { let _ = child.kill(); }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInfo {
    terminal_id: String,
    session_id: String,
    shell: String,
    cwd: String,
    pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    terminal_id: String,
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    session_id: String,
    code: u32,
    success: bool,
}

impl Default for BrokerState {
    fn default() -> Self {
        Self { workspace_root: Mutex::new(None), active_session: Mutex::new(None), harness: Mutex::new(None), harness_lifecycle: tauri::async_runtime::Mutex::new(()), account_operation: tauri::async_runtime::Mutex::new(()), terminals: Mutex::new(HashMap::new()), update_installing: AtomicBool::new(false), active_harness_requests: AtomicUsize::new(0) }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    ok: bool,
    version: &'static str,
    platform: &'static str,
    harness_connected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    path: String,
    kind: &'static str,
    size: u64,
}

#[tauri::command]
fn health(state: State<'_, BrokerState>) -> Health {
    let harness_connected = state.harness.lock().ok().and_then(|harness| harness.as_ref().cloned()).map(|process| is_harness_alive(&process)).unwrap_or(false);
    Health { ok: true, version: env!("CARGO_PKG_VERSION"), platform: std::env::consts::OS, harness_connected }
}

#[tauri::command]
async fn harness_start(app: tauri::AppHandle, state: State<'_, BrokerState>, workspace_path: Option<String>, script_path: Option<String>) -> Result<Health, String> {
    let _active_request = begin_harness_request(&state)?;
    let _lifecycle = state.harness_lifecycle.lock().await;
    let existing = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = existing {
        if is_harness_alive(&process) {
            if let Some(project_path) = workspace_path.as_deref() { restore_project_deploy_hook(Arc::clone(&process), project_path).await?; }
            return Ok(Health { ok: true, version: env!("CARGO_PKG_VERSION"), platform: std::env::consts::OS, harness_connected: true });
        }
    }
    let resource_dir = app.path().resource_dir().map_err(|error| format!("No se pudo resolver la carpeta de recursos de OrderCode: {error}"))?;
    let script = resolve_harness_script(script_path.as_deref(), &resource_dir)?;
    let node = resolve_node_binary(&resource_dir)?;
    let restore_project_path = workspace_path.clone();
    let working_directory = workspace_path.map(PathBuf::from).filter(|path| path.is_dir()).or_else(|| std::env::current_dir().ok());
    let mut command = Command::new(node);
    command.arg(&script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW; the embedded terminal uses its own PTY.
    if let Some(directory) = working_directory { command.current_dir(directory); }
    let mut child = command.spawn().map_err(|error| format!("No se pudo iniciar Harness con Node.js: {error}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "Harness no expuso stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Harness no expuso stdout".to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::<String, mpsc::Sender<serde_json::Value>>::new()));
    let pending_reader = Arc::clone(&pending);
    let notification_app = app.clone();
    let instance_id = uuid::Uuid::new_v4().to_string();
    let reader_instance_id = instance_id.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break; };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
            if value.get("method").and_then(serde_json::Value::as_str) == Some("provider.oauth.tokens.rotated") {
                let current_process = notification_app.try_state::<BrokerState>().and_then(|state| state.harness.lock().ok().map(|process| process.as_ref().is_none_or(|process| process.instance_id == reader_instance_id))).unwrap_or(false);
                if !current_process { continue; }
                let credential = value.get("params").and_then(|params| params.get("credential")).cloned();
                let provider_id = value.get("params").and_then(|params| params.get("providerId")).and_then(serde_json::Value::as_str);
                match provider_id {
                    Some("openai_chatgpt") => if let Some(credential) = credential.and_then(|value| serde_json::from_value::<chatgpt::ChatGPTCredential>(value).ok()) {
                        if let Err(error) = chatgpt::save_rotated_credential(&credential) { let _ = notification_app.emit("ordercode-provider-auth-error", error); }
                    },
                    Some("xai_plan") => if let Some(credential) = credential.and_then(|value| serde_json::from_value::<xai::XaiCredential>(value).ok()) {
                        if let Err(error) = xai::save_rotated_credential(&credential) { let _ = notification_app.emit("ordercode-provider-auth-error", error); }
                    },
                    _ => {}
                }
                continue;
            }
            let Some(key) = value.get("id").map(rpc_id_key) else { continue; };
            if let Ok(mut waiting) = pending_reader.lock() {
                if let Some(sender) = waiting.remove(&key) { let _ = sender.send(value); }
            }
        }
        if let Ok(mut waiting) = pending_reader.lock() {
            for (_, sender) in waiting.drain() {
                let _ = sender.send(serde_json::json!({ "error": { "message": "Harness stdout closed unexpectedly" } }));
            }
        }
    });
    let process = Arc::new(HarnessProcess { instance_id, child: Mutex::new(child), stdin: Mutex::new(stdin), pending });
    *state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())? = Some(Arc::clone(&process));
    let _response = match request_harness_async(Arc::clone(&process), serde_json::json!({ "jsonrpc": "2.0", "id": "health", "method": "health", "params": {} })).await {
        Ok(value) if value.get("result").is_some() => value,
        Ok(_) => { let _ = stop_harness_unlocked(&state).await; return Err("Harness no respondió a la comprobación de salud".into()); }
        Err(error) => { let _ = stop_harness_unlocked(&state).await; return Err(error); }
    };
    let initialization: Result<(), String> = async {
    for provider in ["openai", "openrouter", "opencode_zen", "deepseek", "mistral", "groq", "together", "fireworks", "cerebras", "anthropic", "xai", "gemini"] {
        if let Ok(key) = keyring::Entry::new("OrderCode", provider).and_then(|entry| entry.get_password()) {
            let request = serde_json::json!({ "jsonrpc": "2.0", "id": format!("credential-{provider}"), "method": "provider.configure", "params": { "providerId": provider, "apiKey": key } });
            request_harness_async(Arc::clone(&process), request).await?;
        }
    }
    if let Some(credential) = chatgpt::load_credential() {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-openai-chatgpt", "method": "provider.auth.configure", "params": { "providerId": "openai_chatgpt", "credential": credential } });
        request_harness_async(Arc::clone(&process), request).await?;
    }
    if let Some(credential) = xai::load_credential() {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-xai-plan", "method": "provider.auth.configure", "params": { "providerId": "xai_plan", "credential": credential } });
        request_harness_async(Arc::clone(&process), request).await?;
    }
    let provider_list = request_harness_async(Arc::clone(&process), serde_json::json!({ "jsonrpc": "2.0", "id": "provider-credential-list", "method": "providers.list", "params": {} })).await?;
    if let Some(providers) = provider_list.get("result").and_then(serde_json::Value::as_array) {
        for provider in providers {
            let Some(id) = provider.get("id").and_then(serde_json::Value::as_str).filter(|id| id.starts_with("custom_") && supported_provider(id)) else { continue; };
            if let Ok(key) = keyring::Entry::new("OrderCode", id).and_then(|entry| entry.get_password()) {
                let request = serde_json::json!({ "jsonrpc": "2.0", "id": format!("credential-{id}"), "method": "provider.configure", "params": { "providerId": id, "apiKey": key } });
                request_harness_async(Arc::clone(&process), request).await?;
            }
        }
    }
    if let Some(project_path) = restore_project_path.as_deref() { restore_project_deploy_hook(Arc::clone(&process), project_path).await?; }
    let stored = request_harness_async(Arc::clone(&process), serde_json::json!({ "jsonrpc": "2.0", "id": "mcp-credential-list", "method": "mcp.credentials.restoreList", "params": {} })).await?;
    if let Some(servers) = stored.get("result").and_then(serde_json::Value::as_array) {
        for server in servers {
            let Some(server_id) = server.get("id").and_then(serde_json::Value::as_str) else { continue; };
            let Some(keys) = server.get("secretKeys").and_then(serde_json::Value::as_array) else { continue; };
            let mut credentials = serde_json::Map::new();
            for key in keys.iter().filter_map(serde_json::Value::as_str) {
                if let Ok(value) = keyring::Entry::new("OrderCode", &mcp_secret_account(server_id, key)?).and_then(|entry| entry.get_password()) {
                    credentials.insert(key.to_string(), serde_json::Value::String(value));
                }
            }
            let request = serde_json::json!({ "jsonrpc": "2.0", "id": format!("mcp-credential-{server_id}"), "method": "mcp.credentials.configure", "params": { "serverId": server_id, "credentials": credentials } });
            request_harness_async(Arc::clone(&process), request).await?;
        }
    }
    Ok(())
    }.await;
    if let Err(error) = initialization {
        let _ = stop_harness_unlocked(&state).await;
        return Err(error);
    }
    Ok(Health { ok: true, version: env!("CARGO_PKG_VERSION"), platform: std::env::consts::OS, harness_connected: true })
}

#[tauri::command]
async fn harness_request(state: State<'_, BrokerState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let _active_request = begin_harness_request(&state)?;
    let result = async {
        let process = {
            let _lifecycle = state.harness_lifecycle.lock().await;
            let mut current = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?;
            let process = current.as_ref().cloned().ok_or_else(|| "Harness no está iniciado".to_string())?;
            if !is_harness_alive(&process) {
                *current = None;
                return Err("El proceso Harness terminó inesperadamente".into());
            }
            process
        };
        request_harness_async(process, request).await
    }.await;
    result
}

#[tauri::command]
async fn harness_stop(state: State<'_, BrokerState>) -> Result<(), String> {
    stop_harness(&state).await
}

async fn stop_harness(state: &BrokerState) -> Result<(), String> {
    let _lifecycle = state.harness_lifecycle.lock().await;
    stop_harness_unlocked(state).await
}

async fn stop_harness_unlocked(state: &BrokerState) -> Result<(), String> {
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.take();
    if let Some(process) = process {
        let shutdown = serde_json::json!({ "jsonrpc": "2.0", "id": "shutdown", "method": "shutdown", "params": {} });
        let _ = request_harness_async(Arc::clone(&process), shutdown).await;
        let mut child = process.child.lock().map_err(|_| "No se pudo detener Harness".to_string())?;
        if child.try_wait().map_err(|error| format!("No se pudo consultar Harness: {error}"))?.is_none() { child.kill().map_err(|error| format!("No se pudo detener Harness: {error}"))?; }
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
async fn updater_check(app: tauri::AppHandle, state: State<'_, UpdaterState>) -> Result<Option<UpdateMetadata>, String> {
    let _operation = state.operation.lock().await;
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("Las actualizaciones están disponibles para OrderCode en Windows de 64 bits.".into());
    }
    let updater = app.updater_builder()
        .timeout(Duration::from_secs(25))
        .build().map_err(|error| format!("No se pudo preparar el actualizador: {error}"))?;
    let update = updater.check().await.map_err(|error| format!("No se pudo consultar el canal público de actualizaciones. Comprueba que haya un Release estable publicado con `latest.json`. Detalle: {error}"))?;
    let Some(update) = update else {
        *state.pending.lock().map_err(|_| "No se pudo actualizar el estado del actualizador".to_string())? = None;
        *state.downloaded.lock().map_err(|_| "No se pudo limpiar la descarga anterior".to_string())? = None;
        return Ok(None);
    };
    let metadata = UpdateMetadata { version: update.version.clone(), current_version: update.current_version.clone(), notes: update.body.clone(), published_at: update.date.map(|date| date.to_string()) };
    let mut pending = state.pending.lock().map_err(|_| "No se pudo guardar la actualización encontrada".to_string())?;
    let previous_identity = pending.as_ref().map(update_artifact_identity);
    let current_identity = update_artifact_identity(&update);
    let mut downloaded = state.downloaded.lock().map_err(|_| "No se pudo acceder a la descarga anterior".to_string())?;
    retain_matching_update_download(previous_identity.as_ref(), &current_identity, &mut downloaded);
    *pending = Some(update);
    Ok(Some(metadata))
}

#[tauri::command]
async fn updater_download(app: tauri::AppHandle, state: State<'_, UpdaterState>) -> Result<u64, String> {
    let _operation = state.operation.lock().await;
    if let Some(size) = state.downloaded.lock().map_err(|_| "No se pudo acceder a la descarga".to_string())?.as_ref().map(|bytes| bytes.len() as u64) { return Ok(size); }
    let update = state.pending.lock().map_err(|_| "No se pudo acceder a la actualización encontrada".to_string())?.as_ref().cloned().ok_or_else(|| "Primero comprueba si hay una actualización disponible.".to_string())?;
    let app_for_progress = app.clone();
    let mut downloaded = 0_u64;
    let bytes = update.download(|chunk, content_length| {
        downloaded = downloaded.saturating_add(chunk as u64);
        let _ = app_for_progress.emit("ordercode-update-progress", UpdateTransferProgress { downloaded_bytes: downloaded, content_length, complete: false });
    }, || {}).await.map_err(|error| format!("No se pudo descargar o verificar la actualización: {error}"))?;
    update.verify(&bytes).map_err(|error| format!("La firma del paquete no es válida; se rechazó la actualización: {error}"))?;
    let size = bytes.len() as u64;
    *state.downloaded.lock().map_err(|_| "No se pudo guardar el paquete descargado".to_string())? = Some(bytes);
    let _ = app.emit("ordercode-update-progress", UpdateTransferProgress { downloaded_bytes: size, content_length: Some(size), complete: true });
    Ok(size)
}

struct UpdateInstallGate<'a>(&'a AtomicBool);

impl Drop for UpdateInstallGate<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

struct ActiveHarnessRequest<'a>(&'a AtomicUsize);

impl Drop for ActiveHarnessRequest<'_> {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::AcqRel); }
}

fn begin_harness_request(state: &BrokerState) -> Result<ActiveHarnessRequest<'_>, String> {
    ensure_update_not_installing(state)?;
    state.active_harness_requests.fetch_add(1, Ordering::AcqRel);
    if state.update_installing.load(Ordering::Acquire) {
        state.active_harness_requests.fetch_sub(1, Ordering::AcqRel);
        return Err("OrderCode está preparando una actualización. Inténtalo de nuevo en un momento.".into());
    }
    Ok(ActiveHarnessRequest(&state.active_harness_requests))
}

#[tauri::command]
async fn updater_install(updates: State<'_, UpdaterState>, broker: State<'_, BrokerState>, editor_dirty: bool) -> Result<(), String> {
    let _operation = updates.operation.lock().await;
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("La instalación automática está disponible para OrderCode en Windows de 64 bits.".into());
    }
    if editor_dirty { return Err("Guarda o descarta los cambios pendientes del editor antes de actualizar.".into()); }
    if broker.update_installing.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("La instalación de una actualización ya está en curso.".into());
    }
    let _install_gate = UpdateInstallGate(&broker.update_installing);
    if broker.active_harness_requests.load(Ordering::Acquire) > 0 {
        return Err("Termina la operación activa y vuelve a intentar la instalación.".into());
    }
    if !broker.terminals.lock().map_err(|_| "No se pudo comprobar las terminales abiertas".to_string())?.is_empty() {
        return Err("Cierra las terminales abiertas antes de instalar la actualización.".into());
    }
    ensure_harness_quiet_for_update(&broker).await?;
    let update = updates.pending.lock().map_err(|_| "No se pudo acceder a la actualización".to_string())?.as_ref().cloned().ok_or_else(|| "La actualización venció. Busca de nuevo antes de instalar.".to_string())?;
    let bytes = updates.downloaded.lock().map_err(|_| "No se pudo acceder al paquete descargado".to_string())?.take().ok_or_else(|| "Descarga la actualización antes de instalarla.".to_string())?;
    update.verify(&bytes).map_err(|error| format!("La firma del paquete no es válida; se rechazó la instalación: {error}"))?;
    stop_harness(&broker).await.map_err(|error| format!("No se pudo cerrar Harness de forma segura; la actualización no se instaló: {error}"))?;
    update.install(bytes).map_err(|error| format!("No se pudo iniciar el instalador de OrderCode: {error}. Reinicia la aplicación para volver a iniciar Harness."))
}

async fn ensure_harness_quiet_for_update(state: &BrokerState) -> Result<(), String> {
    let process = state.harness.lock().map_err(|_| "No se pudo comprobar el Harness".to_string())?.as_ref().cloned();
    let Some(process) = process.filter(is_harness_alive) else { return Ok(()); };
    let response = request_harness_async(process, serde_json::json!({ "jsonrpc": "2.0", "id": format!("update-safety-{}", uuid::Uuid::new_v4()), "method": "session.list", "params": {} })).await?;
    let sessions = response.get("result").and_then(serde_json::Value::as_array).ok_or_else(|| "No se pudo verificar el estado de las sesiones; por seguridad, no se instalará la actualización.".to_string())?;
    let active = sessions.iter().filter_map(|session| session.get("state").and_then(serde_json::Value::as_str)).any(|status| matches!(status.to_ascii_uppercase().as_str(), "PREPARING" | "RUNNING" | "WAITING_APPROVAL" | "WAITING_USER" | "PAUSING" | "PAUSED" | "RECOVERY_REQUIRED"));
    if active { return Err("Termina o cierra las sesiones activas antes de instalar la actualización.".into()); }
    Ok(())
}

fn ensure_update_not_installing(state: &BrokerState) -> Result<(), String> {
    if state.update_installing.load(Ordering::Acquire) { Err("OrderCode está cerrando sus procesos para instalar una actualización.".into()) } else { Ok(()) }
}

#[tauri::command]
fn provider_set_key(provider_id: String, api_key: String) -> Result<(), String> {
    if !supported_provider(&provider_id) { return Err("Proveedor desconocido".into()); }
    let key = api_key.trim();
    if key.is_empty() || key.len() > 4096 || key.contains('\0') { return Err("La clave debe contener entre 1 y 4096 caracteres válidos".into()); }
    keyring::Entry::new("OrderCode", &provider_id).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?
        .set_password(key).map_err(|error| format!("No se pudo guardar la credencial en el almacén seguro: {error}"))
}

#[tauri::command]
fn provider_remove_key(provider_id: String) -> Result<(), String> {
    if !supported_provider(&provider_id) { return Err("Proveedor desconocido".into()); }
    match keyring::Entry::new("OrderCode", &provider_id).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("No se pudo eliminar la credencial: {error}")),
    }
}

#[tauri::command]
fn provider_keys_status(provider_ids: Option<Vec<String>>) -> Result<HashMap<String, bool>, String> {
    let mut result = HashMap::new();
    let mut providers = vec!["openai".to_string(), "openrouter".to_string(), "opencode_zen".to_string(), "deepseek".to_string(), "mistral".to_string(), "groq".to_string(), "together".to_string(), "fireworks".to_string(), "cerebras".to_string(), "anthropic".to_string(), "xai".to_string(), "gemini".to_string()];
    if let Some(provider_ids) = provider_ids { providers.extend(provider_ids.into_iter().filter(|provider| supported_provider(provider) || provider == "openai_chatgpt" || provider == "xai_plan")); }
    providers.sort();
    providers.dedup();
    for provider in providers {
        if provider == "openai_chatgpt" { result.insert(provider, chatgpt::account_status().connected); continue; }
        if provider == "xai_plan" { result.insert(provider, xai::account_status().connected); continue; }
        let entry = keyring::Entry::new("OrderCode", &provider).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?;
        result.insert(provider.clone(), entry.get_password().is_ok());
    }
    Ok(result)
}

#[tauri::command]
fn chatgpt_account_status() -> chatgpt::ChatGPTAccountStatus { chatgpt::account_status() }

#[tauri::command]
fn xai_account_status() -> xai::XaiAccountStatus { xai::account_status() }

#[tauri::command]
async fn chatgpt_connect(state: State<'_, BrokerState>) -> Result<chatgpt::ChatGPTAccountStatus, String> {
    let _active_request = begin_harness_request(&state)?;
    let _account_operation = state.account_operation.lock().await;
    let credential = chatgpt::connect().await?;
    let _lifecycle = state.harness_lifecycle.lock().await;
    chatgpt::save_credential(&credential)?;
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process.filter(is_harness_alive) {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-openai-chatgpt", "method": "provider.auth.configure", "params": { "providerId": "openai_chatgpt", "credential": credential } });
        request_harness_async(process, request).await?;
    }
    Ok(chatgpt::account_status())
}

#[tauri::command]
async fn chatgpt_disconnect(state: State<'_, BrokerState>) -> Result<chatgpt::ChatGPTAccountStatus, String> {
    let _active_request = begin_harness_request(&state)?;
    let _account_operation = state.account_operation.lock().await;
    let lifecycle = state.harness_lifecycle.lock().await;
    let credential = chatgpt::take_credential()?;
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process.filter(is_harness_alive) {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-openai-chatgpt-disconnect", "method": "provider.auth.configure", "params": { "providerId": "openai_chatgpt", "credential": null } });
        request_harness_async(process, request).await?;
    }
    drop(lifecycle);
    if let Some(credential) = credential { chatgpt::revoke_credential(&credential).await; }
    Ok(chatgpt::account_status())
}

#[tauri::command]
async fn xai_connect(app: tauri::AppHandle, state: State<'_, BrokerState>) -> Result<xai::XaiAccountStatus, String> {
    let _active_request = begin_harness_request(&state)?;
    let _account_operation = state.account_operation.lock().await;
    let credential = xai::connect(&app).await?;
    let _lifecycle = state.harness_lifecycle.lock().await;
    xai::save_credential(&credential)?;
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process.filter(is_harness_alive) {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-xai-plan", "method": "provider.auth.configure", "params": { "providerId": "xai_plan", "credential": credential } });
        request_harness_async(process, request).await?;
    }
    Ok(xai::account_status())
}

#[tauri::command]
async fn xai_disconnect(state: State<'_, BrokerState>) -> Result<xai::XaiAccountStatus, String> {
    let _active_request = begin_harness_request(&state)?;
    let _account_operation = state.account_operation.lock().await;
    let lifecycle = state.harness_lifecycle.lock().await;
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process.filter(is_harness_alive) {
        let request = serde_json::json!({ "jsonrpc": "2.0", "id": "credential-xai-plan-disconnect", "method": "provider.auth.configure", "params": { "providerId": "xai_plan", "credential": null } });
        request_harness_async(process, request).await?;
    }
    let credential = xai::take_credential()?;
    drop(lifecycle);
    if let Some(credential) = credential { xai::revoke_credential(&credential).await; }
    Ok(xai::account_status())
}

#[tauri::command]
async fn release_hook_set(state: State<'_, BrokerState>, project_path: String, url: String) -> Result<(), String> {
    let root = require_active_project(&state, &project_path)?;
    let segments: Vec<&str> = url.split('/').collect();
    if url.len() > 2_000 || url.chars().any(char::is_whitespace) || url.contains('?') || url.contains('#') || url.contains('@')
        || !url.starts_with("https://api.vercel.com/v1/integrations/deploy/") || segments.len() != 8
        || segments[6].len() < 8 || segments[7].len() < 8 {
        return Err("La URL debe ser un Deploy Hook HTTPS válido de Vercel".into());
    }
    let account = release_hook_account(&root)?;
    keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?
        .set_password(&url).map_err(|error| format!("No se pudo guardar el Deploy Hook: {error}"))?;
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process {
        configure_project_deploy_hook(process, &root, Some(url)).await?;
    }
    Ok(())
}

#[tauri::command]
async fn release_hook_remove(state: State<'_, BrokerState>, project_path: String) -> Result<(), String> {
    let root = require_active_project(&state, &project_path)?;
    let account = release_hook_account(&root)?;
    match keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {},
        Err(error) => return Err(format!("No se pudo eliminar el Deploy Hook: {error}")),
    }
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process {
        configure_project_deploy_hook(process, &root, None).await?;
    }
    Ok(())
}

#[tauri::command]
async fn release_hook_status(state: State<'_, BrokerState>, project_path: String) -> Result<bool, String> {
    let root = require_active_project(&state, &project_path)?;
    restore_project_deploy_hook_for_state(&state, &root).await
}

fn require_active_project(state: &BrokerState, project_path: &str) -> Result<PathBuf, String> {
    let requested = normalize_root(project_path)?;
    let active = state.workspace_root.lock().map_err(|_| "No se pudo comprobar el workspace activo".to_string())?.clone();
    if active.as_deref() != Some(requested.as_path()) { return Err("Activa este workspace antes de cambiar su Deploy Hook".into()); }
    Ok(requested)
}

fn release_hook_account(project_path: &Path) -> Result<String, String> {
    let canonical = project_path.canonicalize().map_err(|error| format!("No se pudo validar el workspace de Release Center: {error}"))?;
    if !canonical.is_dir() { return Err("El workspace de Release Center debe ser una carpeta existente".into()); }
    let value = canonical.to_string_lossy();
    let identity = if cfg!(windows) { value.to_lowercase() } else { value.to_string() };
    let mut first = DefaultHasher::new(); format!("OrderCode:{identity}").hash(&mut first);
    let mut second = DefaultHasher::new(); format!("OrderCode:release:{identity}").hash(&mut second);
    Ok(format!("release:vercel:{:016x}{:016x}", first.finish(), second.finish()))
}

async fn restore_project_deploy_hook_for_state(state: &BrokerState, project_path: &Path) -> Result<bool, String> {
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    let account = release_hook_account(project_path)?;
    let hook = match keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(format!("No se pudo leer el Deploy Hook: {error}")),
    };
    if let Some(process) = process { configure_project_deploy_hook(process, project_path, hook.clone()).await?; }
    Ok(hook.is_some())
}

async fn restore_project_deploy_hook(process: Arc<HarnessProcess>, project_path: &str) -> Result<(), String> {
    let root = normalize_root(project_path)?;
    let account = release_hook_account(&root)?;
    let hook = match keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(format!("No se pudo leer el Deploy Hook: {error}")),
    };
    configure_project_deploy_hook(process, &root, hook).await
}

async fn configure_project_deploy_hook(process: Arc<HarnessProcess>, project_path: &Path, hook_url: Option<String>) -> Result<(), String> {
    let response = request_harness_async(process, serde_json::json!({
        "jsonrpc": "2.0", "id": format!("release-hook-{}", uuid::Uuid::new_v4()), "method": "release.credentials.configure",
        "params": { "projectPath": project_path.display().to_string(), "deployHookUrl": hook_url }
    })).await?;
    if let Some(error) = response.get("error") { return Err(error.get("message").and_then(serde_json::Value::as_str).unwrap_or("El Harness rechazó la configuración del Deploy Hook").to_string()); }
    Ok(())
}

fn supported_provider(provider: &str) -> bool {
    matches!(provider, "openai" | "openrouter" | "opencode_zen" | "deepseek" | "mistral" | "groq" | "together" | "fireworks" | "cerebras" | "anthropic" | "xai" | "gemini")
        || provider.strip_prefix("custom_").is_some_and(|suffix| (8..=80).contains(&suffix.len()) && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

#[tauri::command]
fn mcp_server_secret_set(server_id: String, secret_key: String, value: String) -> Result<(), String> {
    let account = mcp_secret_account(&server_id, &secret_key)?;
    if value.trim().is_empty() || value.len() > 4096 || value.contains('\0') { return Err("La credencial MCP debe contener entre 1 y 4096 caracteres válidos".into()); }
    keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?
        .set_password(&value).map_err(|error| format!("No se pudo guardar la credencial MCP: {error}"))
}

#[tauri::command]
fn mcp_server_secret_remove(server_id: String, secret_key: String) -> Result<(), String> {
    let account = mcp_secret_account(&server_id, &secret_key)?;
    match keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("No se pudo eliminar la credencial MCP: {error}")),
    }
}

#[tauri::command]
fn mcp_server_secret_status(server_id: String, secret_keys: Vec<String>) -> Result<HashMap<String, bool>, String> {
    let mut result = HashMap::new();
    for secret_key in secret_keys.into_iter().take(32) {
        let account = mcp_secret_account(&server_id, &secret_key)?;
        let entry = keyring::Entry::new("OrderCode", &account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))?;
        result.insert(secret_key, entry.get_password().is_ok());
    }
    Ok(result)
}

fn mcp_secret_account(server_id: &str, secret_key: &str) -> Result<String, String> {
    if !server_id.starts_with("mcp_") || server_id.len() > 48 || !server_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
        return Err("El identificador del servidor MCP no es válido".into());
    }
    if secret_key != "__AUTHORIZATION__" && (secret_key.is_empty() || secret_key.len() > 64 || !secret_key.chars().enumerate().all(|(index, ch)| ch == '_' || ch.is_ascii_uppercase() || ch.is_ascii_digit() && index > 0)) {
        return Err("El nombre de la credencial MCP no es válido".into());
    }
    Ok(format!("mcp:{server_id}:{secret_key}"))
}

#[tauri::command]
fn workspace_tree(state: State<'_, BrokerState>, directory: Option<String>, show_auxiliary: Option<bool>) -> Result<Vec<WorkspaceEntry>, String> {
    let root = state.workspace_root.lock().map_err(|_| "No se pudo leer el workspace activo".to_string())?.clone().ok_or_else(|| "Abre un workspace antes de listar sus archivos".to_string())?;
    let mut entries = Vec::new();
    if let Some(relative) = directory {
        let path = PathBuf::from(&relative);
        if path.components().any(|part| !matches!(part, std::path::Component::Normal(_) | std::path::Component::CurDir)) {
            return Err("La carpeta debe pertenecer al workspace activo".into());
        }
        let resolved = root.join(path).canonicalize().map_err(|error| format!("No se pudo abrir la carpeta: {error}"))?;
        if !resolved.starts_with(&root) || !resolved.is_dir() { return Err("La carpeta debe pertenecer al workspace activo".into()); }
        collect_workspace_entries(&root, &resolved, 0, &mut entries, true, false)?;
    } else {
        collect_workspace_entries(&root, &root, 0, &mut entries, show_auxiliary.unwrap_or(false), true)?;
    }
    entries.sort_by(|left, right| (left.kind != "directory").cmp(&(right.kind != "directory")).then_with(|| left.path.cmp(&right.path)));
    entries.truncate(500);
    Ok(entries)
}

#[tauri::command]
fn git_status(state: State<'_, BrokerState>) -> Result<String, String> {
    let root = state.workspace_root.lock().map_err(|_| "No se pudo leer el workspace activo".to_string())?.clone().ok_or_else(|| "Abre un workspace antes de consultar Git".to_string())?;
    let output = Command::new("git").arg("-C").arg(root).args(["status", "--short", "--branch"]).output().map_err(|error| format!("No se pudo consultar Git: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { "Git no pudo consultar el estado del workspace".into() } else { detail });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn workspace_open(state: State<'_, BrokerState>, project_path: String) -> Result<String, String> {
    let root = normalize_root(&project_path)?;
    {
        let mut workspace = state.workspace_root.lock().map_err(|_| "No se pudo actualizar el workspace activo".to_string())?;
        let mut session = state.active_session.lock().map_err(|_| "No se pudo seleccionar la sesión activa".to_string())?;
        *workspace = Some(root.clone());
        *session = None;
    }
    Ok(root.display().to_string())
}

#[tauri::command]
async fn activate_session(state: State<'_, BrokerState>, session_id: String, project_path: String, mode: String, permission: String) -> Result<(), String> {
    if session_id.trim().is_empty() { return Err("La sesión no es válida".into()); }
    if !matches!(mode.as_str(), "Plan" | "Build" | "Auto") { return Err("Modo de trabajo inválido".into()); }
    if !matches!(permission.as_str(), "Lectura" | "Guiado" | "Auto" | "Avanzado") { return Err("Perfil de permisos inválido".into()); }
    let root = normalize_root(&project_path)?;
    {
        let mut workspace = state.workspace_root.lock().map_err(|_| "No se pudo actualizar el workspace activo".to_string())?;
        let mut session = state.active_session.lock().map_err(|_| "No se pudo seleccionar la sesión activa".to_string())?;
        *workspace = Some(root.clone());
        *session = Some(session_id);
    }
    let process = state.harness.lock().map_err(|_| "No se pudo acceder al proceso Harness".to_string())?.as_ref().cloned();
    if let Some(process) = process {
        if is_harness_alive(&process) { restore_project_deploy_hook(process, &root.display().to_string()).await?; }
    }
    Ok(())
}

#[tauri::command]
#[expect(clippy::too_many_arguments, reason = "Arguments preserve the native terminal command contract used by the frontend.")]
async fn terminal_open(
    app: tauri::AppHandle,
    state: State<'_, BrokerState>,
    session_id: String,
    project_path: String,
    authorization_id: String,
    shell: String,
    cols: u16,
    rows: u16,
) -> Result<TerminalInfo, String> {
    let _active_request = begin_harness_request(&state)?;
    if session_id.trim().is_empty() || authorization_id.trim().is_empty() || authorization_id.len() > 128 { return Err("La autorización de terminal no es válida".into()); }
    if !matches!(shell.as_str(), "default" | "powershell" | "cmd" | "bash" | "zsh") { return Err("Shell no compatible".into()); }
    if cols == 0 || rows == 0 || cols > 500 || rows > 200 { return Err("El tamaño de terminal no es válido".into()); }
    let root = normalize_root(&project_path)?;
    require_active_terminal_binding(&state, &session_id, &root)?;
    let harness = state.harness.lock().map_err(|_| "No se pudo comprobar el permiso del Harness".to_string())?.as_ref().cloned().ok_or_else(|| "El Harness no está conectado".to_string())?;
    let authorization = request_harness_async(harness, serde_json::json!({
        "jsonrpc": "2.0", "id": format!("terminal-auth-{}", uuid::Uuid::new_v4()),
        "method": "terminal.consumeAuthorization",
        "params": { "authorizationId": authorization_id, "sessionId": session_id, "projectPath": project_path, "shell": shell }
    })).await?;
    if authorization.get("result").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err("El Harness rechazó la autorización de terminal o ya expiró".into());
    }
    // Recheck the session binding after the asynchronous authorization round trip.
    require_active_terminal_binding(&state, &session_id, &root)?;

    ensure_update_not_installing(&state)?;
    let mut terminals = state.terminals.lock().map_err(|_| "No se pudo acceder al Process Explorer".to_string())?;
    if terminals.values().filter(|terminal| terminal.session_id == session_id).count() >= 8 {
        return Err("Una sesión puede mantener hasta 8 terminales interactivos".into());
    }
    let mut command = terminal_command(&shell)?;
    command.cwd(&root);
    for (key, _) in env::vars() {
        if is_sensitive_environment_key(&key) { command.env_remove(key); }
    }
    command.env("TERM", "xterm-256color");

    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|error| format!("No se pudo crear el PTY: {error}"))?;
    let reader = pair.master.try_clone_reader().map_err(|error| format!("No se pudo abrir la salida del PTY: {error}"))?;
    let writer = pair.master.take_writer().map_err(|error| format!("No se pudo abrir la entrada del PTY: {error}"))?;
    let child = pair.slave.spawn_command(command).map_err(|error| format!("No se pudo iniciar el shell interactivo: {error}"))?;
    let pid = child.process_id();
    let terminal_id = uuid::Uuid::new_v4().to_string();
    let terminal = Arc::new(TerminalProcess { session_id: session_id.clone(), child: Mutex::new(child), writer: Mutex::new(writer), master: Mutex::new(pair.master) });
    terminals.insert(terminal_id.clone(), Arc::clone(&terminal));
    drop(terminals);

    let output_app = app.clone();
    let output_terminal_id = terminal_id.clone();
    let output_session_id = session_id.clone();
    let output_terminal = Arc::clone(&terminal);
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 8192];
        let mut utf8_pending = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => {
                    let data = decode_terminal_bytes(&mut utf8_pending, &[], true);
                    if !data.is_empty() { let _ = output_app.emit("terminal-output", TerminalOutput { terminal_id: output_terminal_id.clone(), session_id: output_session_id.clone(), data }); }
                    break;
                },
                Ok(length) => {
                    let data = decode_terminal_bytes(&mut utf8_pending, &buffer[..length], false);
                    if !data.is_empty() { let _ = output_app.emit("terminal-output", TerminalOutput { terminal_id: output_terminal_id.clone(), session_id: output_session_id.clone(), data }); }
                }
            }
        }
        drop(output_terminal);
    });

    let monitor_app = app.clone();
    let monitor_terminal_id = terminal_id.clone();
    let monitor_session_id = session_id.clone();
    let monitor_terminal = Arc::clone(&terminal);
    thread::spawn(move || loop {
        let exit = match monitor_terminal.child.lock() {
            Ok(mut child) => match child.try_wait() { Ok(status) => status, Err(_) => break },
            Err(_) => break,
        };
        if let Some(status) = exit {
            let _ = monitor_app.emit("terminal-exit", TerminalExit { terminal_id: monitor_terminal_id.clone(), session_id: monitor_session_id.clone(), code: status.exit_code(), success: status.success() });
            if let Some(state) = monitor_app.try_state::<BrokerState>() {
                if let Ok(mut terminals) = state.terminals.lock() { terminals.remove(&monitor_terminal_id); }
            }
            break;
        }
        thread::sleep(Duration::from_millis(300));
    });

    let shell_label = if shell == "default" && cfg!(windows) { "powershell".to_string() } else { shell.clone() };
    Ok(TerminalInfo { terminal_id, session_id, shell: shell_label, cwd: root.display().to_string(), pid })
}

fn decode_terminal_bytes(pending: &mut Vec<u8>, bytes: &[u8], end: bool) -> String {
    pending.extend_from_slice(bytes);
    let mut output = String::new();
    let mut consumed = 0;
    while consumed < pending.len() {
        match std::str::from_utf8(&pending[consumed..]) {
            Ok(text) => { output.push_str(text); consumed = pending.len(); }
            Err(error) => {
                let valid_end = consumed + error.valid_up_to();
                output.push_str(std::str::from_utf8(&pending[consumed..valid_end]).unwrap_or_default());
                consumed = valid_end;
                match error.error_len() {
                    Some(length) => { output.push('\u{fffd}'); consumed += length; }
                    None if end => { output.push('\u{fffd}'); consumed = pending.len(); }
                    None => break,
                }
            }
        }
    }
    pending.drain(..consumed);
    output
}

fn require_active_terminal_binding(state: &BrokerState, session_id: &str, root: &Path) -> Result<(), String> {
    let workspace = state.workspace_root.lock().map_err(|_| "No se pudo comprobar el workspace activo".to_string())?;
    let session = state.active_session.lock().map_err(|_| "No se pudo comprobar la sesión activa".to_string())?;
    if workspace.as_deref() != Some(root) || session.as_deref() != Some(session_id) {
        return Err("La terminal solo puede abrirse para la sesión y workspace activos".into());
    }
    Ok(())
}

#[tauri::command]
fn terminal_write(state: State<'_, BrokerState>, session_id: String, terminal_id: String, data: String) -> Result<(), String> {
    ensure_update_not_installing(&state)?;
    if data.is_empty() || data.len() > 256_000 || data.contains('\0') { return Err("La entrada de terminal está vacía, es demasiado grande o inválida".into()); }
    if state.active_session.lock().map_err(|_| "No se pudo comprobar la sesión activa".to_string())?.as_deref() != Some(session_id.as_str()) { return Err("Activa la sesión de esta terminal antes de escribir".into()); }
    let terminal = state.terminals.lock().map_err(|_| "No se pudo acceder a las terminales".to_string())?.get(&terminal_id).cloned().ok_or_else(|| "La terminal ya no está disponible".to_string())?;
    if terminal.session_id != session_id { return Err("La terminal pertenece a otra sesión".into()); }
    let mut writer = terminal.writer.lock().map_err(|_| "No se pudo escribir en la terminal".to_string())?;
    writer.write_all(data.as_bytes()).map_err(|error| format!("No se pudo enviar la entrada al PTY: {error}"))?;
    writer.flush().map_err(|error| format!("No se pudo enviar la entrada al PTY: {error}"))
}

#[tauri::command]
fn terminal_resize(state: State<'_, BrokerState>, session_id: String, terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    if cols == 0 || rows == 0 || cols > 500 || rows > 200 { return Err("El tamaño de terminal no es válido".into()); }
    if state.active_session.lock().map_err(|_| "No se pudo comprobar la sesión activa".to_string())?.as_deref() != Some(session_id.as_str()) { return Err("Activa la sesión de esta terminal antes de redimensionarla".into()); }
    let terminal = state.terminals.lock().map_err(|_| "No se pudo acceder a las terminales".to_string())?.get(&terminal_id).cloned().ok_or_else(|| "La terminal ya no está disponible".to_string())?;
    if terminal.session_id != session_id { return Err("La terminal pertenece a otra sesión".into()); }
    let result = terminal.master.lock().map_err(|_| "No se pudo redimensionar el PTY".to_string())?.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|error| format!("No se pudo redimensionar el PTY: {error}"));
    result
}

#[tauri::command]
fn terminal_close(state: State<'_, BrokerState>, session_id: String, terminal_id: String) -> Result<(), String> {
    let Some(terminal) = state.terminals.lock().map_err(|_| "No se pudo acceder a las terminales".to_string())?.get(&terminal_id).cloned() else { return Ok(()); };
    if terminal.session_id != session_id { return Err("La terminal pertenece a otra sesión".into()); }
    if let Ok(mut terminals) = state.terminals.lock() { terminals.remove(&terminal_id); }
    terminal.terminate();
    Ok(())
}

fn terminal_command(shell: &str) -> Result<CommandBuilder, String> {
    match shell {
        "default" if cfg!(windows) => { let mut command = CommandBuilder::new("powershell.exe"); command.arg("-NoLogo"); command.arg("-NoProfile"); Ok(command) },
        "default" => Ok(CommandBuilder::new_default_prog()),
        "powershell" if cfg!(windows) => { let mut command = CommandBuilder::new("powershell.exe"); command.arg("-NoLogo"); command.arg("-NoProfile"); Ok(command) },
        "cmd" if cfg!(windows) => { let mut command = CommandBuilder::new("cmd.exe"); command.arg("/Q"); command.arg("/D"); Ok(command) },
        "bash" if !cfg!(windows) => Ok(CommandBuilder::new("bash")),
        "zsh" if !cfg!(windows) => Ok(CommandBuilder::new("zsh")),
        _ => Err(format!("El shell {shell} no está disponible para esta plataforma")),
    }
}

fn is_sensitive_environment_key(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    if matches!(key.as_str(), "TOKEN" | "SECRET" | "PASSWORD" | "CREDENTIAL" | "APIKEY") { return true; }
    ["API_KEY", "ACCESS_KEY", "PRIVATE_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIAL", "AUTHORIZATION", "BEARER"]
        .iter().any(|fragment| key.contains(fragment))
}

fn terminate_all_terminals(state: &BrokerState) {
    if let Ok(mut terminals) = state.terminals.lock() {
        for terminal in terminals.values() { terminal.terminate(); }
        terminals.clear();
    }
}

fn normalize_root(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() { return Err("El workspace no puede estar vacío".into()); }
    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() { path } else { std::env::current_dir().map_err(|e| format!("No se pudo resolver el workspace: {e}"))?.join(path) };
    let normalized = if absolute.exists() {
        absolute.canonicalize().map_err(|e| format!("No se pudo resolver el workspace: {e}"))?
    } else {
        absolute
    };
    if !normalized.is_dir() { return Err("El workspace debe ser una carpeta existente".into()); }
    Ok(normalized)
}

fn resolve_harness_script(explicit: Option<&str>, resource_dir: &Path) -> Result<PathBuf, String> {
    let bundled = resource_dir.join("harness").join("index.js");
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../harness/dist/index.js");
    let expected_development = development.canonicalize().ok();
    let expected_bundled = bundled.canonicalize().ok();
    let candidates = explicit.map(PathBuf::from).into_iter().chain([bundled, development]);
    for candidate in candidates {
        if !candidate.is_file() { continue; }
        let canonical = candidate.canonicalize().map_err(|error| format!("No se pudo resolver Harness: {error}"))?;
        if expected_bundled.as_ref() == Some(&canonical) || expected_development.as_ref() == Some(&canonical) { return Ok(canonical); }
    }
    Err("No se encontró el Harness empaquetado. Vuelve a compilar OrderCode para incluir su runtime.".into())
}

fn resolve_node_binary(resource_dir: &Path) -> Result<PathBuf, String> {
    let executable = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let bundled = resource_dir.join("binaries").join(executable);
    if bundled.is_file() { return bundled.canonicalize().map_err(|error| format!("No se pudo resolver Node.js empaquetado: {error}")); }
    let version = Command::new(executable).arg("--version").output().map_err(|error| format!("No se encontró Node.js para desarrollo: {error}"))?;
    let text = String::from_utf8_lossy(&version.stdout);
    let major = text.trim().trim_start_matches('v').split('.').next().and_then(|value| value.parse::<u32>().ok()).unwrap_or_default();
    if !version.status.success() || major < 24 { return Err(format!("OrderCode requiere Node.js 24 o superior; se encontró {}.", text.trim())); }
    Ok(PathBuf::from(executable))
}

fn collect_workspace_entries(root: &PathBuf, directory: &PathBuf, depth: usize, entries: &mut Vec<WorkspaceEntry>, show_auxiliary: bool, recursive: bool) -> Result<(), String> {
    if depth > 8 || entries.len() >= 500 { return Ok(()); }
    let read = fs::read_dir(directory).map_err(|error| format!("No se pudo listar el workspace: {error}"))?;
    for item in read {
        if entries.len() >= 500 { break; }
        let item = item.map_err(|error| format!("No se pudo leer una entrada del workspace: {error}"))?;
        let name = item.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), ".git" | "node_modules" | "target" | "dist" | "build" | ".turbo") { continue; }
        let path = item.path();
        let metadata = item.path().symlink_metadata().map_err(|error| format!("No se pudo leer metadata del workspace: {error}"))?;
        if metadata.file_type().is_symlink() { continue; }
        if metadata.is_dir() && !path.canonicalize().map(|resolved| resolved.starts_with(root)).unwrap_or(false) { continue; }
        if metadata.is_dir() && !show_auxiliary && (name.starts_with('.') || matches!(name.as_str(), "playwright-report" | "test-results" | "coverage")) { continue; }
        let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        if metadata.is_dir() {
            entries.push(WorkspaceEntry { path: relative, kind: "directory", size: 0 });
            if recursive { collect_workspace_entries(root, &path, depth + 1, entries, show_auxiliary, true)?; }
        } else if metadata.is_file() {
            entries.push(WorkspaceEntry { path: relative, kind: "file", size: metadata.len() });
        }
    }
    Ok(())
}

fn is_harness_alive(process: &Arc<HarnessProcess>) -> bool {
    process.child.lock().map(|mut child| child.try_wait().map(|status| status.is_none()).unwrap_or(false)).unwrap_or(false)
}

async fn request_harness_async(process: Arc<HarnessProcess>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || request_harness(&process, request)).await.map_err(|error| format!("Falló la tarea IPC del Harness: {error}"))?
}

fn request_harness(process: &HarnessProcess, request: serde_json::Value) -> Result<serde_json::Value, String> {
    let id = request.get("id").ok_or_else(|| "La solicitud Harness no tiene id JSON-RPC".to_string())?;
    if !id.is_string() && !id.is_number() && !id.is_null() { return Err("El id JSON-RPC debe ser un número, texto o null".into()); }
    let method = request.get("method").and_then(serde_json::Value::as_str).filter(|method| !method.is_empty()).ok_or_else(|| "La solicitud Harness no tiene un método válido".to_string())?;
    if request.get("jsonrpc").and_then(serde_json::Value::as_str) != Some("2.0") { return Err("La solicitud Harness debe utilizar JSON-RPC 2.0".into()); }
    let timeout = harness_request_timeout(method);
    let key = rpc_id_key(id);
    let line = serde_json::to_string(&request).map_err(|error| format!("No se pudo serializar la solicitud Harness: {error}"))?;
    let (sender, receiver) = mpsc::channel();
    {
        let mut waiting = process.pending.lock().map_err(|_| "No se pudo registrar la respuesta Harness".to_string())?;
        if waiting.contains_key(&key) { return Err("El id de solicitud Harness ya está en uso".into()); }
        waiting.insert(key.clone(), sender);
    }
    let write_result = (|| {
        let mut stdin = process.stdin.lock().map_err(|_| "No se pudo escribir en Harness".to_string())?;
        stdin.write_all(line.as_bytes()).map_err(|error| format!("No se pudo escribir en Harness: {error}"))?;
        stdin.write_all(b"\n").map_err(|error| format!("No se pudo finalizar la solicitud Harness: {error}"))?;
        stdin.flush().map_err(|error| format!("No se pudo enviar la solicitud Harness: {error}"))
    })();
    if let Err(error) = write_result { if let Ok(mut waiting) = process.pending.lock() { waiting.remove(&key); } return Err(error); }
    let value = receiver.recv_timeout(timeout).map_err(|error| {
        if let Ok(mut waiting) = process.pending.lock() { waiting.remove(&key); }
        format!("Tiempo de espera agotado al recibir respuesta Harness: {error}")
    })?;
    if let Some(error) = value.get("error") { return Err(error.get("message").and_then(serde_json::Value::as_str).unwrap_or("Harness devolvió un error").to_string()); }
    Ok(value)
}

fn harness_request_timeout(method: &str) -> Duration {
    Duration::from_secs(match method {
        "shutdown" => 5,
        "health" => 10,
        "run" | "permission.resolve" | "tool.invoke" | "agents.test" | "code.index" | "code.graph" | "provider.models" | "mcp.connect" | "marketplace.install" => 900,
        _ => 60,
    })
}

fn rpc_id_key(value: &serde_json::Value) -> String {
    match value { serde_json::Value::String(value) => format!("s:{value}"), serde_json::Value::Number(value) => format!("n:{value}"), serde_json::Value::Null => "null".into(), _ => "invalid".into() }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BrokerState::default())
        .manage(UpdaterState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let closing_window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let state = closing_window.state::<BrokerState>();
                    terminate_all_terminals(&state);
                    let _ = stop_harness(&state).await;
                    let _ = closing_window.destroy();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![health, harness_start, harness_request, harness_stop, updater_check, updater_download, updater_install, workspace_open, activate_session, terminal_open, terminal_write, terminal_resize, terminal_close, workspace_tree, git_status, provider_keys_status, provider_set_key, provider_remove_key, chatgpt_account_status, chatgpt_connect, chatgpt_disconnect, xai_account_status, xai_connect, xai_disconnect, mcp_server_secret_set, mcp_server_secret_remove, mcp_server_secret_status, release_hook_set, release_hook_remove, release_hook_status])
        .setup(|app| { if let Some(window) = app.get_webview_window("main") { let _ = window.set_title("OrderCode"); } Ok(()) })
        .run(tauri::generate_context!())
        .expect("error while running OrderCode");
}

fn main() { run(); }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_preserves_unicode_across_pty_chunks() {
        let mut pending = Vec::new();
        let bytes = "código 🚀".as_bytes();
        let mut actual = String::new();
        for byte in bytes {
            actual.push_str(&decode_terminal_bytes(&mut pending, &[*byte], false));
        }
        actual.push_str(&decode_terminal_bytes(&mut pending, &[], true));
        assert_eq!(actual, "código 🚀");
        assert!(pending.is_empty());
    }

    #[test]
    fn terminal_recovers_after_invalid_utf8_and_flushes_incomplete_tail() {
        let mut pending = Vec::new();
        assert_eq!(decode_terminal_bytes(&mut pending, &[b'a', 0xff, b'b', 0xe2], false), "a\u{fffd}b");
        assert_eq!(pending, vec![0xe2]);
        assert_eq!(decode_terminal_bytes(&mut pending, &[], true), "\u{fffd}");
        assert!(pending.is_empty());
    }

    #[test]
    fn control_requests_have_bounded_timeouts_and_model_runs_keep_long_budget() {
        assert_eq!(harness_request_timeout("shutdown"), Duration::from_secs(5));
        assert_eq!(harness_request_timeout("health"), Duration::from_secs(10));
        assert_eq!(harness_request_timeout("session.cancel"), Duration::from_secs(60));
        assert_eq!(harness_request_timeout("run"), Duration::from_secs(900));
        assert_eq!(harness_request_timeout("permission.resolve"), Duration::from_secs(900));
    }

    #[test]
    fn sensitive_environment_detection_is_case_insensitive() {
        for key in ["OPENAI_API_KEY", "github_token", "AWS_ACCESS_KEY_ID", "VERCEL_TOKEN", "MCP_CLIENT_SECRET", "DATABASE_PASSWORD"] {
            assert!(is_sensitive_environment_key(key), "{key}");
        }
        for key in ["PATH", "TERM", "USERNAME", "APPDATA"] {
            assert!(!is_sensitive_environment_key(key), "{key}");
        }
    }

    #[test]
    fn native_terminal_binding_rejects_cross_session_or_workspace_requests() {
        let state = BrokerState::default();
        let root = std::env::temp_dir();
        *state.workspace_root.lock().unwrap() = Some(root.clone());
        *state.active_session.lock().unwrap() = Some("session-a".into());
        assert!(require_active_terminal_binding(&state, "session-a", &root).is_ok());
        assert!(require_active_terminal_binding(&state, "session-b", &root).is_err());
        assert!(require_active_terminal_binding(&state, "session-a", &root.join("different")).is_err());
    }

    #[test]
    fn updater_gate_blocks_new_work_and_releases_after_failure() {
        let state = BrokerState::default();
        let request = begin_harness_request(&state).unwrap();
        assert_eq!(state.active_harness_requests.load(Ordering::Acquire), 1);
        drop(request);
        assert_eq!(state.active_harness_requests.load(Ordering::Acquire), 0);
        state.update_installing.store(true, Ordering::Release);
        {
            let _gate = UpdateInstallGate(&state.update_installing);
            assert!(begin_harness_request(&state).is_err());
            assert_eq!(state.active_harness_requests.load(Ordering::Acquire), 0);
        }
        assert!(begin_harness_request(&state).is_ok());
    }

    #[test]
    fn updater_preserves_verified_download_only_for_unchanged_artifact() {
        let identity = serde_json::json!({ "version": "0.4.0", "currentVersion": "0.3.0", "target": "windows-x86_64", "url": "https://example.com/ordercode.exe", "signature": "signed-a", "notes": "release", "publishedAt": "2026-10-17", "manifest": { "version": "0.4.0" } });
        let mut downloaded = Some(vec![1, 2, 3]);
        retain_matching_update_download(Some(&identity), &identity, &mut downloaded);
        assert_eq!(downloaded, Some(vec![1, 2, 3]));
        for field in ["version", "currentVersion", "target", "url", "signature", "notes", "publishedAt", "manifest"] {
            let mut changed = identity.clone();
            changed[field] = serde_json::json!("changed");
            let mut previous_download = Some(vec![1, 2, 3]);
            retain_matching_update_download(Some(&identity), &changed, &mut previous_download);
            assert!(previous_download.is_none(), "changed {field} must invalidate the package");
        }
        retain_matching_update_download(None, &identity, &mut downloaded);
        assert!(downloaded.is_none());
    }

    #[test]
    fn workspace_listing_obeys_global_entry_limit_and_ignores_build_output() {
        let temporary = std::env::temp_dir();
        let directory = temporary.join(format!("ordercode-native-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let result = (|| -> Result<(), String> {
            fs::create_dir(directory.join("node_modules")).map_err(|error| error.to_string())?;
            fs::write(directory.join("node_modules/ignored.txt"), "ignored").map_err(|error| error.to_string())?;
            for index in 0..510 {
                fs::write(directory.join(format!("file-{index}.txt")), "fixture").map_err(|error| error.to_string())?;
            }
            let root = normalize_root(directory.to_str().unwrap())?;
            let mut entries = Vec::new();
            collect_workspace_entries(&root, &root, 0, &mut entries, false, true)?;
            assert_eq!(entries.len(), 500);
            assert!(entries.iter().all(|entry| !entry.path.starts_with("node_modules")));
            Ok(())
        })();
        assert_eq!(directory.parent(), Some(temporary.as_path()));
        fs::remove_dir_all(&directory).unwrap();
        result.unwrap();
    }

    #[test]
    fn workspace_listing_loads_folders_without_auxiliary_log_flood() {
        let temporary = std::env::temp_dir();
        let directory = temporary.join(format!("ordercode-explorer-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(directory.join(".playwright-mcp")).unwrap();
        fs::create_dir_all(directory.join("src/components")).unwrap();
        let result = (|| -> Result<(), String> {
            fs::write(directory.join("src/App.tsx"), "export default 1").map_err(|error| error.to_string())?;
            fs::write(directory.join(".gitignore"), "node_modules").map_err(|error| error.to_string())?;
            for index in 0..510 { fs::write(directory.join(format!(".playwright-mcp/log-{index}.txt")), "log").map_err(|error| error.to_string())?; }
            let root = normalize_root(directory.to_str().unwrap())?;
            let mut entries = Vec::new();
            collect_workspace_entries(&root, &root, 0, &mut entries, true, false)?;
            assert_eq!(entries.len(), 3);
            assert!(entries.iter().any(|entry| entry.path == "src"));
            assert!(entries.iter().all(|entry| !entry.path.contains('/')));
            entries.clear();
            collect_workspace_entries(&root, &root, 0, &mut entries, false, true)?;
            assert!(entries.iter().any(|entry| entry.path == "src/App.tsx"));
            assert!(entries.iter().any(|entry| entry.path == ".gitignore"));
            assert!(entries.iter().all(|entry| !entry.path.starts_with(".playwright-mcp")));
            entries.clear();
            collect_workspace_entries(&root, &root.join("src"), 0, &mut entries, true, false)?;
            assert_eq!(entries.len(), 2);
            assert!(entries.iter().all(|entry| entry.path.starts_with("src/")));
            Ok(())
        })();
        assert_eq!(directory.parent(), Some(temporary.as_path()));
        fs::remove_dir_all(&directory).unwrap();
        result.unwrap();
    }
}
