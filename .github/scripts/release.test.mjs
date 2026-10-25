import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { appleSigningEnvironment, assembleRelease, collectBundles, targets } from './release.mjs';

const version = '0.3.21';
const commit = 'a'.repeat(40);
async function removeFixture(root, path = root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('ordercode-release-test-'));
  assert.ok(!relative(root, path).startsWith('..'));
  await rm(path, { recursive: true, force: true });
}
// Controlled bundle/signature fixtures exercise packaging; CI verifies real signatures with minisign.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ordercode-release-test-'));
  t.after(() => removeFixture(root));
  const inputDir = join(root, 'inputs');
  for (const [platform, target] of Object.entries(targets)) {
    const bundleDir = join(root, 'build', platform); await mkdir(bundleDir, { recursive: true });
    for (const extension of target.required) {
      const name = extension === '.app.tar.gz' ? 'OrderCode.app.tar.gz' : `OrderCode_${version}_${platform}${extension}`;
      await writeFile(join(bundleDir, name), `native bundle fixture for ${platform} ${extension}`);
      if (extension === target.update) await writeFile(join(bundleDir, `${name}.sig`), Buffer.from(`untrusted comment: fixture\n${'x'.repeat(100)}\ntrusted comment: fixture`).toString('base64'));
    }
    // A cached installer from an earlier release must not be collected.
    await writeFile(join(bundleDir, `OrderCode_0.3.20_${platform}${target.required[0]}`), 'old fixture');
    await collectBundles({ platform, bundleDir, outputDir: inputDir, version, commit });
  }
  return { root, inputDir, outputDir: join(root, 'release'), version, commit, repository: 'MatiasDuport/OrderCode' };
}

test('missing Apple credentials produce only ad-hoc identity, never empty certificate variables', () => {
  assert.deepEqual(appleSigningEnvironment({}), { APPLE_SIGNING_IDENTITY: '-' });
  assert.deepEqual(appleSigningEnvironment({ APPLE_CERTIFICATE: '', APPLE_SIGNING_IDENTITY: '' }), { APPLE_SIGNING_IDENTITY: '-' });
  assert.throws(() => appleSigningEnvironment({ APPLE_CERTIFICATE: 'certificate' }), /certificate and its signing identity/);
  assert.throws(() => appleSigningEnvironment({ APPLE_CERTIFICATE: 'certificate', APPLE_SIGNING_IDENTITY: 'Developer ID', APPLE_ID: 'id' }), /together/);
  assert.deepEqual(appleSigningEnvironment({ APPLE_CERTIFICATE: 'certificate', APPLE_SIGNING_IDENTITY: 'Developer ID', APPLE_CERTIFICATE_PASSWORD: '' }), { APPLE_CERTIFICATE: 'certificate', APPLE_SIGNING_IDENTITY: 'Developer ID' });
});

test('assembles six native targets from one commit with distinct macOS updater archives', async t => {
  const context = await fixture(t);
  const manifest = await assembleRelease(context);
  assert.equal(manifest.version, version);
  assert.equal(Object.keys(manifest.platforms).length, 6);
  assert.ok(manifest.platforms['windows-aarch64'].url.endsWith('.exe'));
  assert.notEqual(manifest.platforms['darwin-aarch64'].url, manifest.platforms['darwin-x86_64'].url);
  for (const entry of Object.values(manifest.platforms)) {
    const name = decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1));
    assert.equal((await readFile(join(context.outputDir, `${name}.sig`), 'utf8')).trim(), entry.signature);
  }
});

test('refuses incomplete platforms and mixed source commits before publication', async t => {
  const context = await fixture(t);
  const file = join(context.inputDir, 'macos-arm64.bundle.json');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace(commit, 'b'.repeat(40)));
  await assert.rejects(assembleRelease(context), /different version or commit/);
  await writeFile(file, original);
  await removeFixture(context.root, join(context.inputDir, 'windows-arm64.bundle.json'));
  await assert.rejects(assembleRelease(context), /ENOENT/);
});

test('refuses changed package bytes and missing updater signatures', async t => {
  const context = await fixture(t);
  const directory = context.inputDir;
  const metadata = JSON.parse(await readFile(join(directory, 'linux-x64.bundle.json'), 'utf8'));
  await writeFile(join(directory, metadata.updater), 'changed fixture');
  await assert.rejects(assembleRelease(context), /corrupt bundle/);
  const bundleDir = join(context.root, 'unsigned'); await mkdir(bundleDir);
  await writeFile(join(bundleDir, `OrderCode_${version}_arm64.exe`), 'unsigned fixture');
  await assert.rejects(collectBundles({ platform: 'windows-arm64', bundleDir, outputDir: join(context.root, 'unsigned-out'), version, commit }), /signature is missing/);
});
