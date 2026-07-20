/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
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

import { EntityTechBase } from "./tech";

// ============================================================================
// Faction — mirrors megamek.common.enums.Faction
// ============================================================================

/** Faction affiliation category. */
export type FactionAffiliation = 'None' | EntityTechBase;

/**
 * Canonical faction codes.
 *
 * The `codeMM` value from the Java `Faction` enum — this is what appears in
 * MTF files (via `getCode()`) and is the primary serialization format.
 */
export type FactionCode =
  | 'None'
  // ── Inner Sphere ──
  | 'IS'    // Generic Inner Sphere
  | 'CC'    // Capellan Confederation
  | 'CF'    // Circinus Federation
  | 'CP'    // Calderon Defense Pact
  | 'CS'    // ComStar
  | 'DC'    // Draconis Combine
  | 'EI'    // Escorpión Imperio
  | 'FC'    // Federated Commonwealth
  | 'FR'    // Free Rasalhague Republic
  | 'FS'    // Federated Suns
  | 'FW'    // Free Worlds League
  | 'LC'    // Lyran Commonwealth / Lyran Alliance
  | 'MC'    // Magistracy of Canopus
  | 'MH'    // Marian Hegemony
  | 'OA'    // Outworlds Alliance
  | 'TA'    // Taurian Concordat (alt)
  | 'TC'    // Taurian Concordat
  | 'TH'    // Terran Hegemony
  | 'RD'    // Rasalhague Dominion
  | 'RS'    // Republic of the Sphere
  | 'RA'    // Republic / Rasalhague
  | 'RW'    // Rim Worlds Republic
  | 'WB'    // Word of Blake
  | 'Merc'  // Mercenary
  | 'Per'   // Periphery (generic)
  // ── Clan ──
  | 'Clan'  // Generic Clan
  | 'CBR'   // Clan Burrock
  | 'CBS'   // Clan Blood Spirit
  | 'CCY'   // Clan Coyote
  | 'CCC'   // Clan Cloud Cobra
  | 'CFM'   // Clan Fire Mandrill
  | 'CGB'   // Clan Ghost Bear
  | 'CGS'   // Clan Goliath Scorpion
  | 'CHH'   // Clan Hell's Horses
  | 'CIH'   // Clan Ice Hellion
  | 'CJF'   // Clan Jade Falcon
  | 'CMN'   // Clan Mongoose
  | 'CNC'   // Clan Nova Cat
  | 'CSF'   // Clan Sea Fox / Diamond Shark
  | 'CSJ'   // Clan Smoke Jaguar
  | 'CSR'   // Clan Snow Raven
  | 'CSV'   // Clan Steel Viper / Star Viper
  | 'CSA'   // Clan Star Adder
  | 'CWM'   // Clan Widowmaker
  | 'CWF'   // Clan Wolf
  | 'CWX'   // Clan Wolf-in-Exile
  | 'CWV';  // Clan Wolverine

/** Descriptor for a single faction entry. */
export interface FactionDescriptor {
  /** MegaMek code (codeMM) — used in MTF files. */
  readonly code: FactionCode;
  /** Interstellar Operations code (codeIO). */
  readonly codeIO: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Faction affiliation category. */
  readonly affiliation: FactionAffiliation;
}

/**
 * Complete faction data table
 *
 * Keyed by `FactionCode` (the MegaMek `codeMM` value).
 * Mirrors the Java `Faction` enum from `megamek.common.enums.Faction`.
 */
export const FACTION_DATA: Record<FactionCode, FactionDescriptor> = {
  'None': { code: 'None', codeIO: 'None',       name: 'None',                           affiliation: 'None' },
  // ── Inner Sphere ──
  'IS':   { code: 'IS',   codeIO: 'IS',         name: 'Inner Sphere',                   affiliation: 'IS' },
  'CC':   { code: 'CC',   codeIO: 'CC',         name: 'Capellan Confederation',         affiliation: 'IS' },
  'CF':   { code: 'CF',   codeIO: 'CIR',        name: 'Circinus Federation',            affiliation: 'IS' },
  'CP':   { code: 'CP',   codeIO: 'CDP',        name: 'Calderon Defense Pact',          affiliation: 'IS' },
  'CS':   { code: 'CS',   codeIO: 'CS',         name: 'ComStar',                        affiliation: 'IS' },
  'DC':   { code: 'DC',   codeIO: 'DC',         name: 'Draconis Combine',               affiliation: 'IS' },
  'EI':   { code: 'EI',   codeIO: 'CEI',        name: 'Escorpión Imperio',              affiliation: 'IS' },
  'FC':   { code: 'FC',   codeIO: 'FC',         name: 'Federated Commonwealth',         affiliation: 'IS' },
  'FR':   { code: 'FR',   codeIO: 'FRR',        name: 'Free Rasalhague Republic',       affiliation: 'IS' },
  'FS':   { code: 'FS',   codeIO: 'FS',         name: 'Federated Suns',                 affiliation: 'IS' },
  'FW':   { code: 'FW',   codeIO: 'FWL',        name: 'Free Worlds League',             affiliation: 'IS' },
  'LC':   { code: 'LC',   codeIO: 'LA',         name: 'Lyran Commonwealth',             affiliation: 'IS' },
  'MC':   { code: 'MC',   codeIO: 'MOC',        name: 'Magistracy of Canopus',          affiliation: 'IS' },
  'MH':   { code: 'MH',   codeIO: 'MH',         name: 'Marian Hegemony',                affiliation: 'IS' },
  'OA':   { code: 'OA',   codeIO: 'OA',         name: 'Outworlds Alliance',             affiliation: 'IS' },
  'TA':   { code: 'TA',   codeIO: 'TA',         name: 'Taurian Concordat (alt)',        affiliation: 'IS' },
  'TC':   { code: 'TC',   codeIO: 'TC',         name: 'Taurian Concordat',              affiliation: 'IS' },
  'TH':   { code: 'TH',   codeIO: 'TH',         name: 'Terran Hegemony',                affiliation: 'IS' },
  'RD':   { code: 'RD',   codeIO: 'RD',         name: 'Rasalhague Dominion',            affiliation: 'IS' },
  'RS':   { code: 'RS',   codeIO: 'ROS',        name: 'Republic of the Sphere',         affiliation: 'IS' },
  'RA':   { code: 'RA',   codeIO: 'RA',         name: 'Republic / Rasalhague',          affiliation: 'IS' },
  'RW':   { code: 'RW',   codeIO: 'RWR',        name: 'Rim Worlds Republic',            affiliation: 'IS' },
  'WB':   { code: 'WB',   codeIO: 'WOB',        name: 'Word of Blake',                  affiliation: 'IS' },
  'Merc': { code: 'Merc', codeIO: 'MERC',       name: 'Mercenary',                      affiliation: 'IS' },
  'Per':  { code: 'Per',  codeIO: 'Periphery',  name: 'Periphery',                      affiliation: 'IS' },
  // ── Clan ──
  'Clan': { code: 'Clan', codeIO: 'CLAN',       name: 'Clan',                           affiliation: 'Clan' },
  'CBR':  { code: 'CBR',  codeIO: 'CB',         name: 'Clan Burrock',                   affiliation: 'Clan' },
  'CBS':  { code: 'CBS',  codeIO: 'CBS',        name: 'Clan Blood Spirit',              affiliation: 'Clan' },
  'CCY':  { code: 'CCY',  codeIO: 'CCO',        name: 'Clan Coyote',                    affiliation: 'Clan' },
  'CCC':  { code: 'CCC',  codeIO: 'CCC',        name: 'Clan Cloud Cobra',               affiliation: 'Clan' },
  'CFM':  { code: 'CFM',  codeIO: 'CFM',        name: 'Clan Fire Mandrill',             affiliation: 'Clan' },
  'CGB':  { code: 'CGB',  codeIO: 'CGB',        name: 'Clan Ghost Bear',                affiliation: 'Clan' },
  'CGS':  { code: 'CGS',  codeIO: 'CGS',        name: 'Clan Goliath Scorpion',          affiliation: 'Clan' },
  'CHH':  { code: 'CHH',  codeIO: 'CHH',        name: "Clan Hell's Horses",             affiliation: 'Clan' },
  'CIH':  { code: 'CIH',  codeIO: 'CIH',        name: 'Clan Ice Hellion',               affiliation: 'Clan' },
  'CJF':  { code: 'CJF',  codeIO: 'CJF',        name: 'Clan Jade Falcon',               affiliation: 'Clan' },
  'CMN':  { code: 'CMN',  codeIO: 'CMG',        name: 'Clan Mongoose',                  affiliation: 'Clan' },
  'CNC':  { code: 'CNC',  codeIO: 'CNC',        name: 'Clan Nova Cat',                  affiliation: 'Clan' },
  'CSF':  { code: 'CSF',  codeIO: 'CDS',        name: 'Clan Sea Fox / Diamond Shark',   affiliation: 'Clan' },
  'CSJ':  { code: 'CSJ',  codeIO: 'CSJ',        name: 'Clan Smoke Jaguar',              affiliation: 'Clan' },
  'CSR':  { code: 'CSR',  codeIO: 'CSR',        name: 'Clan Snow Raven',                affiliation: 'Clan' },
  'CSV':  { code: 'CSV',  codeIO: 'CSV',        name: 'Clan Steel Viper / Star Viper',  affiliation: 'Clan' },
  'CSA':  { code: 'CSA',  codeIO: 'CSA',        name: 'Clan Star Adder',                affiliation: 'Clan' },
  'CWM':  { code: 'CWM',  codeIO: 'CWI',        name: 'Clan Widowmaker',                affiliation: 'Clan' },
  'CWF':  { code: 'CWF',  codeIO: 'CW',         name: 'Clan Wolf',                      affiliation: 'Clan' },
  'CWX':  { code: 'CWX',  codeIO: 'CWIE',       name: 'Clan Wolf-in-Exile',             affiliation: 'Clan' },
  'CWV':  { code: 'CWV',  codeIO: 'CWOV',       name: 'Clan Wolverine',                 affiliation: 'Clan' },
};

// ============================================================================
// Lookup helpers
// ============================================================================

/** Reverse lookup: IO abbreviation → FactionCode. */
const IO_ABBR_MAP = new Map<string, FactionCode>();
/** Reverse lookup: MM abbreviation → FactionCode. */
const MM_ABBR_MAP = new Map<string, FactionCode>();

for (const desc of Object.values(FACTION_DATA)) {
  MM_ABBR_MAP.set(desc.code, desc.code);
  IO_ABBR_MAP.set(desc.codeIO, desc.code);
}

/**
 * Resolve a MegaMek abbreviation (codeMM) to a `FactionCode`.
 * Returns `'None'` if not found.
 */
export function factionFromMMAbbr(abbr: string): FactionCode {
  const base = abbr.split('.')[0];
  return MM_ABBR_MAP.get(base) ?? 'None';
}

/**
 * Resolve an Interstellar Operations abbreviation (codeIO) to a `FactionCode`.
 * Returns `'None'` if not found.
 */
export function factionFromIOAbbr(abbr: string): FactionCode {
  const base = abbr.split('.')[0];
  return IO_ABBR_MAP.get(base) ?? 'None';
}

/**
 * Resolve any abbreviation (tries MM first, then IO) to a `FactionCode`.
 * Mirrors Java `Faction.fromAbbr()`.
 * Returns `'None'` if not found.
 */
export function factionFromAbbr(abbr: string): FactionCode {
  const mm = factionFromMMAbbr(abbr);
  if (mm !== 'None') return mm;
  return factionFromIOAbbr(abbr);
}

/** Get the full descriptor for a faction code. */
export function getFactionDescriptor(code: FactionCode): FactionDescriptor {
  return FACTION_DATA[code];
}

/** All valid faction codes (excluding 'None'). */
export const ALL_FACTION_CODES: readonly FactionCode[] =
  (Object.keys(FACTION_DATA) as FactionCode[]).filter(c => c !== 'None');
