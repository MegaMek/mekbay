/**
 * Scan equipment2.json for tech base / advancement inconsistencies.
 *
 * Reports three categories of issues:
 *
 * 1. tech.base == "All" but advancement doesn't have BOTH "is" and "clan" entries
 * 2. tech.base == "Clan" but advancement has an "is" entry OR is missing a "clan" entry
 * 3. tech.base == "IS" but advancement is missing an "is" entry OR has a "clan" entry
 *
 * Usage:  npx tsx scripts/check-tech-base-consistency.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface Advancement {
  is?: Record<string, string>;
  clan?: Record<string, string>;
}

interface Tech {
  base?: string;
  advancement?: Advancement;
  [key: string]: unknown;
}

interface EquipmentEntry {
  tech?: Tech;
  [key: string]: unknown;
}

interface EquipmentFile {
  equipment: Record<string, EquipmentEntry>;
}

// ── Load ────────────────────────────────────────────────────────────────────
const filePath = path.resolve(__dirname, 'fixtures', 'equipment2.json');
const raw = fs.readFileSync(filePath, 'utf-8');
const data: EquipmentFile = JSON.parse(raw);

const entries = Object.entries(data.equipment);

// ── Buckets ─────────────────────────────────────────────────────────────────
interface Issue {
  name: string;
  base: string;
  hasIS: boolean;
  hasClan: boolean;
  reason: string;
}

const issues: { all: Issue[]; clan: Issue[]; is: Issue[] } = {
  all: [],
  clan: [],
  is: [],
};

for (const [name, entry] of entries) {
  const tech = entry.tech;
  if (!tech) continue;

  const base = tech.base;
  const adv = tech.advancement ?? {};
  const hasIS = 'is' in adv;
  const hasClan = 'clan' in adv;

  if (base === 'All') {
    if (!hasIS || !hasClan) {
      const missing: string[] = [];
      if (!hasIS) missing.push('is');
      if (!hasClan) missing.push('clan');
      issues.all.push({
        name,
        base,
        hasIS,
        hasClan,
        reason: `base=All but missing advancement: ${missing.join(', ')}`,
      });
    }
  } else if (base === 'Clan') {
    if (hasIS || !hasClan) {
      const reasons: string[] = [];
      if (hasIS) reasons.push('has "is" advancement');
      if (!hasClan) reasons.push('missing "clan" advancement');
      issues.clan.push({
        name,
        base,
        hasIS,
        hasClan,
        reason: `base=Clan but ${reasons.join(' AND ')}`,
      });
    }
  } else if (base === 'IS') {
    if (!hasIS || hasClan) {
      const reasons: string[] = [];
      if (!hasIS) reasons.push('missing "is" advancement');
      if (hasClan) reasons.push('has "clan" advancement');
      issues.is.push({
        name,
        base,
        hasIS,
        hasClan,
        reason: `base=IS but ${reasons.join(' AND ')}`,
      });
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
function printSection(title: string, list: Issue[]) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${title}  (${list.length} issues)`);
  console.log('='.repeat(70));
  if (list.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const item of list) {
    console.log(`  [${item.base}] ${item.name}`);
    console.log(`         ↳ ${item.reason}`);
  }
}

printSection('base="All" missing IS or Clan advancement', issues.all);
printSection('base="Clan" with IS advancement or missing Clan advancement', issues.clan);
printSection('base="IS" missing IS advancement or has Clan advancement', issues.is);

const total = issues.all.length + issues.clan.length + issues.is.length;
console.log(`\n${'-'.repeat(70)}`);
console.log(`Total issues: ${total}  (All: ${issues.all.length}, Clan: ${issues.clan.length}, IS: ${issues.is.length})`);
console.log(`Total equipment scanned: ${entries.length}`);
