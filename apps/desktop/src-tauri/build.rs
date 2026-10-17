use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let host = env::var("HOST").unwrap_or_default();
    let target = env::var("TARGET").unwrap_or_default();
    if host != target { panic!("Cross-compiling OrderCode requires a Node.js runtime built for the target platform."); }

    let (locator, argument, runtime_name, expected_arch) = match target_os.as_str() {
        "windows" => ("where.exe", "node.exe", "node.exe", if target_arch == "aarch64" { "arm64" } else { "x64" }),
        "macos" | "linux" => ("which", "node", "node", if target_arch == "aarch64" { "arm64" } else if target_arch == "x86_64" { "x64" } else { "unknown" }),
        _ => panic!("OrderCode's packaged Harness runtime is unsupported on target OS {target_os}.")
    };

    let lookup = Command::new(locator).arg(argument).output().unwrap_or_else(|error| panic!("Could not find the Node.js runtime needed to package OrderCode: {error}"));
    if !lookup.status.success() { panic!("Node.js 24 or newer is required to package OrderCode."); }
    let node = String::from_utf8_lossy(&lookup.stdout).lines().next().map(PathBuf::from).filter(|path| path.is_file()).unwrap_or_else(|| panic!("Could not resolve the Node.js executable returned by {locator}."));
    let version = Command::new(&node).arg("--version").output().unwrap_or_else(|error| panic!("Could not inspect the Node.js runtime: {error}"));
    let version_text = String::from_utf8_lossy(&version.stdout);
    let major = version_text.trim().trim_start_matches('v').split('.').next().and_then(|value| value.parse::<u32>().ok()).unwrap_or_default();
    if !version.status.success() || major < 24 { panic!("OrderCode requires Node.js 24 or newer to package its Harness; found {}.", version_text.trim()); }
    let actual_arch = Command::new(&node).args(["-p", "process.arch"]).output().unwrap_or_else(|error| panic!("Could not inspect Node.js architecture: {error}"));
    let actual_arch = String::from_utf8_lossy(&actual_arch.stdout).trim().to_string();
    if actual_arch != expected_arch { panic!("Node.js architecture {actual_arch} does not match target architecture {expected_arch}."); }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let binaries = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries).expect("could not create the Tauri binary resource directory");
    let destination = binaries.join(runtime_name);
    fs::copy(&node, &destination).unwrap_or_else(|error| panic!("Could not package the Node.js runtime: {error}"));
    println!("cargo:rerun-if-changed={}", node.display());
    println!("cargo:rerun-if-env-changed=PATH");

    tauri_build::build()
}
