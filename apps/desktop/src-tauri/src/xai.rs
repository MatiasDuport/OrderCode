use serde::{Deserialize, Serialize};
use std::{process::Command, sync::{Mutex, atomic::{AtomicU64, Ordering}}, thread, time::{Duration, Instant}};
use tauri::Emitter;
use url::Url;

const SERVICE: &str = "OrderCode";
const ACCOUNT: &str = "xai_plan_active";
const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_ENDPOINT: &str = "https://auth.x.ai/oauth2/device/code";
const TOKEN_ENDPOINT: &str = "https://auth.x.ai/oauth2/token";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());
static LOGIN_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn cancel_login() { LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst); }

fn check_login(generation: u64) -> Result<(), String> {
    if LOGIN_GENERATION.load(Ordering::SeqCst) != generation { return Err("Inicio de sesión de Grok cancelado.".into()); }
    Ok(())
}

async fn wait_for_poll(interval: Duration, generation: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now() + interval;
        while Instant::now() < deadline {
            check_login(generation)?;
            thread::sleep(Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())));
        }
        check_login(generation)
    }).await.map_err(|_| "No se pudo continuar el inicio de sesión.".to_string())?
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiCredential {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    pub connection_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XaiAccountStatus {
    pub connected: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCodeNotice {
    user_code: String,
    verification_uri: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct OAuthError {
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct CredentialPointer {
    version: String,
    connection_id: String,
    chunks: usize,
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))
}

fn get(account: &str) -> Option<String> { entry(account).ok()?.get_password().ok() }
fn set(account: &str, value: &str) -> Result<(), String> { entry(account)?.set_password(value).map_err(|error| format!("No se pudo guardar la cuenta SuperGrok en el almacén seguro: {error}")) }
fn remove(account: &str) { if let Ok(entry) = entry(account) { let _ = entry.delete_credential(); } }
fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("No se pudo eliminar la cuenta SuperGrok del almacén seguro: {error}")),
    }
}

fn credential_chunks(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut chunk = String::new();
    for character in value.chars() {
        if chunk.len() + character.len_utf8() > 1_700 {
            chunks.push(std::mem::take(&mut chunk));
        }
        chunk.push(character);
    }
    if !chunk.is_empty() { chunks.push(chunk); }
    chunks
}

fn delete_version(version: &str, count: usize) {
    for index in 0..count.min(64) { remove(&format!("xai_plan_{version}_{index}")); }
}

fn save_unlocked(credential: &XaiCredential) -> Result<(), String> {
    if credential.access_token.is_empty() || credential.refresh_token.is_empty() || credential.connection_id.is_empty() || credential.expires_at == 0 {
        return Err("La credencial de SuperGrok no tiene un formato válido.".into());
    }
    let serialized = serde_json::to_string(credential).map_err(|error| format!("No se pudo serializar la cuenta SuperGrok: {error}"))?;
    let previous = get(ACCOUNT).and_then(|value| serde_json::from_str::<CredentialPointer>(&value).ok());
    let chunks = credential_chunks(&serialized);
    if chunks.is_empty() || chunks.len() > 64 { return Err("La credencial SuperGrok supera el tamaño permitido.".into()); }
    let version = uuid::Uuid::new_v4().simple().to_string();
    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) = set(&format!("xai_plan_{version}_{index}"), chunk) {
            delete_version(&version, index);
            return Err(error);
        }
    }
    let pointer = CredentialPointer { version: version.clone(), connection_id: credential.connection_id.clone(), chunks: chunks.len() };
    let serialized_pointer = serde_json::to_string(&pointer).map_err(|error| format!("No se pudo guardar el estado de SuperGrok: {error}"))?;
    if let Err(error) = set(ACCOUNT, &serialized_pointer) {
        delete_version(&version, chunks.len());
        return Err(error);
    }
    if let Some(previous) = previous.filter(|old| old.version != version) { delete_version(&previous.version, previous.chunks); }
    Ok(())
}

fn load_unlocked() -> Option<XaiCredential> {
    let pointer: CredentialPointer = serde_json::from_str(&get(ACCOUNT)?).ok()?;
    if pointer.chunks == 0 || pointer.chunks > 64 { return None; }
    let mut serialized = String::new();
    for index in 0..pointer.chunks { serialized.push_str(&get(&format!("xai_plan_{}_{index}", pointer.version))?); }
    let credential: XaiCredential = serde_json::from_str(&serialized).ok()?;
    (credential.connection_id == pointer.connection_id).then_some(credential)
}

pub fn load_credential() -> Option<XaiCredential> {
    let _lock = CREDENTIAL_LOCK.lock().ok()?;
    load_unlocked()
}

pub fn account_status() -> XaiAccountStatus { XaiAccountStatus { connected: load_credential().is_some() } }

pub fn save_credential(credential: &XaiCredential) -> Result<(), String> {
    let _lock = CREDENTIAL_LOCK.lock().map_err(|_| "No se pudo acceder a la cuenta SuperGrok".to_string())?;
    save_unlocked(credential)
}

pub fn save_rotated_credential(credential: &XaiCredential) -> Result<(), String> {
    let _lock = CREDENTIAL_LOCK.lock().map_err(|_| "No se pudo acceder a la cuenta SuperGrok".to_string())?;
    if load_unlocked().is_some_and(|active| active.connection_id == credential.connection_id) { save_unlocked(credential)?; }
    Ok(())
}

pub fn take_credential() -> Result<Option<XaiCredential>, String> {
    let _lock = CREDENTIAL_LOCK.lock().map_err(|_| "No se pudo acceder a la cuenta SuperGrok".to_string())?;
    let credential = load_unlocked();
    let pointer = get(ACCOUNT).and_then(|value| serde_json::from_str::<CredentialPointer>(&value).ok());
    delete(ACCOUNT)?;
    if let Some(pointer) = pointer { delete_version(&pointer.version, pointer.chunks); }
    Ok(credential)
}

pub async fn revoke_credential(credential: &XaiCredential) {
    let Ok(client) = reqwest::Client::builder().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build() else { return; };
    let body = form_body(&[("token", credential.refresh_token.as_str()), ("token_type_hint", "refresh_token"), ("client_id", CLIENT_ID)]);
    let _ = client.post("https://auth.x.ai/oauth2/revoke").header("content-type", "application/x-www-form-urlencoded").body(body).send().await;
}

pub async fn connect(app: &tauri::AppHandle) -> Result<XaiCredential, String> {
    let generation = LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|error| format!("No se pudo preparar la conexión segura de xAI: {error}"))?;
    let response = client.post(DEVICE_ENDPOINT).header("content-type", "application/x-www-form-urlencoded").body(form_body(&[("client_id", CLIENT_ID), ("scope", SCOPE)])).send().await.map_err(|error| format!("No se pudo iniciar la autorización SuperGrok: {error}"))?;
    if !response.status().is_success() { return Err(format!("xAI rechazó el inicio de sesión ({})", response.status())); }
    let device: DeviceCodeResponse = response.json().await.map_err(|_| "xAI devolvió una solicitud de inicio de sesión no válida.".to_string())?;
    if device.device_code.is_empty() || device.user_code.is_empty() || device.expires_in == 0 { return Err("xAI devolvió un código de inicio de sesión no válido.".into()); }
    let verification = device.verification_uri_complete.as_deref().unwrap_or(&device.verification_uri);
    check_login(generation)?;
    if !matches_xai_verification_url(verification) || !matches_xai_verification_url(&device.verification_uri) { return Err("xAI devolvió una dirección de verificación no segura.".into()); }
    let _ = app.emit("ordercode-xai-device-code", DeviceCodeNotice { user_code: device.user_code.clone(), verification_uri: device.verification_uri.clone(), expires_in: device.expires_in });
    // The visible verification link remains usable when the system browser cannot launch.
    let _ = open_system_browser(verification);

    let mut interval = Duration::from_secs(device.interval.unwrap_or(5).clamp(1, 30));
    let deadline = Instant::now() + Duration::from_secs(device.expires_in.min(1_800));
    loop {
        wait_for_poll(interval, generation).await?;
        if Instant::now() >= deadline { return Err("El código de acceso SuperGrok expiró. Inténtalo de nuevo.".into()); }
        let response = client.post(TOKEN_ENDPOINT).header("content-type", "application/x-www-form-urlencoded").body(form_body(&[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("device_code", device.device_code.as_str()), ("client_id", CLIENT_ID)])).send().await.map_err(|error| format!("No se pudo completar la autorización SuperGrok: {error}"))?;
        if response.status().is_success() {
            check_login(generation)?;
            let tokens: TokenResponse = response.json().await.map_err(|_| "xAI devolvió credenciales no válidas.".to_string())?;
            let credential = XaiCredential { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: now_ms().saturating_add(tokens.expires_in.saturating_mul(1_000)), connection_id: uuid::Uuid::new_v4().to_string() };
            if credential.access_token.is_empty() || credential.refresh_token.is_empty() || tokens.expires_in == 0 { return Err("xAI devolvió credenciales incompletas.".into()); }
            check_login(generation)?;
            return Ok(credential);
        }
        let status = response.status();
        let error = response.json::<OAuthError>().await.unwrap_or(OAuthError { error: None, error_description: None });
        match error.error.as_deref() {
            Some("authorization_pending") => {},
            Some("slow_down") => { interval += Duration::from_secs(5); },
            Some("access_denied") => return Err("Se rechazó el acceso a la cuenta SuperGrok.".into()),
            Some("expired_token") => return Err("El código de acceso SuperGrok expiró. Inténtalo de nuevo.".into()),
            _ => { let detail = error.error_description.unwrap_or_else(|| error.error.unwrap_or_else(|| status.to_string())); return Err(format!("xAI no pudo completar la autorización ({detail}).")); }
        }
    }
}

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64 }

fn form_body(values: &[(&str, &str)]) -> String {
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in values { form.append_pair(key, value); }
    form.finish()
}

fn matches_xai_verification_url(value: &str) -> bool {
    !value.chars().any(char::is_control) && Url::parse(value).ok().is_some_and(|url| url.scheme() == "https" && matches!(url.host_str(), Some("x.ai" | "www.x.ai" | "auth.x.ai" | "accounts.x.ai" | "grok.com" | "www.grok.com")) && url.username().is_empty() && url.password().is_none() && url.port().is_none())
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = { use std::os::windows::process::CommandExt; Command::new("rundll32.exe").creation_flags(0x08000000).args(["url.dll,FileProtocolHandler", url]).spawn() };
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|error| format!("No se pudo abrir el navegador del sistema: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_accepts_current_xai_accounts_host_only_over_https() {
        assert!(matches_xai_verification_url("https://accounts.x.ai/device?user_code=EXAMPLE"));
        assert!(matches_xai_verification_url("https://auth.x.ai/device"));
        for url in ["https://accounts.x.ai.evil.test/device", "http://accounts.x.ai/device", "https://evil.test/", "https://user@accounts.x.ai/device", "https://accounts.x.ai:444/device", "javascript:alert(1)", "https://accounts.x.ai/\n"] { assert!(!matches_xai_verification_url(url), "{url}"); }
    }
    #[test]
    fn canceled_login_does_not_continue_polling() {
        let generation = LOGIN_GENERATION.load(Ordering::SeqCst);
        cancel_login();
        assert!(check_login(generation).is_err());
    }
}
