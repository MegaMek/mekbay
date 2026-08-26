import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeDeterministicFile } from './deterministic-output';

export const REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH = 'online-assets/assets-manifest.json' as const;

export type RepositoryAssetsManifest = Readonly<Record<string, string>>;

const HASH_PATTERN = /^[A-Za-z0-9_-]{27}$/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha1(bytes: Buffer): string {
  return crypto.createHash('sha1').update(bytes).digest('base64url');
}

function isDeployableAsset(relativePath: string): boolean {
  if (!relativePath.startsWith('online-assets/')) return false;
  if (relativePath === REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH
    || relativePath === 'online-assets/asset-manifest.json') return false;
  if (relativePath.startsWith('online-assets/generated/units/')) return false;
  return !relativePath.split('/').some(segment => segment.startsWith('.'));
}

function walkRegularFiles(directory: string, root: string, output: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Repository asset tree contains a symbolic link: ${absolutePath}`);
    if (entry.isDirectory()) {
      walkRegularFiles(absolutePath, root, output);
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (isDeployableAsset(relativePath)) output.push(relativePath);
    } else {
      throw new Error(`Repository asset tree contains a non-file entry: ${absolutePath}`);
    }
  }
}

export function buildRepositoryAssetsManifest(publicRoot: string): RepositoryAssetsManifest {
  const resolvedRoot = path.resolve(publicRoot);
  const paths: string[] = [];
  walkRegularFiles(resolvedRoot, resolvedRoot, paths);
  paths.sort(compareText);

  const manifest: Record<string, string> = {};
  for (const relativePath of paths) {
    assertAssetPath(relativePath);
    manifest[relativePath] = sha1(fs.readFileSync(path.join(resolvedRoot, ...relativePath.split('/'))));
  }
  return Object.freeze(manifest);
}

export function writeRepositoryAssetsManifest(publicRoot: string): RepositoryAssetsManifest {
  const obsoletePath = path.join(publicRoot, 'online-assets', 'asset-manifest.json');
  if (fs.existsSync(obsoletePath)) fs.unlinkSync(obsoletePath);
  const manifest = buildRepositoryAssetsManifest(publicRoot);
  const outputPath = path.join(publicRoot, ...REPOSITORY_ASSETS_MANIFEST_RELATIVE_PATH.split('/'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeDeterministicFile(outputPath, JSON.stringify(manifest));
  return manifest;
}

export function assertRepositoryAssetsManifest(value: unknown): asserts value is RepositoryAssetsManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Assets manifest must be an object');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) throw new Error('Assets manifest is empty');
  for (const [assetPath, hash] of entries) {
    assertAssetPath(assetPath);
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) {
      throw new Error(`Assets manifest contains an invalid hash: ${assetPath}`);
    }
  }
}

function assertAssetPath(value: string): void {
  if (!/^[A-Za-z0-9._ /-]+$/u.test(value)
    || value.startsWith('/')
    || value.includes('\\')
    || !isDeployableAsset(value)
    || value.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Invalid repository asset path: ${value}`);
  }
}
