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
    console.log(entity.equipment());
    // console.log(entity.criticalSlotGrid());
  }
}

main();
