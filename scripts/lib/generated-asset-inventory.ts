import fs from 'node:fs';
import path from 'node:path';

export interface GeneratedAssetFileInventoryEntry {
  readonly relativePath: string;
  readonly required: boolean;
  readonly producers: readonly string[];
}

export interface GeneratedAssetPatternInventoryEntry {
  readonly directory: string;
  readonly pattern: RegExp;
  readonly required: boolean;
  readonly producer: string;
}

export const GENERATED_ASSET_FILES: readonly GeneratedAssetFileInventoryEntry[] = Object.freeze([
  { relativePath: 'units-manifest.json', required: true, producers: ['scripts/generate-core-unit-assets.ts'] },
  { relativePath: 'units.zip', required: true, producers: ['scripts/generate-core-unit-assets.ts'] },
  { relativePath: 'factions-lite.json', required: true, producers: ['scripts/generate-megamek-availability.ts'] },
  { relativePath: 'force-name-words.json', required: true, producers: ['scripts/generate-force-name-words.ts'] },
  { relativePath: 'mulized_availability_weighted.json', required: true, producers: ['scripts/generate-megamek-availability.ts'] },
  { relativePath: 'pilot-names.json', required: true, producers: ['scripts/generate-force-name-words.ts'] },
  { relativePath: 'rulesets.json', required: true, producers: ['scripts/generate-megamek-rulesets.ts'] },
  { relativePath: 'sarna-page-titles.json', required: true, producers: ['scripts/generate-sarna-page-titles.ts'] },
  { relativePath: 'sourcebooks.json', required: true, producers: ['scripts/generate-assets.ts'] },

]);

export const GENERATED_ASSET_PATTERNS: readonly GeneratedAssetPatternInventoryEntry[] = Object.freeze([
  {
    directory: 'units',
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:mtf|blk)$/u,
    required: true,
    producer: 'scripts/generate-core-unit-assets.ts',
  },
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function displayPath(assetsRoot: string, filePath: string): string {
  return path.relative(assetsRoot, filePath).split(path.sep).join('/');
}

function assertRegularFile(filePath: string, assetsRoot: string): void {
  if (!fs.lstatSync(filePath).isFile()) {
    throw new Error(`Generated asset is not a regular file: ${displayPath(assetsRoot, filePath)}`);
  }
}

export function listGeneratedAssetFiles(assetsRoot: string): string[] {
  const resolvedAssetsRoot = path.resolve(assetsRoot);
  const files: string[] = [];

  for (const entry of GENERATED_ASSET_FILES) {
    const filePath = path.join(resolvedAssetsRoot, entry.relativePath);
    if (!fs.existsSync(filePath)) {
      if (entry.required) {
        throw new Error(`Required generated asset is missing: ${entry.relativePath}`);
      }
      continue;
    }
    assertRegularFile(filePath, resolvedAssetsRoot);
    files.push(filePath);
  }

  for (const entry of GENERATED_ASSET_PATTERNS) {
    const directoryPath = path.resolve(resolvedAssetsRoot, entry.directory);
    if (!fs.existsSync(directoryPath)) {
      if (entry.required) {
        throw new Error(`Required generated asset directory is missing: ${entry.directory}`);
      }
      continue;
    }
    if (!fs.lstatSync(directoryPath).isDirectory()) {
      throw new Error(`Generated asset root is not a directory: ${entry.directory}`);
    }

    const matchingNames = fs.readdirSync(directoryPath)
      .filter((name) => entry.pattern.test(name))
      .sort(compareText);
    if (entry.required && matchingNames.length === 0) {
      throw new Error(`Generated asset pattern has no matches: ${entry.directory}/${entry.pattern.source}`);
    }
    for (const name of matchingNames) {
      const filePath = path.join(directoryPath, name);
      assertRegularFile(filePath, resolvedAssetsRoot);
      files.push(filePath);
    }
  }

  return files.sort((left, right) => compareText(displayPath(resolvedAssetsRoot, left), displayPath(resolvedAssetsRoot, right)));
}
