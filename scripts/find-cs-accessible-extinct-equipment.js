/**
 * Finds equipment that is extinct in year 2900 for regular IS factions
 * but NOT for ComStar (Faction.CS), based on the isExtinct(year, clan, faction)
 * rules in ITechnology.
 *
 * The ComStar exception in isExtinct fires when:
 *   - The equipment is extinct for IS at the given year
 *   - The equipment has an IS reintroduction date (getReintroductionDate(false) != DATE_NONE)
 *
 * This means CS preserved Star League tech through the extinction gap only if
 * it was eventually recovered. Tech that was truly lost (no reintroduction date)
 * was lost even to ComStar.
 *
 * Additionally, the era availability must be < "X" (SLDF Royal equipment is excluded
 * by the isLegal() availability gate).
 *
 * For year 2900, the era is "SW" (Succession Wars: 2780-3049).
 *
 * Approximate dates use ~ prefix:
 *   - Extinction: actual = parsed + 5 (later)
 *   - Reintroduction/prototype/production/common: actual = parsed - 5 (earlier)
 */

const fs = require('fs');
const path = require('path');

const APPROXIMATE_MARGIN = 5;
const YEAR = 2900;

function parseDate(raw, isExtinction = false) {
  if (raw == null) return -1;
  const str = String(raw);
  const approximate = str.startsWith('~');
  const value = parseInt(str.replace('~', ''), 10);
  if (isNaN(value)) return -1;
  if (!approximate) return value;
  // Extinction dates move later when approximate; all others move earlier
  return isExtinction ? value + APPROXIMATE_MARGIN : value - APPROXIMATE_MARGIN;
}

function getIntroDate(adv) {
  // Introduction date is the earliest of prototype, production, common
  const proto = parseDate(adv?.prototype);
  const prod = parseDate(adv?.production);
  const common = parseDate(adv?.common);
  const candidates = [proto, prod, common].filter(d => d > 0);
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function isExtinctIS(adv, year) {
  const extinctDate = parseDate(adv?.extinct, true);
  const reintroDate = parseDate(adv?.reintroduced);
  if (extinctDate === -1) return false;
  if (extinctDate >= year) return false;
  if (reintroDate === -1) return true;
  return year < reintroDate; // still extinct if reintro hasn't happened yet
}

function getTechEra(year) {
  if (year < 2780) return 'sl';
  if (year < 3050) return 'sw';
  if (year < 3130) return 'clan';
  return 'da';
}

const jsonPath = path.join(__dirname, 'fixtures', 'equipment2.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const equipment = data.equipment;

const results = [];

for (const [id, equip] of Object.entries(equipment)) {
  const tech = equip.tech;
  if (!tech) continue;

  const isAdv = tech.advancement?.is;
  // Only IS or ALL-base tech can benefit from the CS exception
  if (!isAdv) continue;

  const introDate = getIntroDate(isAdv);
  if (introDate === -1 || introDate > YEAR) continue;

  if (!isExtinctIS(isAdv, YEAR)) continue;

  // ComStar bypass: CS only preserves tech that has a reintroduction date
  // (i.e., tech that was eventually recovered — CS kept it through the gap)
  const reintroDate = parseDate(isAdv.reintroduced);
  if (reintroDate === -1) {
    // No reintroduction date → truly lost, even to ComStar
    continue;
  }

  // Also check: availability for the era must be < X (SLDF Royal excluded)
  const era = getTechEra(YEAR);
  const availability = tech.availability?.[era];
  if (availability === 'X') {
    // SLDF Royal equipment — ComStar does NOT get access
    continue;
  }

  // This equipment is extinct at 2900 for regular IS, but CS preserved it
  const extinctDate = parseDate(isAdv.extinct, true);
  results.push({
    id,
    name: equip.name,
    base: tech.base,
    extinctDate,
    reintroDate: reintroDate === -1 ? 'none' : reintroDate,
    swAvailability: availability,
  });
}

// Sort by name
results.sort((a, b) => a.name.localeCompare(b.name));

console.log(`\nEquipment extinct at year ${YEAR} for IS but accessible to ComStar:`);
console.log(`Found ${results.length} items\n`);
console.log('ID'.padEnd(55), 'Extinct'.padEnd(10), 'Reintro'.padEnd(10), 'SW Avail');
console.log('-'.repeat(90));
for (const r of results) {
  console.log(
    r.id.padEnd(55),
    String(r.extinctDate).padEnd(10),
    String(r.reintroDate).padEnd(10),
    r.swAvailability
  );
}
