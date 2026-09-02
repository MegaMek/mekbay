/**
 * Single Unit Loader Script
 *
 * Loads the equipment database and parses a single .mtf / .blk file,
 * then reports the resulting entity data.
 *
 * Usage:
 *   npx tsx scripts/load-single-unit.ts [--input PATH]
 *
 * Options:
 *   --input  PATH   Path to the unit file (default: detected mm-data King Crab KGC-0000)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'node:util';
import type { RawEquipmentData } from '../src/app/models/equipment.model';
import type { BaseEntity } from '../src/app/models/entity/base-entity';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { getMekLocationLabel } from '../src/app/models/entity/types/mek';
import type { MekLocation } from '../src/app/models/entity/types/locations';
import type { EntityMountedEquipment } from '../src/app/models/entity/types';
import { AeroEntity } from '../src/app/models/entity/entities/aero/aero-entity';
import { SmallCraftEntity } from '../src/app/models/entity/entities/aero/small-craft-entity';
import { JumpShipEntity } from '../src/app/models/entity/entities/largecraft/jumpship-entity';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';
import { StaticEmplacementEntity } from '../src/app/models/entity/entities/misc/static-emplacement-entity';
import {
  getMotiveModeLabel,
  motiveModeFactsForEntity,
} from '../src/app/models/motiveModes.model';
import { buildEquipmentRegistry } from '../src/app/services/catalogs/equipment-catalog-builder';
import {
  mekCriticalCaseLabel,
  mekCriticalSlotLabel,
} from '../src/app/utils/mek-critical-display.util';
import {
  mekCriticalLocationMatrix,
  mekCriticalTableRowCount,
} from '../src/app/utils/mek-location-layout.util';
import { recordSheetAmmoName } from '../src/app/utils/record-sheet-ammo.util';
import { loadQuirkResolver } from './quirk-fixture';
import { resolveMmDataRoot } from './lib/script-paths';
import { formatBattleValueDetails, formatCostReport, formatDiagnosticNumber } from './lib/formatter';

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

function resolveInputFile(): string {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
    },
  });
  if (values.input) return path.resolve(values.input);

  const projectRoot = path.resolve(__dirname, '..');
  return path.join(
    resolveMmDataRoot(projectRoot),
    'data',
    'mekfiles',
    'meks',
    '3039u',
    'King Crab KGC-0000.mtf',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

function loadEquipmentRegistry() {
  const catalogPath = path.join(__dirname, 'fixtures', 'equipment2.json');
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Equipment file not found: ${catalogPath}. Copy equipment2.json into scripts/fixtures/.`);
  }

  const raw: RawEquipmentData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const registry = buildEquipmentRegistry(raw);
  console.log(`Equipment DB: ${registry.size} loaded, ${registry.lookupKeyCount} lookup keys`);
  return registry;
}

function printSection(title: string, width = 104): void {
  console.log(`\n${'═'.repeat(width)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(width));
}

function formatEntityLocation(entity: BaseEntity, location: string): string {
  const label = entity.componentLocationLabel(location);
  return label === location ? location : `${label} (${location})`;
}

function formatMovementRate(base: number, maximum: number): string {
  return base === maximum ? String(base) : `${base} (max ${maximum})`;
}

function formatMovement(entity: BaseEntity): string {
  const facts = motiveModeFactsForEntity(entity);
  const allZero = facts.walk === 0 && facts.run === 0 && facts.jump === 0 && facts.umu === 0;
  if (allZero && entity.motiveType() === 'None') return '<none>';
  return [
    `${getMotiveModeLabel('walk', facts)} ${formatMovementRate(facts.walk, facts.walk2)}`,
    `${getMotiveModeLabel('run', facts)} ${formatMovementRate(facts.run, facts.run2)}`,
    `Jump ${formatMovementRate(facts.jump, entity.maxJumpMP())}`,
    `UMU ${facts.umu}`,
  ].join(', ');
}

function mountedEquipmentLabel(mount: EntityMountedEquipment): string {
  const shots = mount.getAmmoShots();
  return shots === undefined
    ? mount.displayName()
    : `Ammo (${recordSheetAmmoName(mount.displayName())})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main(): void {
  const inputFile = resolveInputFile();
  if (!fs.existsSync(inputFile)) throw new Error(`Unit file not found: ${inputFile}`);

  console.log(`Loading unit: ${inputFile}\n`);

  const equipmentRegistry = loadEquipmentRegistry();
  const quirkResolver = loadQuirkResolver();

  const fileName = path.basename(inputFile);
  const content = fs.readFileSync(inputFile, 'utf-8');

  const { entity, diagnostics } = parseEntity(content, fileName, equipmentRegistry, { quirkResolver });
  if (diagnostics.length > 0) {
    printSection(`LOAD DIAGNOSTICS (${diagnostics.length})`);
    for (const issue of diagnostics) {
      console.log(`  ${issue.severity.toUpperCase()} ${issue.code} [${issue.field}]: ${issue.message}`);
    }
    if (diagnostics.some(issue => issue.severity === 'error')) process.exitCode = 1;
  }

  printSection(`UNIT SUMMARY: ${entity.displayName()}`);
  console.log(`  Entity type:       ${entity.entityType}`);
  console.log(`  Unit type:         ${entity.unitType()}`);
  console.log(`  Unit subtype:      ${entity.unitSubtype()}`);
  console.log(`  UUID:              ${entity.uuid()}`);
  console.log(`  MUL ID:            ${entity.mulId() >= 0 ? entity.mulId() : '<none>'}`);
  const originalYear = entity.originalBuildYear();
  console.log(
    `  Year:              ${entity.year()}${originalYear > 0 ? ` (original: ${originalYear})` : ''}`,
  );
  console.log(`  Tech:              ${entity.techBase()}${entity.mixedTech() ? ' mixed' : ''}, rules level ${entity.rulesLevel()}`);
  console.log(`  Tech rating:       ${entity.techRating()}`);
  console.log(`  Weight class:      ${entity.weightClass()}`);
  console.log(`  Tonnage:           ${formatDiagnosticNumber(entity.tonnage())}`);
  if (!(entity instanceof StaticEmplacementEntity)) {
    console.log(`  Loadout tonnage:   ${formatDiagnosticNumber(entity.loadoutTonnage())}`);
  }
  console.log(`  Motive type:       ${entity.motiveType()}`);
  console.log(`  Movement:          ${formatMovement(entity)}`);
  const engine = entity.mountedEngine();
  if (engine.installed && !(entity instanceof SmallCraftEntity) && !(entity instanceof JumpShipEntity)) {
    console.log(`  Engine:            ${engine.type()}, rating ${engine.rating}, ${engine.techBase}`);
  }
  console.log(`  Armor points:      ${entity.totalArmorPoints()}`);
  console.log(`  Internal points:   ${entity.totalInternalPoints()}`);
  console.log(`  Military:          ${entity.isMilitary()}`);
  console.log(`  Role:              ${entity.role() || '<none>'}`);
  console.log(`  Canon:             ${entity.canon()}`);
  console.log(`  Source:            ${entity.source().map(source => source.abbrev).join(', ') || '<none>'}`);
  console.log(`  Published:         ${entity.published().map(source => source.abbrev).join(', ') || '<none>'}`);
  console.log(
    `  Quirks:            ${entity.quirks().map(({ quirk, value }) =>
      `${quirk.name}${value === undefined ? '' : ` (${value})`}`).join(', ') || '<none>'}`,
  );
  console.log(
    `  Weapon quirks:     ${entity.weaponQuirks().map(quirk =>
      `${quirk.name} (${quirk.weaponName}, ${formatEntityLocation(entity, quirk.location)}, slot ${quirk.slot})`
    ).join(', ') || '<none>'}`,
  );
  console.log(`  Implicit systems:  ${entity.implicitSystemEquipment().map(equipment => equipment.name).join(', ') || '<none>'}`);
  console.log(
    `  Auto Clan CASE:    ${[...entity.automaticClanCaseLocations()]
      .map(location => formatEntityLocation(entity, location)).join(', ') || '<none>'}`,
  );
  console.log(
    `  Implicit CASE cost: ${[...entity.implicitClanCaseLocations()]
      .map(location => formatEntityLocation(entity, location)).join(', ') || '<none>'}`,
  );

  if (entity instanceof AeroEntity) {
    console.log('\n  Aerospace construction:');
    console.log(`    fuel=${entity.fuel()} heatSinks=${entity.heatSinkCount()} sinkType=${entity.heatSinkType()}`);
    console.log(`    SI=${entity.structuralIntegrity()} cockpit=${entity.cockpitType()}`);
  }
  if (entity instanceof SmallCraftEntity) {
    console.log(`    design=${entity.designType()}`);
    console.log(`    crew=${entity.crew()} officers=${entity.officers()} gunners=${entity.gunners()} passengers=${entity.passengers()}`);
    console.log(`    marines=${entity.marines()} battleArmor=${entity.battleArmor()} otherPassengers=${entity.otherPassenger()}`);
    console.log(`    lifeBoats=${entity.lifeboats()} escapePods=${entity.escapePods()}`);
  }
  if (entity.armorValues().size > 0) {
    console.log('\n  Armor by location:');
    for (const [location, armor] of entity.armorValues()) {
      const mountedArmor = entity.armorByLocation().get(location);
      console.log(
        `    ${formatEntityLocation(entity, location).padEnd(24)} front=${armor.front} rear=${armor.rear} type=${mountedArmor?.armor.name ?? '<none>'}`,
      );
    }
  }

  if (entity.structureByLocation().size > 0) {
    console.log('\n  Structure by location:');
    for (const [location, structure] of entity.structureByLocation()) {
      console.log(
        `    ${formatEntityLocation(entity, location).padEnd(24)} type=${structure.structure.name} basisTonnage=${formatDiagnosticNumber(structure.tonnage)}`,
      );
    }
  }

  printSection(`MOUNTED EQUIPMENT (${entity.equipment().length})`);
  for (const mount of entity.equipment()) {
    const occupiedLocations = mount.getOccupiedLocations();
    const flags = [
      mount.rearMounted ? 'rear' : '',
      mount.turretType ? `${mount.turretType}-turret` : mount.turretMounted ? 'turret' : '',
      mount.omniPodMounted ? 'omnipod' : '',
      mount.armored ? 'armored' : '',
      mount.isSplitAcrossLocations ? 'split' : '',
      mount.isDWP ? 'dwp' : '',
      mount.isSSWM ? 'sswm' : '',
      mount.isAPM ? 'apm' : '',
    ].filter(Boolean);
    const cost = mount.getCost(entity);
    const bv = mount.getBV(entity);
    const tonnage = mount.getTonnage(entity);
    const shots = mount.getAmmoShots();
    const linked = entity.getLinkedMount(mount)?.mountId;
    const linking = entity.getLinkingMount(mount)?.mountId;
    const attributes = [
      `type=${mount.equipment?.type ?? '<unresolved>'}`,
      `location=${formatEntityLocation(entity, mount.location)}`,
      ...(mount.isSplitAcrossLocations
        ? [`occupied=[${occupiedLocations.map(location => formatEntityLocation(entity, location)).join(', ')}]`]
        : []),
      ...(mount.size === undefined ? [] : [`size=${formatDiagnosticNumber(mount.size)}`]),
      ...(shots === undefined ? [] : [`shots=${formatDiagnosticNumber(shots)}`]),
      `tonnage=${tonnage === undefined ? '<unresolved>' : formatDiagnosticNumber(tonnage)}`,
      ...(mount.facing === undefined ? [] : [`facing=${mount.facing}`]),
      ...(mount.baMountLocation === undefined ? [] : [`baMount=${mount.baMountLocation}`]),
      ...(flags.length > 0 ? [`flags=${flags.join(',')}`] : []),
    ];
    console.log(`  ${mount.mountId}: ${mountedEquipmentLabel(mount)}`);
    console.log(`    ${attributes.join(' ')}`);
    console.log(`    cost=${cost === undefined ? '<variable/unresolved>' : formatDiagnosticNumber(cost)} BV=${formatDiagnosticNumber(bv)}`);
    if (linked || linking) console.log(`    linked=${linked ?? '-'} linking=${linking ?? '-'}`);
    if (entity instanceof MekEntity) {
      const placements = mount.placements?.map(placement =>
        `${placement.location}:${placement.slotIndex}`) ?? [mount.location];
      console.log(
        `    placements(0-based)=[${placements.join(', ')}] crits=${mount.getNumCriticalSlots(entity) ?? '-'}`,
      );
    }
  }

  printSection(`TRANSPORTERS (${entity.transporters().length})`);
  if (entity.transporters().length === 0) console.log('  <none>');
  for (const transporter of entity.transporters()) {
    console.log(`  ${JSON.stringify(transporter)}`);
  }

  printSection('COST DETAILS');
  for (const line of formatCostReport(entity.costDetails())) console.log(`  ${line}`);

  if (entity instanceof StaticEmplacementEntity) {
    printSection('BV DETAILS — unavailable');
    console.log('  Battle Value is not calculated for static catalog entities.');
  } else {
    printSection(`BV DETAILS — ${formatDiagnosticNumber(entity.battleValue())}`);
    for (const line of formatBattleValueDetails(entity.battleValueDetails())) console.log(`  ${line}`);
  }

  if (entity instanceof MekEntity) {
    const mek = entity;
    const grid = mek.criticalSlotGrid();
    const layout = mekCriticalLocationMatrix(mek.chassisConfig);

    function slotLabel(loc: MekLocation | null, i: number): string {
      if (loc === null) return '';
      if (i >= mekCriticalTableRowCount(loc)) return '';
      const slots = grid.get(loc);
      if (!slots || i >= slots.length) return '';
      const s = slots[i];
      const label = mekCriticalSlotLabel(s, mek);
      const flags = [s.armored ? '(A)' : '', s.omniPod ? '(O)' : ''].filter(Boolean).join('');
      const slotNumber = mekCriticalTableRowCount(loc) === 12 ? i % 6 + 1 : i + 1;
      return `${String(slotNumber).padStart(2)}. ${label}${flags ? ' ' + flags : ''}`;
    }

    function pad(s: string, w: number): string {
      return s + ' '.repeat(Math.max(0, w - s.length));
    }

    function slotCount(loc: MekLocation | null): number {
      return loc === null ? 0 : mekCriticalTableRowCount(loc);
    }

    function locationName(loc: MekLocation | null): string {
      if (loc === null) return '';
      const label = getMekLocationLabel(loc) ?? mek.componentLocationLabel(loc);
      const caseLabel = mekCriticalCaseLabel(mek, loc);
      return `${label}${caseLabel ? ` (${caseLabel})` : ''}`;
    }

    const criticalLocations: MekLocation[] = [];
    for (const row of layout) {
      for (const location of row) {
        if (location !== null && !criticalLocations.includes(location)) criticalLocations.push(location);
      }
    }
    const COL_W = Math.max(
      32,
      ...criticalLocations.map(location => locationName(location).length),
      ...criticalLocations.flatMap(location => Array.from(
        { length: mekCriticalTableRowCount(location) },
        (_, index) => slotLabel(location, index).length,
      )),
    );

    printSection('CRITICAL TABLE', COL_W * 3 + 8);

    for (const [left, center, right] of layout) {
      const maxSlots = Math.max(
        slotCount(left),
        slotCount(center),
        slotCount(right),
      );
      // Headers
      console.log(
        `  ${pad(locationName(left), COL_W)}  ${pad(locationName(center), COL_W)}  ${locationName(right)}`
      );
      console.log(
        `  ${'─'.repeat(COL_W)}  ${'─'.repeat(COL_W)}  ${'─'.repeat(COL_W)}`
      );
      // Slots
      for (let i = 0; i < maxSlots; i++) {
        const l = slotLabel(left, i);
        const c = slotLabel(center, i);
        const r = slotLabel(right, i);
        console.log(`  ${pad(l, COL_W)}  ${pad(c, COL_W)}  ${r}`);
      }
      console.log('');
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
