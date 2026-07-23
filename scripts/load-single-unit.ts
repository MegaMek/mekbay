/**
 * Single Unit Loader Script
 *
 * Loads the equipment database and parses a single .mtf / .blk file,
 * then outputs the resulting entity object.
 *
 * Usage:
 *   npx tsx scripts/load-single-unit.ts [--input PATH]
 *
 * Options:
 *   --input  PATH   Path to the unit file (default: ..\..\mm-data\data\mekfiles\meks\3039u\King Crab KGC-0000.mtf)
 */

import * as fs from 'fs';
import * as path from 'path';
import { EquipmentRegistry } from '../src/app/models/equipment-lookup';
import { createEquipment, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { AeroEntity } from '../src/app/models/entity/entities/aero/aero-entity';
import { SmallCraftEntity } from '../src/app/models/entity/entities/aero/small-craft-entity';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';
import { loadQuirkResolver } from './quirk-fixture';
import { formatBattleValueDetails, formatCostReport, formatDiagnosticNumber } from './unit-diagnostics';
import { calculateMekWeightBreakdown } from '../src/app/models/entity/utils/weight/mek-weight';
import { ProtoMekEntity } from '../src/app/models/entity/entities/protomek/protomek-entity';
import { calculateProtoMekWeightBreakdown } from '../src/app/models/entity/utils/weight/protomek-weight';
import { VehicleEntity } from '../src/app/models/entity/entities/vehicle/vehicle-entity';
import { calculateVehicleWeightBreakdown } from '../src/app/models/entity/utils/weight/vehicle-weight';
import { calculateSupportVehicleWeightBreakdown } from '../src/app/models/entity/utils/weight/support-vehicle-weight';
import { calculateFighterWeightBreakdown } from '../src/app/models/entity/utils/weight/fighter-weight';

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const INPUT_FILE = path.resolve(
  getArg('input', String.raw`..\..\mm-data\data\mekfiles\meks\3039u\King Crab KGC-0000.mtf`)
);
const quirkResolver = loadQuirkResolver();

// ═══════════════════════════════════════════════════════════════════════════
// Equipment database loading
// ═══════════════════════════════════════════════════════════════════════════

function loadEquipmentDb() {
  const fixturesPath = path.join(__dirname, 'fixtures', 'equipment2.json');
  if (!fs.existsSync(fixturesPath)) {
    console.error(`Equipment file not found: ${fixturesPath}`);
    console.error('Copy equipment2.json into scripts/fixtures/');
    process.exit(1);
  }

  const raw: RawEquipmentData = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));
  const equipmentDb: EquipmentMap = {};
  let loaded = 0;
  let failed = 0;

  for (const [internalName, rawEquipment] of Object.entries(raw.equipment)) {
    try {
      equipmentDb[internalName] = createEquipment(rawEquipment);
      loaded++;
    } catch {
      failed++;
    }
  }

  const registry = new EquipmentRegistry(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${registry.lookupKeyCount} lookup keys`);
  return registry;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Unit file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log(`Loading unit: ${INPUT_FILE}\n`);

  const equipmentRegistry = loadEquipmentDb();

  const fileName = path.basename(INPUT_FILE);
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');

  const { entity } = parseEntity(content, fileName, equipmentRegistry, { quirkResolver });
  const displayName = [entity.chassis(), entity.model()].filter(Boolean).join(' ');

  console.log(`\n${'═'.repeat(104)}`);
  console.log(`  UNIT SUMMARY: ${displayName}`);
  console.log('═'.repeat(104));
  console.log(`  Entity type:       ${entity.entityType}`);
  console.log(`  Unit type:         ${entity.unitType()}`);
  console.log(`  Unit subtype:      ${entity.unitSubtype()}`);
  console.log(`  UUID:              ${entity.uuid()}`);
  console.log(`  MUL ID:            ${entity.mulId()}`);
  console.log(`  Year:              ${entity.year()} (original: ${entity.originalBuildYear()})`);
  console.log(`  Tech:              ${entity.techBase()}${entity.mixedTech() ? ' mixed' : ''}, rules level ${entity.rulesLevel()}`);
  console.log(`  Tech rating:       ${entity.techRating()}`);
  console.log(`  Tonnage:           ${formatDiagnosticNumber(entity.tonnage())}`);
  console.log(`  Motive type:       ${entity.motiveType()}`);
  console.log(`  Movement:          walk ${entity.originalWalkMP()}, run ${entity.maxRunMP()}, jump ${entity.jumpMP()}, UMU ${entity.umuMP()}`);
  console.log(`  Engine:            ${entity.mountedEngine().type()}, rating ${entity.mountedEngine().rating}, ${entity.mountedEngine().techBase}`);
  console.log(`  Armor points:      ${entity.totalArmorPoints()}`);
  console.log(`  Internal points:   ${entity.totalInternalPoints()}`);
  console.log(`  Military:          ${entity.isMilitary()}`);
  console.log(`  Source:            ${entity.source().map(source => source.abbrev).join(', ') || '<none>'}`);
  console.log(`  Implicit systems:  ${entity.implicitSystemEquipment().map(equipment => equipment.name).join(', ') || '<none>'}`);
  console.log(`  Auto Clan CASE:    ${[...entity.automaticClanCaseLocations()].join(', ') || '<none>'}`);
  console.log(`  Implicit CASE cost:${[...entity.implicitClanCaseLocations()].join(', ') || ' <none>'}`);

  if (entity instanceof AeroEntity) {
    console.log('\n  Aerospace construction:');
    console.log(`    fuel=${entity.fuel()} heatSinks=${entity.heatSinkCount()} sinkType=${entity.heatSinkType()}`);
    console.log(`    SI=${entity.structuralIntegrity()} cockpit=${entity.cockpitType()}`);
    if (entity.entityType === 'Aero' || entity.entityType === 'ConvFighter') {
      const weight = calculateFighterWeightBreakdown(entity);
      for (const [category, value] of Object.entries(weight)) {
        console.log(`    ${category.padEnd(20)} ${formatDiagnosticNumber(value)}`);
      }
    }
  }
  if (entity instanceof SmallCraftEntity) {
    console.log(`    design=${entity.designType()}`);
    console.log(`    crew=${entity.crew()} officers=${entity.officers()} gunners=${entity.gunners()} passengers=${entity.passengers()}`);
    console.log(`    marines=${entity.marines()} battleArmor=${entity.battleArmor()} otherPassengers=${entity.otherPassenger()}`);
    console.log(`    lifeBoats=${entity.lifeboats()} escapePods=${entity.escapePods()}`);
  }
  if (entity instanceof MekEntity) {
    const weight = calculateMekWeightBreakdown(entity);
    console.log('\n  Construction weight:');
    for (const [category, value] of Object.entries(weight)) {
      console.log(`    ${category.padEnd(20)} ${formatDiagnosticNumber(value)}`);
    }
  }
  if (entity instanceof ProtoMekEntity) {
    const weight = calculateProtoMekWeightBreakdown(entity);
    console.log('\n  Construction weight:');
    for (const [category, value] of Object.entries(weight)) {
      console.log(`    ${category.padEnd(20)} ${formatDiagnosticNumber(value)}`);
    }
  }
  if (entity instanceof VehicleEntity) {
    const weight = entity.isSupportVehicle()
      ? calculateSupportVehicleWeightBreakdown(entity)
      : calculateVehicleWeightBreakdown(entity);
    console.log('\n  Vehicle construction weight:');
    for (const [category, value] of Object.entries(weight)) {
      console.log(`    ${category.padEnd(20)} ${formatDiagnosticNumber(value)}`);
    }
  }

  console.log('\n  Armor by location:');
  for (const [location, armor] of entity.armorValues()) {
    const mountedArmor = entity.armorByLocation().get(location);
    console.log(`    ${location.padEnd(12)} front=${armor.front} rear=${armor.rear} type=${mountedArmor?.armor.id ?? '<none>'}`);
  }

  console.log('\n  Structure by location:');
  for (const [location, structure] of entity.structureByLocation()) {
    console.log(`    ${location.padEnd(12)} type=${structure.structure.id} tonnage=${formatDiagnosticNumber(structure.tonnage)}`);
  }

  console.log(`\n${'═'.repeat(104)}`);
  console.log(`  MOUNTED EQUIPMENT (${entity.equipment().length})`);
  console.log('═'.repeat(104));
  for (const mount of entity.equipment()) {
    const locations = mount.getOccupiedLocations().join(', ') || mount.location || 'Unallocated';
    const cost = mount.getCost(entity);
    const bv = mount.getBV(entity);
    const tonnage = mount.getTonnage(entity);
    const linked = entity.getLinkedMount(mount)?.mountId;
    const linking = entity.getLinkingMount(mount)?.mountId;
    console.log(`  ${mount.mountId}: ${mount.equipment?.name ?? mount.equipmentId}`);
    console.log(`    location=${locations} size=${mount.size ?? 1} tonnage=${tonnage === undefined ? '<unresolved>' : formatDiagnosticNumber(tonnage)} rear=${mount.rearMounted} omni=${mount.omniPodMounted}`);
    console.log(`    cost=${cost === undefined ? '<variable/unresolved>' : formatDiagnosticNumber(cost)} BV=${formatDiagnosticNumber(bv)}`);
    if (linked || linking) console.log(`    linked=${linked ?? '-'} linking=${linking ?? '-'}`);
    if (mount.secondEquipment) console.log(`    paired=${mount.secondEquipment.name}`);
  }

  console.log(`\n${'═'.repeat(104)}`);
  console.log(`  TRANSPORTERS (${entity.transporters().length})`);
  console.log('═'.repeat(104));
  if (entity.transporters().length === 0) console.log('  <none>');
  for (const transporter of entity.transporters()) {
    console.log(`  ${JSON.stringify(transporter)}`);
  }

  console.log(`\n${'═'.repeat(104)}`);
  console.log('  COST DETAILS');
  console.log('═'.repeat(104));
  for (const line of formatCostReport(entity.costDetails())) console.log(`  ${line}`);

  console.log(`\n${'═'.repeat(104)}`);
  console.log(`  BV DETAILS — ${formatDiagnosticNumber(entity.battleValue())}`);
  console.log('═'.repeat(104));
  for (const line of formatBattleValueDetails(entity.battleValueDetails())) console.log(`  ${line}`);

  if (entity instanceof MekEntity) {
    console.log(`\nParsed Mek: ${entity.displayName()}`);
    console.log(`Weight Class: ${entity.weightClass()}`);
    console.log(`\nEquipment:`);
    for (const m of entity.equipment()) {
      const locs = m.placements?.map(p => `${p.location}:${p.slotIndex}`) ?? [m.location];
      const criticalSlots = m.equipment?.getNumCriticalSlots(entity, m.size ?? 0);
      console.log(`  ${m.equipmentId}`);
      console.log(`    locations: [${locs.join(', ')}]  crits: ${criticalSlots ?? '-'}`);
      if (m.rearMounted) console.log(`    rear-mounted`);
      if (m.omniPodMounted) console.log(`    omnipod`);
      if (m.armored) console.log(`    armored`);
      if (m.isSplit) console.log(`    split`);
      if (m.size != null) console.log(`    size: ${m.size}`);
    }
    // ── Critical Slot Grid (3-column layout) ──
    const grid = entity.criticalSlotGrid();
    const LOC_NAMES: Record<string, string> = {
      HD: 'Head', LA: 'Left Arm', RA: 'Right Arm',
      LT: 'Left Torso', CT: 'Center Torso', RT: 'Right Torso',
      LL: 'Left Leg', RL: 'Right Leg', CL: 'Center Leg',
      FLL: 'Front Left Leg', FRL: 'Front Right Leg',
      RLL: 'Rear Left Leg', RRL: 'Rear Right Leg',
    };

    // Rows of 3 columns: [Left, Center, Right]
    const hasQuadLegs = grid.has('FLL');
    const hasCenterLeg = grid.has('CL');
    const LAYOUT: [string, string, string][] = [
      ...(hasQuadLegs
        ? [['FLL', 'HD', 'FRL'] as [string, string, string]]
        : [['LA', 'HD', 'RA'] as [string, string, string]]),
      ['LT', 'CT', 'RT'],
      ...(hasQuadLegs
        ? [['RLL', '', 'RRL'] as [string, string, string]]
        : hasCenterLeg
          ? [['LL', 'CL', 'RL'] as [string, string, string]]
          : [['LL', '', 'RL'] as [string, string, string]]),
    ];

    const COL_W = 32;

    function slotLabel(loc: string, i: number): string {
      const slots = grid.get(loc);
      if (!slots || i >= slots.length) return '';
      const s = slots[i];
      let label: string;
      if (s.type === 'empty') label = '-Empty-';
      else if (s.type === 'system') label = s.systemType ?? 'System';
      else {
        label = s.mount.equipmentId;
      }
      const flags = [s.armored ? '(A)' : '', s.omniPod ? '(O)' : ''].filter(Boolean).join('');
      return `${String(i + 1).padStart(2)}. ${label}${flags ? ' ' + flags : ''}`;
    }

    function pad(s: string, w: number): string {
      return s.length >= w ? s.substring(0, w) : s + ' '.repeat(w - s.length);
    }

    console.log(`\n${'═'.repeat(COL_W * 3 + 8)}`);
    console.log('  CRITICAL TABLE');
    console.log('═'.repeat(COL_W * 3 + 8));

    for (const [left, center, right] of LAYOUT) {
      const maxSlots = Math.max(
        grid.get(left)?.length ?? 0,
        grid.get(center)?.length ?? 0,
        grid.get(right)?.length ?? 0,
      );
      // Headers
      console.log(
        `  ${pad(LOC_NAMES[left] ?? '', COL_W)}  ${pad(LOC_NAMES[center] ?? '', COL_W)}  ${LOC_NAMES[right] ?? ''}`
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

main();
