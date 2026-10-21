use reqwest::{header::HeaderMap, redirect::Policy, Client, Url};
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCheck {
    url: String,
    status: Option<u16>,
    issue: Option<&'static str>,
}

fn allowed_url(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    let local = host.eq_ignore_ascii_case("localhost") || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback());
    url.username().is_empty() && url.password().is_none()
        && (url.scheme() == "https" || (url.scheme() == "http" && local))
}

fn ancestor_matches(source: &str, parent: &Url, page: &Url) -> bool {
    if source == "'self'" { return parent.origin() == page.origin(); }
    if source == "*" { return matches!(parent.scheme(), "http" | "https"); }
    if source.ends_with(':') { return source == format!("{}:", parent.scheme()); }
    let candidate = if source.contains("://") { source.to_owned() } else { format!("{}://{source}", page.scheme()) };
    let wildcard_port = candidate.ends_with(":*");
    let candidate = candidate.strip_suffix(":*").unwrap_or(&candidate);
    let Ok(pattern) = Url::parse(candidate) else { return false; };
    let pattern_host = pattern.host_str().unwrap_or_default();
    let parent_host = parent.host_str().unwrap_or_default();
    let host_matches = pattern_host.strip_prefix("*.").map_or(pattern_host == parent_host, |suffix| parent_host.ends_with(&format!(".{suffix}")));
    pattern.scheme() == parent.scheme() && host_matches && (wildcard_port || pattern.port_or_known_default() == parent.port_or_known_default())
}

fn frame_blocked(headers: &HeaderMap, page: &Url, parent: &Url) -> bool {
    let mut has_ancestors = false;
    for header in headers.get_all("content-security-policy") {
        let Ok(value) = header.to_str() else { continue; };
        for policy in value.split(',') {
            for directive in policy.split(';') {
                let mut sources = directive.split_whitespace();
                if sources.next().is_some_and(|name| name.eq_ignore_ascii_case("frame-ancestors")) {
                    has_ancestors = true;
                    if !sources.any(|source| ancestor_matches(source, parent, page)) { return true; }
                }
            }
        }
    }
    // An enforced frame-ancestors directive takes precedence over X-Frame-Options.
    if has_ancestors { return false; }
    headers.get_all("x-frame-options").iter().filter_map(|value| value.to_str().ok()).any(|value| {
        value.split(',').any(|item| item.trim().eq_ignore_ascii_case("deny") || (item.trim().eq_ignore_ascii_case("sameorigin") && page.origin() != parent.origin()))
    })
}

async fn check(url: String, parent: &Url, client: &Client) -> PreviewCheck {
    // Prefer HEAD to avoid rendering/downloading the page twice. Some development
    // servers only implement GET; still never buffer the document or send credentials.
    let response = match client.head(&url).send().await {
        Ok(response) if matches!(response.status().as_u16(), 405 | 501) => client.get(&url).send().await,
        result => result,
    };
    match response {
        Ok(response) => {
            let status = response.status();
            let issue = if response.url().origin() == parent.origin() { Some("app") }
                else if !status.is_success() { Some("http") }
                else if frame_blocked(response.headers(), response.url(), parent) { Some("embedded") }
                else { None };
            PreviewCheck { url: response.url().to_string(), status: Some(status.as_u16()), issue }
        }
        Err(error) => PreviewCheck { url, status: None, issue: Some(if error.is_timeout() { "timeout" } else { "unavailable" }) },
    }
}

#[tauri::command]
pub async fn web_preview_check(url: String, parent_origin: String) -> Result<PreviewCheck, String> {
    if url.len() > 4096 { return Err("La dirección es demasiado larga.".into()); }
    let parsed = Url::parse(&url).map_err(|_| "La dirección web no es válida.")?;
    if !allowed_url(&parsed) { return Err("Usa HTTPS o un servidor local, sin credenciales en la dirección.".into()); }
    let parent = Url::parse(&parent_origin).map_err(|_| "No se pudo comprobar el origen de la vista previa.")?;
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .referer(false)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed_url(attempt.url()) { attempt.stop() } else { attempt.follow() }
        }))
        .build().map_err(|_| "No se pudo iniciar la comprobación de la página.")?;
    Ok(check(parsed.to_string(), &parent, &client).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener, thread};

    #[test]
    fn validates_addresses_and_embedding_policies() {
        for input in ["https://example.com", "http://localhost:8080", "http://127.0.0.1:3000", "http://[::1]:8080"] { assert!(allowed_url(&Url::parse(input).unwrap())); }
        for input in ["http://example.com", "file:///C:/secret", "https://user:secret@example.com", "javascript:alert(1)"] { assert!(!allowed_url(&Url::parse(input).unwrap())); }
        let page = Url::parse("https://site.test").unwrap();
        let parent = Url::parse("http://tauri.localhost").unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-frame-options", "DENY".parse().unwrap());
        assert!(frame_blocked(&headers, &page, &parent));
        headers.insert("content-security-policy", "frame-ancestors http://tauri.localhost".parse().unwrap());
        assert!(!frame_blocked(&headers, &page, &parent));
        headers.insert("content-security-policy", "default-src 'self'; frame-ancestors 'self'".parse().unwrap());
        assert!(frame_blocked(&headers, &page, &parent));
        assert!(!frame_blocked(&headers, &page, &page));
        headers.insert("content-security-policy", "frame-ancestors 'none'".parse().unwrap());
        assert!(frame_blocked(&headers, &page, &parent));
    }

    #[test]
    fn checks_a_real_local_server_and_rejects_unsafe_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for (method, response) in [
                ("HEAD", "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                ("HEAD", "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                ("HEAD", "HTTP/1.1 200 OK\r\nX-Frame-Options: DENY\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                ("HEAD", "HTTP/1.1 302 Found\r\nLocation: http://external.test/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                ("HEAD", "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                ("GET", "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
            ] {
                let (mut connection, _) = listener.accept().unwrap();
                connection.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = [0; 2048];
                let count = connection.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..count]);
                assert!(request.starts_with(method));
                assert!(!request.to_lowercase().contains("authorization:"));
                assert!(!request.to_lowercase().contains("cookie:"));
                connection.write_all(response.as_bytes()).unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let url = format!("http://{address}/");
            let origin = "http://tauri.localhost".to_owned();
            assert!(web_preview_check(url.clone(), origin.clone()).await.unwrap().issue.is_none());
            let missing = web_preview_check(url.clone(), origin.clone()).await.unwrap();
            assert_eq!(missing.issue, Some("http")); assert_eq!(missing.status, Some(404));
            assert_eq!(web_preview_check(url.clone(), origin.clone()).await.unwrap().issue, Some("embedded"));
            let redirected = web_preview_check(url.clone(), origin.clone()).await.unwrap();
            assert_eq!(redirected.status, Some(302)); assert_eq!(redirected.issue, Some("http"));
            assert!(web_preview_check(url, origin).await.unwrap().issue.is_none());
        });
        server.join().unwrap();
        let unavailable = tauri::async_runtime::block_on(web_preview_check(format!("http://{address}/"), "http://tauri.localhost".into())).unwrap();
        assert_eq!(unavailable.issue, Some("unavailable"));
    }
}
