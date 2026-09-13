// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
/** Export actual production parsers/verifiers/calculators, with the same immutable inputs as Java. */
import '@angular/compiler';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildEquipmentRegistry } from '../src/app/services/catalogs/equipment-catalog-builder';
import type { Quirk } from '../src/app/models/quirks.model';
import type { Sourcebook } from '../src/app/models/sourcebook.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';
import type { BaseEntity } from '../src/app/models/entity/base-entity';
import { validateConstruction } from '../src/app/construction/domain/construction-rules';
import { calculateBattleValueDetails } from '../src/app/models/entity/utils/battle-value/factory';
import { calculateEntityWeightBreakdown } from '../src/app/models/entity/utils/weight/entity-weight';
import { calculateEntityCostDetails } from '../src/app/models/entity/utils/cost/entity-cost';
import { collectFields, errorDetails, readManifest, readVerifiedCorpus, readVerifiedInput, sha256 } from './lib/unit-verification-io';

function rawGraph(entity: BaseEntity) {
  const mounts = entity.equipment();
  const index = (mount: typeof mounts[number] | undefined) => mount ? mounts.indexOf(mount) : null;
  const grid = entity instanceof MekEntity ? entity.criticalSlotGrid() : null;
  return {
    locationOrder: [...entity.locationOrder],
    locations: entity.locationOrder.map((location, locationIndex) => ({
      index: locationIndex, abbreviation: location, label: entity.componentLocationLabel(location),
      armor: entity.armorValues().get(location) ?? null, internal: entity.structureValues().get(location) ?? null,
      criticalSlots: grid?.get(location as never)?.map((slot, slotIndex) => ({
        index: slotIndex, type: slot.type, armored: slot.armored,
        ...(slot.type === 'system' ? { system: slot.systemType } : {}),
        ...(slot.type === 'equipment' ? { equipmentIndices: slot.mounts.map(index) } : {}),
      })) ?? null,
    })),
    equipment: mounts.map((mount, equipmentIndex) => ({
      index: equipmentIndex, internalName: mount.equipment?.id ?? null, originalId: mount.equipmentId,
      isMachineGunArray: mount.equipment?.hasFlag('F_MGA') ?? false,
      allocation: mount.allocation, location: mount.location, size: mount.size ?? null,
      shots: mount.getAmmoShots(), rearMounted: mount.rearMounted, turretMounted: mount.turretMounted,
      turretType: mount.turretType, armored: mount.armored, omniPodMounted: mount.omniPodMounted,
      facing: mount.facing, baMountLocation: mount.baMountLocation,
      linkedIndex: index(entity.getLinkedMount(mount)), linkedByIndex: index(entity.getLinkingMount(mount)),
    })),
    transporters: entity.transporters(),
    bays: entity.equipmentBays().map(bay => ({ kind: bay.kind, controllerIndex: index(bay.controller),
      equipmentIndices: bay.mounts.map(index), weaponIndices: bay.weapons.map(index), ammoIndices: bay.ammo.map(index) })),
  };
}

function optionalNumber(entity: BaseEntity, method: string): number | null {
  const accessor = (entity as any)[method];
  return typeof accessor === 'function' ? accessor.call(entity) : null;
}

async function main() {
  const { values } = parseArgs({ options: { corpus: { type: 'string' }, output: { type: 'string' }, limit: { type: 'string' } } });
  if (!values.corpus || !values.output) throw new Error('Required: --corpus <frozen directory> --output <JSONL>');
  const corpus = path.resolve(values.corpus);
  const info = readVerifiedCorpus(corpus);
  const inputs = readManifest(path.join(corpus, 'manifest.jsonl'));
  const limit = values.limit === undefined ? inputs.length : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const load = (file: string) => JSON.parse(readFileSync(path.join(corpus, 'dependencies', file), 'utf8'));
  const registry = buildEquipmentRegistry(load('equipment.json'));
  const quirks = new Map((load('quirks.json').quirks as Quirk[]).map(quirk => [quirk.key, quirk]));
  const sourcebooks = new Map((load('sourcebooks.json') as Sourcebook[]).map(book => [book.abbrev, book]));
  const git = (args: string[]) => execFileSync('git', args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const sourceFiles = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src', 'scripts'])
    .trim().split('\n').filter(file => /\.(ts|json|mjs|cjs)$/u.test(file)))].sort();
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha256(readFileSync(file))]));
  const provenance = {
    exporter: 'MekBay production parseEntity + validateConstruction', createdAt: new Date().toISOString(),
    gitRevision: git(['rev-parse', 'HEAD']).trim(),
    workingDiffSha256: sha256(git(['diff', 'HEAD', '--', 'src', 'scripts'])),
    sourceTreeSha256: sha256(JSON.stringify(sourceHashes)), sourceHashes,
    manifestSha256: info.manifestSha256, dependencyHashes: info.dependencies,
    scope: 'MTF/BLK only; Assets excluded', requestedRows: Math.min(limit, inputs.length), totalManifestRows: inputs.length,
    constructionRuleset: 'shared native construction; validateConstruction has no Core/TW selector',
    bvRulesets: { bv: 'total-warfare', bvCore2026: 'core-2026' },
    canonSource: 'production Sourcebook.canon, independent of native OfficialUnitList.txt',
  };
  const output = path.resolve(values.output);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, '');
  writeFileSync(`${output}.provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
  const counts: Record<string, number> = {};
  for (const [i, input] of inputs.slice(0, limit).entries()) {
    const row: Record<string, any> = { schemaVersion: 1, ...input,
      provenance: { manifestSha256: info.manifestSha256, file: path.basename(`${output}.provenance.json`) } };
    let bytes: Buffer;
    try { bytes = readVerifiedInput(path.join(corpus, 'data/mekfiles'), input); }
    catch (error) {
      row.parse = { status: 'input-error', error: errorDetails(error) };
      appendFileSync(output, JSON.stringify(row) + '\n');
      counts['input-error'] = (counts['input-error'] ?? 0) + 1;
      continue;
    }
    try {
      const { entity, diagnostics } = parseEntity(bytes.toString('utf8'), path.basename(input.relativePath), registry, {
        quirkResolver: key => quirks.get(key), sourcebookResolver: key => sourcebooks.get(key),
      });
      row.parse = { status: 'ok', diagnostics, parsedUnitUuid: entity.uuid() };
      row.identity = collectFields({ class: () => entity.constructor.name, entityType: () => entity.entityType,
        chassis: () => entity.chassis(), fullChassis: () => entity.fullChassis(), model: () => entity.model(), year: () => entity.year(),
        techBase: () => entity.techBase(), mixedTech: () => entity.mixedTech(), techLevel: () => entity.staticTechLevel() });
      row.flags = collectFields({ canon: () => entity.canon(), manualBV: () => entity.manualBV(), tracksHeat: () => entity.tracksHeat() });
      const phase = collectFields({ verification: () => validateConstruction(entity), graph: () => rawGraph(entity) });
      row.mekbay = phase.errors.verification
        ? { supported: true, valid: null, messages: null, error: phase.errors.verification }
        : { supported: true, ...phase.verification, error: null };
      row.graph = phase.graph;
      row.graphError = phase.errors.graph ?? null;
      const breakdowns = collectFields({ bvTW: () => calculateBattleValueDetails(entity, undefined, 'total-warfare'),
        bvCore2026: () => calculateBattleValueDetails(entity, undefined, 'core-2026'),
        weight: () => calculateEntityWeightBreakdown(entity), cost: () => entity.costDetails(),
        costWithoutAmmo: () => calculateEntityCostDetails(entity, { ignoreAmmo: true }) });
      row.calculated = collectFields({ weight: () => entity.tonnage(), loadoutTonnage: () => entity.loadoutTonnage(),
        bv: () => { if (breakdowns.errors.bvTW) throw new Error(breakdowns.errors.bvTW.message); return breakdowns.bvTW.base; },
        bvCore2026: () => { if (breakdowns.errors.bvCore2026) throw new Error(breakdowns.errors.bvCore2026.message); return breakdowns.bvCore2026.base; },
        cost: () => entity.cost(), printedCostWithoutAmmo: () => {
          if (breakdowns.errors.costWithoutAmmo) throw new Error(breakdowns.errors.costWithoutAmmo.message);
          return breakdowns.costWithoutAmmo.total;
        },
        armor: () => entity.totalArmorPoints(), internal: () => entity.totalInternalPoints(),
        walkMP: () => entity.walkMP(), runMP: () => entity.runMP(), jumpMP: () => entity.jumpMP(),
        maxWalkMP: () => entity.maxWalkMP(), maxRunMP: () => entity.maxRunMP(), maxJumpMP: () => entity.maxJumpMP(),
        heatCapacity: () => entity.heatCapacity(), heatGeneration: () => entity.heatGeneration(),
        heatSinks: () => optionalNumber(entity, 'heatSinkCount'), si: () => optionalNumber(entity, 'structuralIntegrity') });
      row.breakdowns = breakdowns;
    } catch (error) {
      row.parse = { status: /Unsupported.*(UnitType|file format)|cannot be encoded as/iu.test(errorDetails(error).message)
        ? 'unsupported' : 'error', error: errorDetails(error) };
    }
    counts[row.parse.status] = (counts[row.parse.status] ?? 0) + 1;
    appendFileSync(output, JSON.stringify(row) + '\n');
    if ((i + 1) % 500 === 0) console.log(`${i + 1}/${Math.min(inputs.length, limit)} ${JSON.stringify(counts)}`);
  }
  console.log(JSON.stringify({ output, counts }));
  if (counts['input-error']) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
