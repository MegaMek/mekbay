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
 *   --input  PATH   Path to the unit file (default: C:\Projects\megamek\svgexport\unitfiles\meks\3039u\King Crab KGC-0000.mtf)
 */

import * as fs from 'fs';
import * as path from 'path';
import { createEquipment, buildEquipmentAliasMap, type EquipmentMap, type RawEquipmentData } from '../src/app/models/equipment.model';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { resetMountIdCounter } from '../src/app/models/entity/utils/signal-helpers';
import { MekEntity } from '../src/app/models/entity/entities/mek/mek-entity';

// ═══════════════════════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const INPUT_FILE = path.resolve(
  getArg('input', String.raw`C:\Projects\megamek\svgexport\unitfiles\meks\3039u\King Crab KGC-0000.mtf`)
);

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

  const aliasMap = buildEquipmentAliasMap(equipmentDb);
  console.log(`Equipment DB: ${loaded} loaded, ${failed} failed, ${aliasMap.size} aliases`);
  return { equipmentDb, aliasMap };
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

  const { equipmentDb, aliasMap } = loadEquipmentDb();

  const fileName = path.basename(INPUT_FILE);
  const content = fs.readFileSync(INPUT_FILE, 'utf-8');

  resetMountIdCounter();
  const { entity } = parseEntity(content, fileName, equipmentDb, null, aliasMap);
  if (entity instanceof MekEntity) {
    console.log(`\nParsed Mek: ${entity.displayName()}`);
    console.log(`Weight Class: ${entity.weightClass()}`);
    console.log(`\nEquipment:`);
    for (const m of entity.equipment()) {
      const locs = m.placements?.map(p => `${p.location}:${p.slotIndex}`) ?? [m.location];
      console.log(`  ${m.equipmentId}`);
      console.log(`    locations: [${locs.join(', ')}]  crits: ${m.criticalSlots ?? '-'}`);
      if (m.rearMounted) console.log(`    rear-mounted`);
      if (m.omniPodMounted) console.log(`    omnipod`);
      if (m.armored) console.log(`    armored`);
      if (m.isSplit) console.log(`    split`);
      if (m.size != null) console.log(`    size: ${m.size}`);
    }
    // ── Critical Slot Grid (3-column layout) ──
    const grid = entity.criticalSlotGrid();
    const equip = entity.equipment();
    const mountIndex = new Map(equip.map(m => [m.mountId, m]));

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
        const mount = mountIndex.get(s.mountId!);
        label = mount?.equipmentId ?? `[${s.mountId}]`;
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
