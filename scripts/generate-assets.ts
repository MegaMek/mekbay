/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { writeDeterministicFile } from './lib/deterministic-output';
import { writeRepositoryAssetsManifest } from './lib/repository-asset-manifest';
import { loadOptionalEnvFile, resolveMmDataRoot } from './lib/script-paths';

const root = path.resolve(__dirname, '..');

loadOptionalEnvFile(root, { logPrefix: 'Assets' });

const mmDataRoot = resolveMmDataRoot(root);
process.env.MM_DATA_PATH = mmDataRoot;
const sourcebooksDir = path.join(mmDataRoot, 'data', 'sourcebooks');
const sourcebooksOutput = path.join(root, 'public', 'online-assets', 'generated', 'sourcebooks.json');
const megaMekAvailabilityScript = path.join(__dirname, 'generate-megamek-availability.ts');
const megaMekRulesetsScript = path.join(__dirname, 'generate-megamek-rulesets.ts');
const sarnaPageTitlesScript = path.join(__dirname, 'generate-sarna-page-titles.ts');
const forceNameWordsScript = path.join(__dirname, 'generate-force-name-words.ts');
const coreUnitAssetsScript = path.join(__dirname, 'generate-core-unit-assets.ts');
const spriteMapScript = path.join(__dirname, 'generate-sprite-map.ts');

console.log(`[Assets] Using MM data from: ${mmDataRoot}`);
console.log(`[Assets] Using sourcebooks from: ${sourcebooksDir}`);

interface SourcebookRecord {
  readonly id?: unknown;
  readonly sku?: unknown;
  readonly abbrev: string;
  readonly title?: unknown;
  readonly image?: unknown;
  readonly url?: unknown;
  readonly mul_url?: unknown;
  readonly canon?: unknown;
}

interface GeneratedSourcebook {
  readonly id: number;
  readonly sku: unknown;
  readonly abbrev: string;
  readonly title: unknown;
  readonly image: unknown;
  readonly url: unknown;
  readonly mul_url: unknown;
  readonly canon: boolean;
}

function isSourcebookRecord(value: unknown): value is SourcebookRecord {
  return value !== null
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>)['abbrev'] === 'string';
}

/**
 * MegaMek uses missing/-1 IDs for publications that have no MUL row. MekBay's
 * persisted catalog requires every row to have a stable unique numeric key, so
 * derive a deterministic negative ID from the publication abbreviation while
 * preserving authoritative non-negative IDs verbatim.
 */
function normalizedSourcebookId(value: unknown, abbrev: string): number {
  if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(abbrev)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return -((hash >>> 0) + 1);
}

function runTypeScriptScript(scriptPath: string): void {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`TypeScript script not found: ${scriptPath}`);
  }

  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const exitDetails = result.status === null ? 'no exit code' : `code ${result.status}`;
    const signalDetails = result.signal ? ` (signal ${result.signal})` : '';
    throw new Error(`${path.basename(scriptPath)} exited with ${exitDetails}${signalDetails}`);
  }
}

function generateSourcebooks(): void {
  if (!fs.existsSync(sourcebooksDir)) {
    console.log(`[Assets] Sourcebooks directory not found: ${sourcebooksDir}`);
    console.log(`[Assets] Please check MM_DATA_PATH in .env or environment variables.`);
    return;
  }

  const files = fs.readdirSync(sourcebooksDir).filter(f => f.endsWith('.yaml')).sort();
  const sourcebooks: GeneratedSourcebook[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(sourcebooksDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = yaml.load(content);

      if (isSourcebookRecord(data)) {
        sourcebooks.push({
          id: normalizedSourcebookId(data.id, data.abbrev),
          sku: data.sku || '',
          abbrev: data.abbrev,
          title: data.title || data.abbrev,
          image: data.image || undefined,
          url: data.url || undefined,
          mul_url: data.mul_url || undefined,
          canon: !!data.canon,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[Assets] Failed to parse ${file}: ${message}`);
    }
  }

  const ids = new Set<number>();
  const abbreviations = new Set<string>();
  for (const sourcebook of sourcebooks) {
    if (ids.has(sourcebook.id) || abbreviations.has(sourcebook.abbrev)) {
      throw new Error(`Duplicate generated sourcebook identity: ${sourcebook.abbrev} (${sourcebook.id})`);
    }
    ids.add(sourcebook.id);
    abbreviations.add(sourcebook.abbrev);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(sourcebooksOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  writeDeterministicFile(sourcebooksOutput, JSON.stringify(sourcebooks, null, 2));
  console.log(`[Assets] Generated ${sourcebooksOutput} with ${sourcebooks.length} sourcebooks.`);
}

async function main(): Promise<void> {
  try {
    runTypeScriptScript(forceNameWordsScript);
    runTypeScriptScript(megaMekAvailabilityScript);
    runTypeScriptScript(megaMekRulesetsScript);
    runTypeScriptScript(sarnaPageTitlesScript);
    generateSourcebooks();
    // Core UnitSummary projection consumes these exact generated presentation
    // and sourcebook inputs, so they must exist before the archive is sealed.
    runTypeScriptScript(spriteMapScript);
    runTypeScriptScript(coreUnitAssetsScript);
    const assetsManifest = writeRepositoryAssetsManifest(path.join(root, 'public'));
    console.log(`[Assets] Generated one manifest for ${Object.keys(assetsManifest).length} deployed assets.`);
    console.log('[Assets] All asset generation complete.');
  } catch (err) {
    console.error('[Assets] Error:', err);
    process.exit(1);
  }
}

main();
