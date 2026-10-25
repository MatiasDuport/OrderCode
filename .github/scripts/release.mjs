import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const targets = {
  'windows-x64': { key: 'windows-x86_64', required: ['.msi'], update: '.msi' },
  'windows-arm64': { key: 'windows-aarch64', required: ['.exe'], update: '.exe' },
  'macos-arm64': { key: 'darwin-aarch64', required: ['.dmg', '.app.tar.gz'], update: '.app.tar.gz' },
  'macos-x64': { key: 'darwin-x86_64', required: ['.dmg', '.app.tar.gz'], update: '.app.tar.gz' },
  'linux-x64': { key: 'linux-x86_64', required: ['.AppImage', '.deb'], update: '.AppImage' },
  'linux-arm64': { key: 'linux-aarch64', required: ['.AppImage', '.deb'], update: '.AppImage' },
};

export async function releaseVersion(root = process.cwd()) {
  const paths = ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json'];
  const versions = await Promise.all(paths.map(async path => JSON.parse(await readFile(join(root, path), 'utf8')).version));
  const cargo = await readFile(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const native = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(versions[0]) || versions.some(version => version !== native)) throw new Error('Release versions must match in all desktop manifests.');
  return versions[0];
}

export function appleSigningEnvironment(values) {
  const certificate = values.APPLE_CERTIFICATE?.trim();
  const identity = values.APPLE_SIGNING_IDENTITY?.trim();
  const notarization = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
  const hasNotary = notarization.some(key => values[key]?.trim());
  if (!certificate && !identity && !hasNotary && !values.APPLE_CERTIFICATE_PASSWORD) return { APPLE_SIGNING_IDENTITY: '-' };
  if (!certificate || !identity || identity === '-') throw new Error('Apple Developer signing requires a certificate and its signing identity.');
  if (hasNotary && !notarization.every(key => values[key]?.trim())) throw new Error('Apple notarization requires APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID together.');
  return Object.fromEntries(['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', ...notarization].filter(key => values[key]?.length).map(key => [key, values[key]]));
}

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith('.app')) result.push(...await filesIn(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

export async function collectBundles({ platform, bundleDir, outputDir, version, commit }) {
  const target = targets[platform];
  if (!target || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('A known platform and exact source commit are required.');
  const available = await filesIn(bundleDir);
  const bundles = target.required.map(extension => {
    const matches = available.filter(path => path.endsWith(extension) && (extension === '.app.tar.gz' || basename(path).includes(`_${version}_`)));
    if (matches.length !== 1) throw new Error(`${platform}: expected one ${extension} bundle, found ${matches.length}.`);
    return matches[0];
  });
  const update = bundles.find(path => path.endsWith(target.update));
  if (!available.includes(`${update}.sig`)) throw new Error(`${platform}: updater signature is missing.`);
  await mkdir(outputDir, { recursive: true });
  const files = [];
  let updater;
  for (const bundle of bundles) {
    const name = bundle.endsWith('.app.tar.gz') ? `OrderCode_${version}_${platform.endsWith('arm64') ? 'aarch64' : 'x64'}.app.tar.gz` : basename(bundle);
    if (bundle === update) updater = name;
    for (const [source, destination] of [[bundle, name], ...available.includes(`${bundle}.sig`) ? [[`${bundle}.sig`, `${name}.sig`]] : []]) {
      await copyFile(source, join(outputDir, destination));
      const info = await stat(source);
      if (!info.size) throw new Error(`Empty release file: ${source}`);
      files.push({ name: destination, size: info.size, sha256: await digest(source) });
    }
  }
  const metadata = { platform, version, commit, updater, files };
  await writeFile(join(outputDir, `${platform}.bundle.json`), JSON.stringify(metadata, null, 2));
  return metadata;
}

export async function assembleRelease({ inputDir, outputDir, version, commit, repository }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release source or repository.');
  await mkdir(outputDir, { recursive: true });
  const platforms = {};
  const usedNames = new Set();
  for (const [platform, target] of Object.entries(targets)) {
    const directory = inputDir;
    const metadata = JSON.parse(await readFile(join(directory, `${platform}.bundle.json`), 'utf8'));
    if (metadata.platform !== platform || metadata.version !== version || metadata.commit !== commit) throw new Error(`${platform}: bundles come from a different version or commit.`);
    const names = new Set(metadata.files.map(file => file.name));
    if (names.size !== metadata.files.length || !names.has(metadata.updater) || !names.has(`${metadata.updater}.sig`) || !metadata.updater.endsWith(target.update)) throw new Error(`${platform}: invalid updater metadata.`);
    for (const extension of target.required) if ([...names].filter(name => name.endsWith(extension)).length !== 1) throw new Error(`${platform}: missing or duplicate ${extension}.`);
    for (const file of metadata.files) {
      if (!file.name || basename(file.name) !== file.name || /[\\/]/.test(file.name) || usedNames.has(file.name)) throw new Error('Release filenames must be unique basenames.');
      const source = join(directory, file.name);
      const info = await stat(source);
      if (!info.isFile() || !info.size || info.size !== file.size || await digest(source) !== file.sha256) throw new Error(`${platform}: corrupt bundle ${file.name}.`);
      usedNames.add(file.name);
      await copyFile(source, join(outputDir, file.name));
    }
    const signature = (await readFile(join(directory, `${metadata.updater}.sig`), 'utf8')).trim();
    if (signature.length < 80 || signature.length > 16_000) throw new Error(`${platform}: invalid updater signature.`);
    platforms[target.key] = { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(metadata.updater)}` };
  }
  const manifest = { version, pub_date: new Date().toISOString(), notes: 'OrderCode Desktop: Windows x64/ARM64, macOS Intel/Apple Silicon y Linux x64/ARM64.', platforms };
  await writeFile(join(outputDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const version = await releaseVersion();
  if (command === 'version') {
    if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('The release tag must match the app version.');
    console.log(version);
  } else if (command === 'apple-signing') {
    const keys = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
    const values = Object.fromEntries(keys.map(key => [key, process.env[`OPTIONAL_${key}`]]));
    const environment = appleSigningEnvironment(values);
    for (const [key, value] of Object.entries(environment)) {
      const delimiter = `ORDERCODE_${randomUUID()}`;
      await appendFile(process.env.GITHUB_ENV, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
    }
    console.log(environment.APPLE_SIGNING_IDENTITY === '-' ? 'macOS: ad-hoc signature; Apple notarization is not configured.' : 'macOS: Apple Developer signing configured.');
  } else if (command === 'collect') {
    const [platform, bundleDir, outputDir] = args;
    const metadata = await collectBundles({ platform, bundleDir, outputDir, version, commit: process.env.GITHUB_SHA });
    console.log(JSON.stringify({ platform, files: metadata.files.map(file => file.name) }));
  } else if (command === 'assemble') {
    const [inputDir, outputDir] = args;
    const manifest = await assembleRelease({ inputDir, outputDir, version, commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY });
    console.log(JSON.stringify({ version, platforms: Object.keys(manifest.platforms) }));
  } else throw new Error('Expected version, apple-signing, collect or assemble.');
}
