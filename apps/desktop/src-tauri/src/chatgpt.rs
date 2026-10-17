use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

const SERVICE: &str = "OrderCode";
const ACTIVE_ACCOUNT: &str = "openai_chatgpt_active";
const REGISTRATION: &str = "openai_chatgpt_registration";
const HOST_ID: &str = "openai_chatgpt_host_id";
const ISSUER: &str = "https://auth.openai.com";
const AUTHORIZATION_ENDPOINT: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/api/accounts/oauth/token";
const JWKS_ENDPOINT: &str = "https://auth.openai.com/.well-known/jwks.json";
const RESOURCE: &str = "https://api.openai.com/v1";
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGPTCredential {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    pub client_id: String,
    pub subject: String,
    pub email: Option<String>,
    pub host_id: String,
    pub expires_at: u64,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountPointer {
    version: String,
    client_id: String,
    subject: String,
    email: Option<String>,
    host_id: String,
    expires_at: u64,
    scopes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    client_id: String,
    subject: String,
    email: Option<String>,
    host_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGPTAccountStatus {
    pub connected: bool,
    pub email: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    id_token: String,
    expires_in: u64,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}
#[derive(Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

#[derive(Deserialize)]
struct JwtHeader {
    alg: String,
    kid: String,
}
#[derive(Deserialize)]
struct IdentityClaims {
    iss: String,
    aud: serde_json::Value,
    azp: Option<String>,
    exp: u64,
    iat: u64,
    sub: String,
    nonce: String,
    email: Option<String>,
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account)
        .map_err(|error| format!("No se pudo abrir el almacén seguro del sistema: {error}"))
}

fn get(account: &str) -> Option<String> {
    entry(account).ok()?.get_password().ok()
}

fn set(account: &str, value: &str) -> Result<(), String> {
    entry(account)?.set_password(value).map_err(|error| {
        format!("No se pudo guardar la cuenta ChatGPT en el almacén seguro: {error}")
    })
}

fn remove(account: &str) {
    if let Ok(entry) = entry(account) {
        let _ = entry.delete_credential();
    }
}

fn delete(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "No se pudo eliminar la cuenta ChatGPT del almacén seguro: {error}"
        )),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("No se pudo preparar la conexión segura de ChatGPT: {error}"))
}

fn secret_prefix(version: &str, field: &str) -> String {
    format!("openai_chatgpt_{version}_{field}")
}

fn write_secret(version: &str, field: &str, secret: &str) -> Result<(), String> {
    let prefix = secret_prefix(version, field);
    let chunks: Vec<&str> = secret
        .as_bytes()
        .chunks(1_800)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect();
    if chunks.is_empty() || chunks.len() > 32 || chunks.iter().any(|chunk| chunk.is_empty()) {
        return Err("La credencial ChatGPT no tiene un formato válido.".into());
    }
    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) = set(&format!("{prefix}_{index}"), chunk) {
            for written in 0..index {
                remove(&format!("{prefix}_{written}"));
            }
            return Err(error);
        }
    }
    if let Err(error) = set(&format!("{prefix}_count"), &chunks.len().to_string()) {
        for index in 0..chunks.len() {
            remove(&format!("{prefix}_{index}"));
        }
        return Err(error);
    }
    Ok(())
}

fn read_secret(version: &str, field: &str) -> Option<String> {
    let prefix = secret_prefix(version, field);
    let count = get(&format!("{prefix}_count"))?.parse::<usize>().ok()?;
    if count == 0 || count > 32 {
        return None;
    }
    let mut result = String::new();
    for index in 0..count {
        result.push_str(&get(&format!("{prefix}_{index}"))?);
    }
    Some(result)
}

fn remove_secret(version: &str, field: &str) {
    let prefix = secret_prefix(version, field);
    let count = get(&format!("{prefix}_count"))
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
        .min(32);
    remove(&format!("{prefix}_count"));
    for index in 0..count {
        remove(&format!("{prefix}_{index}"));
    }
}

pub fn load_credential() -> Option<ChatGPTCredential> {
    let _lock = CREDENTIAL_LOCK.lock().ok()?;
    load_credential_unlocked()
}

fn load_credential_unlocked() -> Option<ChatGPTCredential> {
    let pointer: AccountPointer = serde_json::from_str(&get(ACTIVE_ACCOUNT)?).ok()?;
    Some(ChatGPTCredential {
        access_token: read_secret(&pointer.version, "access")?,
        refresh_token: read_secret(&pointer.version, "refresh")?,
        id_token: read_secret(&pointer.version, "id")?,
        client_id: pointer.client_id,
        subject: pointer.subject,
        email: pointer.email,
        host_id: pointer.host_id,
        expires_at: pointer.expires_at,
        scopes: pointer.scopes,
    })
}

pub fn account_status() -> ChatGPTAccountStatus {
    let account = load_credential();
    ChatGPTAccountStatus {
        connected: account.is_some(),
        email: account.and_then(|value| value.email),
    }
}

pub fn save_credential(credential: &ChatGPTCredential) -> Result<(), String> {
    let _lock = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "No se pudo acceder a la cuenta ChatGPT".to_string())?;
    save_credential_unlocked(credential)
}

pub fn save_rotated_credential(credential: &ChatGPTCredential) -> Result<(), String> {
    let _lock = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "No se pudo acceder a la cuenta ChatGPT".to_string())?;
    if load_credential_unlocked()
        .as_ref()
        .is_some_and(|active| same_connection(active, credential))
    {
        save_credential_unlocked(credential)?;
    }
    Ok(())
}

fn same_connection(active: &ChatGPTCredential, rotated: &ChatGPTCredential) -> bool {
    active.subject == rotated.subject
        && active.client_id == rotated.client_id
        && active.host_id == rotated.host_id
        && active.id_token == rotated.id_token
}

fn save_credential_unlocked(credential: &ChatGPTCredential) -> Result<(), String> {
    if !credential
        .scopes
        .iter()
        .any(|scope| scope == "chatgpt.tokens.use.direct")
    {
        return Err("La cuenta no autorizó el uso del plan de ChatGPT.".into());
    }
    let version = uuid::Uuid::new_v4().simple().to_string();
    write_secret(&version, "access", &credential.access_token)?;
    if let Err(error) = write_secret(&version, "refresh", &credential.refresh_token) {
        remove_secret(&version, "access");
        return Err(error);
    }
    if let Err(error) = write_secret(&version, "id", &credential.id_token) {
        remove_secret(&version, "access");
        remove_secret(&version, "refresh");
        return Err(error);
    }
    let previous =
        get(ACTIVE_ACCOUNT).and_then(|value| serde_json::from_str::<AccountPointer>(&value).ok());
    let pointer = AccountPointer {
        version: version.clone(),
        client_id: credential.client_id.clone(),
        subject: credential.subject.clone(),
        email: credential.email.clone(),
        host_id: credential.host_id.clone(),
        expires_at: credential.expires_at,
        scopes: credential.scopes.clone(),
    };
    let serialized = serde_json::to_string(&pointer)
        .map_err(|error| format!("No se pudo guardar el estado de ChatGPT: {error}"))?;
    if let Err(error) = set(ACTIVE_ACCOUNT, &serialized) {
        remove_secret(&version, "access");
        remove_secret(&version, "refresh");
        remove_secret(&version, "id");
        return Err(error);
    }
    let registration = Registration {
        client_id: credential.client_id.clone(),
        subject: credential.subject.clone(),
        email: credential.email.clone(),
        host_id: credential.host_id.clone(),
    };
    if let Ok(serialized) = serde_json::to_string(&registration) {
        let _ = set(REGISTRATION, &serialized);
    }
    if let Some(previous) = previous.filter(|old| old.version != version) {
        for field in ["access", "refresh", "id"] {
            remove_secret(&previous.version, field);
        }
    }
    Ok(())
}

pub fn take_credential() -> Result<Option<ChatGPTCredential>, String> {
    let _lock = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "No se pudo acceder a la cuenta ChatGPT".to_string())?;
    let credential = load_credential_unlocked();
    let pointer =
        get(ACTIVE_ACCOUNT).and_then(|value| serde_json::from_str::<AccountPointer>(&value).ok());
    // Invalidate the pointer before deleting its chunks, so a delayed refresh cannot restore it.
    delete(REGISTRATION)?;
    delete(ACTIVE_ACCOUNT)?;
    if let Some(pointer) = pointer {
        for field in ["access", "refresh", "id"] {
            remove_secret(&pointer.version, field);
        }
    }
    Ok(credential)
}

pub async fn revoke_credential(credential: &ChatGPTCredential) {
    let form = form_body(&[
        ("token", credential.refresh_token.as_str()),
        ("token_type_hint", "refresh_token"),
        ("client_id", credential.client_id.as_str()),
    ]);
    let Ok(client) = http_client() else {
        return;
    };
    let _ = client
        .post("https://auth.openai.com/api/accounts/oauth/revoke")
        .timeout(Duration::from_secs(10))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form)
        .send()
        .await;
}

pub async fn connect() -> Result<ChatGPTCredential, String> {
    let active = load_credential();
    let registration =
        get(REGISTRATION).and_then(|value| serde_json::from_str::<Registration>(&value).ok());
    let host_id = get(HOST_ID)
        .or_else(|| registration.as_ref().map(|value| value.host_id.clone()))
        .unwrap_or_else(|| format!("urn:uuid:{}", uuid::Uuid::new_v4()));
    set(HOST_ID, &host_id)?;
    let state = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let nonce = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let verifier = format!(
        "{}{}{}",
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("No se pudo iniciar la conexión segura de retorno: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("No se pudo seleccionar el puerto de retorno: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/auth/callback");
    let client_id = registration
        .as_ref()
        .map(|value| value.client_id.as_str())
        .unwrap_or("dynamic_agent_client");
    let mut authorization =
        Url::parse(AUTHORIZATION_ENDPOINT).map_err(|error| error.to_string())?;
    {
        let mut query = authorization.query_pairs_mut();
        query
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair(
                "scope",
                "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            )
            .append_pair("resource", RESOURCE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &challenge)
            .append_pair("ext_agent_host_id", &host_id);
        if registration.is_none() {
            query.append_pair("agent_name_hint", "OrderCode");
        }
        if let Some(active) = active.as_ref() {
            query.append_pair("id_token_hint", &active.id_token);
        } else if let Some(registration) = registration.as_ref() {
            if let Some(email) = registration.email.as_deref() {
                query.append_pair("login_hint", email);
            }
        }
    }
    open_system_browser(authorization.as_str())?;
    let expected_state = state.clone();
    let callback =
        tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, &expected_state))
            .await
            .map_err(|error| format!("No se pudo completar el retorno de ChatGPT: {error}"))??;
    if let Some(error) = callback
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned())
    {
        let description = callback
            .query_pairs()
            .find(|(key, _)| key == "error_description")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default();
        return Err(if error == "access_denied" {
            "Se canceló el acceso al plan de ChatGPT.".into()
        } else {
            format!(
                "ChatGPT rechazó la conexión ({error}). {}",
                description.chars().take(240).collect::<String>()
            )
        });
    }
    let code = callback
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())
        .ok_or_else(|| "ChatGPT no devolvió el código de autorización.".to_string())?;
    let callback_client_id = callback
        .query_pairs()
        .find(|(key, _)| key == "client_id")
        .map(|(_, value)| value.into_owned());
    let issued_client_id = match (registration.as_ref(), callback_client_id) {
        (Some(saved), Some(returned)) if returned != saved.client_id => return Err(
            "ChatGPT devolvió una cuenta distinta a la seleccionada. No se guardaron credenciales."
                .into(),
        ),
        (Some(saved), _) => saved.client_id.clone(),
        (None, Some(returned)) if !returned.is_empty() && returned != "dynamic_agent_client" => {
            returned
        }
        (None, _) => {
            return Err(
                "ChatGPT no devolvió el identificador de la conexión de código abierto.".into(),
            )
        }
    };
    let body = form_body(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", &issued_client_id),
        ("code_verifier", &verifier),
        ("resource", RESOURCE),
    ]);
    let response = http_client()?
        .post(TOKEN_ENDPOINT)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| {
            format!("No se pudo conectar con ChatGPT para completar el acceso: {error}")
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "ChatGPT no aceptó el código de autorización ({}) . Inicia la conexión otra vez.",
            response.status()
        ));
    }
    let tokens: TokenResponse = response
        .json()
        .await
        .map_err(|error| format!("ChatGPT devolvió una respuesta de conexión inválida: {error}"))?;
    let granted_scope = tokens.scope.unwrap_or_else(|| {
        callback
            .query_pairs()
            .find(|(key, _)| key == "scope")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default()
    });
    let scopes = granted_scope
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !scopes
        .iter()
        .any(|scope| scope == "chatgpt.tokens.use.direct")
    {
        return Err("La cuenta no concedió el permiso para usar su plan de ChatGPT.".into());
    }
    let claims = verify_identity(&tokens.id_token, &nonce, &issued_client_id).await?;
    if let Some(saved) = registration.as_ref() {
        if claims.sub != saved.subject {
            return Err("La identidad recibida no coincide con la cuenta ChatGPT guardada.".into());
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(ChatGPTCredential {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        client_id: issued_client_id,
        subject: claims.sub,
        email: claims.email,
        host_id,
        expires_at: now.saturating_add(tokens.expires_in).saturating_mul(1000),
        scopes,
    })
}

fn form_body(values: &[(&str, &str)]) -> String {
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in values {
        form.append_pair(key, value);
    }
    form.finish()
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|error| {
        format!("No se pudo abrir el navegador del sistema para iniciar sesión: {error}")
    })
}

fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<Url, String> {
    wait_for_callback_until(
        listener,
        expected_state,
        Instant::now() + Duration::from_secs(300),
    )
}

fn wait_for_callback_until(
    listener: TcpListener,
    expected_state: &str,
    deadline: Instant,
) -> Result<Url, String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("No se pudo preparar el retorno de ChatGPT: {error}"))?;
    loop {
        if Instant::now() >= deadline {
            return Err("La conexión con ChatGPT venció. Vuelve a intentarlo.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let request_deadline = (Instant::now() + Duration::from_secs(3)).min(deadline);
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let mut buffer = [0_u8; 16_384];
                let mut length = 0;
                while length < buffer.len() {
                    let remaining = request_deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() || stream.set_read_timeout(Some(remaining)).is_err() {
                        break;
                    }
                    let Ok(read) = stream.read(&mut buffer[length..]) else {
                        break;
                    };
                    if read == 0 {
                        break;
                    }
                    length += read;
                    if buffer[..length]
                        .windows(4)
                        .any(|window| window == b"\r\n\r\n")
                    {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&buffer[..length]);
                let line = request
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .collect::<Vec<_>>();
                if !request.contains("\r\n\r\n")
                    || line.len() != 3
                    || line[0] != "GET"
                    || !matches!(line[2], "HTTP/1.1" | "HTTP/1.0")
                {
                    write_browser_reply(&mut stream, false);
                    continue;
                }
                let Ok(callback) = parse_callback_target(line[1], expected_state) else {
                    write_browser_reply(&mut stream, false);
                    continue;
                };
                let denied = callback.query_pairs().any(|(key, _)| key == "error");
                write_browser_reply(&mut stream, !denied);
                return Ok(callback);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(80))
            }
            Err(error) => {
                return Err(format!(
                    "No se pudo recibir la respuesta de ChatGPT: {error}"
                ))
            }
        }
    }
}

fn parse_callback_target(target: &str, expected_state: &str) -> Result<Url, String> {
    if !target.starts_with("/auth/callback?") || target.contains('#') || expected_state.is_empty() {
        return Err("ChatGPT devolvió una dirección de retorno inválida.".into());
    }
    let callback = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "ChatGPT devolvió una dirección de retorno inválida.".to_string())?;
    let pairs = callback.query_pairs().collect::<Vec<_>>();
    for field in ["state", "code", "error", "client_id", "scope"] {
        if pairs.iter().filter(|(key, _)| key == field).count() > 1 {
            return Err("ChatGPT devolvió parámetros de retorno duplicados.".into());
        }
    }
    let state_matches = pairs
        .iter()
        .any(|(key, value)| key == "state" && value == expected_state);
    let has_code = pairs
        .iter()
        .any(|(key, value)| key == "code" && !value.is_empty());
    let has_error = pairs
        .iter()
        .any(|(key, value)| key == "error" && !value.is_empty());
    if callback.path() != "/auth/callback" || !state_matches || has_code == has_error {
        return Err("La comprobación de seguridad del inicio de sesión no coincidió.".into());
    }
    Ok(callback)
}

fn write_browser_reply(stream: &mut TcpStream, success: bool) {
    let (status, title, body) = if success {
        (
            "200 OK",
            "Autorización recibida",
            "Vuelve a OrderCode para comprobar que la conexión se haya completado.",
        )
    } else {
        (
            "400 Bad Request",
            "No se completó la conexión",
            "Vuelve a OrderCode e intenta iniciar sesión otra vez.",
        )
    };
    let html = format!("<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>{title}</title><body style=\"font:16px system-ui;background:#0b1018;color:#eef2f8;padding:48px\"><h1>{title}</h1><p>{body}</p></body></html>");
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", html.len(), html);
    let _ = stream.write_all(response.as_bytes());
}

async fn verify_identity(
    token: &str,
    nonce: &str,
    client_id: &str,
) -> Result<IdentityClaims, String> {
    let parts = token.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err("ChatGPT devolvió una identidad inválida.".into());
    }
    let header_bytes = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| "ChatGPT devolvió una identidad inválida.".to_string())?;
    let header: JwtHeader = serde_json::from_slice(&header_bytes)
        .map_err(|_| "ChatGPT devolvió una identidad inválida.".to_string())?;
    if header.alg != "RS256" {
        return Err("ChatGPT utilizó un algoritmo de firma no admitido.".into());
    }
    let jwks: Jwks = http_client()?
        .get(JWKS_ENDPOINT)
        .send()
        .await
        .map_err(|error| format!("No se pudieron validar las credenciales ChatGPT: {error}"))?
        .error_for_status()
        .map_err(|error| format!("No se pudieron validar las credenciales ChatGPT: {error}"))?
        .json()
        .await
        .map_err(|error| format!("No se pudo leer la clave de identidad ChatGPT: {error}"))?;
    let key = jwks
        .keys
        .iter()
        .find(|key| key.kid == header.kid && key.kty == "RSA")
        .ok_or_else(|| "ChatGPT firmó la identidad con una clave no reconocida.".to_string())?;
    let modulus = URL_SAFE_NO_PAD
        .decode(&key.n)
        .map_err(|_| "La clave pública de ChatGPT no es válida.".to_string())?;
    let exponent = URL_SAFE_NO_PAD
        .decode(&key.e)
        .map_err(|_| "La clave pública de ChatGPT no es válida.".to_string())?;
    let signature = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| "La firma de identidad ChatGPT no es válida.".to_string())?;
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    RsaPublicKeyComponents {
        n: &modulus,
        e: &exponent,
    }
    .verify(
        &RSA_PKCS1_2048_8192_SHA256,
        signing_input.as_bytes(),
        &signature,
    )
    .map_err(|_| "La firma de identidad ChatGPT no se pudo validar.".to_string())?;
    let claims_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| "ChatGPT devolvió una identidad inválida.".to_string())?;
    let claims: IdentityClaims = serde_json::from_slice(&claims_bytes)
        .map_err(|_| "ChatGPT devolvió una identidad incompleta.".to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    validate_identity_claims(&claims, nonce, client_id, now)?;
    Ok(claims)
}

fn validate_identity_claims(
    claims: &IdentityClaims,
    nonce: &str,
    client_id: &str,
    now: u64,
) -> Result<(), String> {
    let audience_matches = claims.aud.as_str() == Some(client_id)
        || claims
            .aud
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(client_id)));
    if claims.iss != ISSUER
        || !audience_matches
        || claims
            .azp
            .as_deref()
            .is_some_and(|party| party != client_id)
        || claims
            .aud
            .as_array()
            .is_some_and(|items| items.len() > 1 && claims.azp.as_deref() != Some(client_id))
        || claims.exp <= now.saturating_sub(5)
        || claims.iat > now.saturating_add(5)
        || claims.nonce != nonce
        || claims.sub.is_empty()
    {
        return Err(
            "La identidad ChatGPT no coincide con la solicitud de inicio de sesión.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credential() -> ChatGPTCredential {
        ChatGPTCredential {
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            id_token: "login-a".into(),
            client_id: "client".into(),
            subject: "subject".into(),
            email: None,
            host_id: "host".into(),
            expires_at: 1000,
            scopes: vec!["chatgpt.tokens.use.direct".into()],
        }
    }

    fn claims() -> IdentityClaims {
        IdentityClaims {
            iss: ISSUER.into(),
            aud: serde_json::json!("client"),
            azp: None,
            exp: 2000,
            iat: 900,
            sub: "subject".into(),
            nonce: "nonce".into(),
            email: None,
        }
    }

    #[test]
    fn callback_accepts_encoded_authorization_and_denial() {
        let callback = parse_callback_target(
            "/auth/callback?state=expected&code=a%2Bb&client_id=issued",
            "expected",
        )
        .unwrap();
        assert!(callback
            .query_pairs()
            .any(|(key, value)| key == "code" && value == "a+b"));
        assert!(parse_callback_target(
            "/auth/callback?state=expected&error=access_denied",
            "expected"
        )
        .is_ok());
    }

    #[test]
    fn callback_rejects_state_confusion_and_duplicate_parameters() {
        for target in [
            "/auth/callback?state=wrong&code=x",
            "/auth/callback?state=expected&state=other&code=x",
            "/auth/callback?state=expected&code=x&code=y",
            "/auth/callback?state=expected&code=x&client_id=a&client_id=b",
            "/auth/callback?state=expected&code=x&error=denied",
        ] {
            assert!(
                parse_callback_target(target, "expected").is_err(),
                "{target}"
            );
        }
    }

    #[test]
    fn callback_rejects_wrong_path_origin_fragment_and_missing_code() {
        for target in [
            "https://evil.example/auth/callback?state=expected&code=x",
            "//evil.example/auth/callback?state=expected&code=x",
            "/auth/callback/other?state=expected&code=x",
            "/auth/callback?state=expected&code=x#ignored",
            "/auth/callback?state=expected",
            "/auth/callback?state=expected&code=",
        ] {
            assert!(
                parse_callback_target(target, "expected").is_err(),
                "{target}"
            );
        }
    }

    #[test]
    fn rotation_is_bound_to_login_and_not_just_account() {
        let active = credential();
        let mut rotated = active.clone();
        rotated.access_token = "new-access".into();
        rotated.refresh_token = "new-refresh".into();
        assert!(same_connection(&active, &rotated));
        rotated.id_token = "different-login".into();
        assert!(!same_connection(&active, &rotated));
        rotated = active.clone();
        rotated.subject = "different-account".into();
        assert!(!same_connection(&active, &rotated));
        rotated = active.clone();
        rotated.client_id = "different-client".into();
        assert!(!same_connection(&active, &rotated));
    }

    #[test]
    fn identity_checks_audience_nonce_issuer_and_validity() {
        let valid = claims();
        assert!(validate_identity_claims(&valid, "nonce", "client", 1000).is_ok());
        assert!(validate_identity_claims(&valid, "wrong", "client", 1000).is_err());
        assert!(validate_identity_claims(&valid, "nonce", "other", 1000).is_err());
        assert!(validate_identity_claims(&valid, "nonce", "client", 2100).is_err());
        let mut altered = claims();
        altered.iss = "https://evil.example".into();
        assert!(validate_identity_claims(&altered, "nonce", "client", 1000).is_err());
        altered = claims();
        altered.iat = 1100;
        assert!(validate_identity_claims(&altered, "nonce", "client", 1000).is_err());
        altered = claims();
        altered.aud = serde_json::json!(["other", "client"]);
        assert!(validate_identity_claims(&altered, "nonce", "client", 1000).is_err());
        altered.azp = Some("client".into());
        assert!(validate_identity_claims(&altered, "nonce", "client", 1000).is_ok());
    }

    #[test]
    fn malformed_and_unsigned_identity_tokens_fail_before_network() {
        for token in [
            "",
            "invalid",
            "invalid.parts.count.here",
            "!.e30.invalid",
            "eyJhbGciOiJub25lIiwia2lkIjoidGVzdCJ9.e30.invalid",
        ] {
            assert!(
                tauri::async_runtime::block_on(verify_identity(token, "nonce", "client")).is_err()
            );
        }
    }

    #[test]
    fn loopback_login_survives_unrelated_or_mismatched_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            wait_for_callback_until(
                listener,
                "expected",
                Instant::now() + Duration::from_secs(5),
            )
        });
        for (target, expected_status) in [
            ("/auth/callback?state=other&code=bad", "400 Bad Request"),
            (
                "/auth/callback?state=expected&code=accepted&client_id=client",
                "200 OK",
            ),
        ] {
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            write!(
                stream,
                "GET {target} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {expected_status}")));
        }
        let callback = worker.join().unwrap().unwrap();
        assert!(callback
            .query_pairs()
            .any(|(key, value)| key == "code" && value == "accepted"));
    }
}
