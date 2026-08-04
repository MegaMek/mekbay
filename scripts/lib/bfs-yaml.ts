import { load } from 'js-yaml';
import type { BfsDocument, ValueProfile } from './bfs-converter';
import { isUuidV7 } from './megamek-unit-file-metadata';

const TOP_LEVEL_FIELDS = new Set([
    'uuid', 'linkedUnitId', 'chassis', 'model', 'assetType', 'cardTitle', 'cardSubtitle', 'year', 'techBase',
    'source', 'movement', 'tmm', 'range', 'skill', 'damage', 'destroyCheck', 'threshold', 'cost', 'specials', 'role',
]);
const ASSET_TYPES = new Set(['Vehicle', 'Conventional Infantry', 'Battle Armor', 'Emplacement']);
const MOVEMENT_MODES = new Set([
    'TRACKED', 'WHEELED', 'HOVER', 'VTOL', 'WIGE', 'INF_LEG', 'INF_JUMP', 'INF_MOTORIZED', 'NONE',
]);
const TECH_BASES = new Set(['IS', 'Clan', 'Mixed (IS Chassis)', 'Mixed (Clan Chassis)']);
const UNIT_ROLES = new Set([
    'UNDETERMINED', 'NONE', 'AMBUSHER', 'BRAWLER', 'JUGGERNAUT', 'MISSILE_BOAT', 'SCOUT', 'SKIRMISHER',
    'SNIPER', 'STRIKER', 'ATTACK_FIGHTER', 'DOGFIGHTER', 'FAST_DOGFIGHTER', 'FIRE_SUPPORT', 'INTERCEPTOR',
    'TRANSPORT',
]);

export const BFS_LICENSE_HEADER = `# MegaMek Data (C) 2026 by The MegaMek Team is licensed under CC BY-NC-SA 4.0.
# To view a copy of this license, visit https://creativecommons.org/licenses/by-nc-sa/4.0/
#
# NOTICE: The MegaMek organization is a non-profit group of volunteers
# creating free software for the BattleTech community.
#
# MechWarrior, BattleMech, \`Mech and AeroTech are registered trademarks
# of The Topps Company, Inc. All Rights Reserved.
#
# Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
# InMediaRes Productions, LLC.
#
# MechWarrior Copyright Microsoft Corporation. MegaMek Data was created under
# Microsoft's "Game Content Usage Rules"
# <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
# affiliated with Microsoft.

`;

function quote(value: string): string {
    return JSON.stringify(value);
}

function pushOptionalString(lines: string[], key: string, value: string | undefined): void {
    if (value !== undefined && value.trim().length > 0) {
        lines.push(`${key}: ${quote(value)}`);
    }
}

function pushProfile(lines: string[], key: string, profile: ValueProfile): void {
    lines.push(`${key}:`, `  standard: ${profile.standard}`);
    if (profile.veteran !== undefined) {
        lines.push(`  veteran: ${profile.veteran}`);
    }
}

export function renderBfsYaml(document: BfsDocument): string {
    validateBfsDocument(document);
    const lines: string[] = [
        `uuid: ${quote(document.uuid)}`,
    ];
    pushOptionalString(lines, 'linkedUnitId', document.linkedUnitId);
    lines.push(
        `chassis: ${quote(document.chassis)}`,
        `model: ${quote(document.model)}`,
        `assetType: ${quote(document.assetType)}`,
    );
    pushOptionalString(lines, 'cardTitle', document.cardTitle);
    pushOptionalString(lines, 'cardSubtitle', document.cardSubtitle);
    if (document.year !== undefined) {
        lines.push(`year: ${document.year}`);
    }
    pushOptionalString(lines, 'techBase', document.techBase);
    pushOptionalString(lines, 'source', document.source);
    lines.push(
        'movement:',
        `  mp: ${document.movement.mp}`,
        `  mode: ${quote(document.movement.mode)}`,
        `tmm: ${document.tmm}`,
        'range:',
        `- ${document.range[0]}`,
        `- ${document.range[1]}`,
        `- ${document.range[2]}`,
    );
    pushProfile(lines, 'skill', document.skill);
    lines.push(
        'damage:',
        `  perHit: ${document.damage.perHit}`,
        `  hits: ${document.damage.hits}`,
        `destroyCheck: ${document.destroyCheck}`,
        `threshold: ${document.threshold}`,
    );
    pushProfile(lines, 'cost', document.cost);
    if (document.specials.length === 0) {
        lines.push('specials: []');
    } else {
        lines.push('specials:');
        for (const special of document.specials) {
            lines.push(`- ${quote(special)}`);
        }
    }
    pushOptionalString(lines, 'role', document.role);
    return `${BFS_LICENSE_HEADER}${lines.join('\n')}\n`;
}

function assertInteger(value: unknown, field: string, minimum: number): asserts value is number {
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > 2_147_483_647) {
        throw new Error(`${field} must be an integer in ${minimum}..2147483647.`);
    }
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown ${field} field '${key}'.`);
        }
    }
}

function assertString(value: unknown, field: string, allowBlank = false): asserts value is string {
    if (typeof value !== 'string' || (!allowBlank && value.trim().length === 0)) {
        throw new Error(`${field} must be ${allowBlank ? 'a string' : 'a nonblank string'}.`);
    }
}

function validateOptionalString(value: unknown, field: string): void {
    if (value !== undefined) {
        assertString(value, field);
    }
}

function validateProfile(value: unknown, field: string): asserts value is ValueProfile {
    const profile = requireObject(value, field);
    requireExactKeys(profile, new Set(['standard', 'veteran']), field);
    assertInteger(profile.standard, `${field}.standard`, 0);
    if (profile.veteran !== undefined) {
        assertInteger(profile.veteran, `${field}.veteran`, 0);
    }
}

export function validateBfsDocument(document: BfsDocument): void {
    const record = requireObject(document, 'The .bfs document root');
    requireExactKeys(record, TOP_LEVEL_FIELDS, 'BFS');
    assertString(document.uuid, 'uuid');
    if (!isUuidV7(document.uuid)) {
        throw new Error(`uuid must be an RFC variant-2 UUIDv7; received '${document.uuid}'.`);
    }
    if (document.linkedUnitId !== undefined) {
        assertString(document.linkedUnitId, 'linkedUnitId');
        if (!isUuidV7(document.linkedUnitId)) {
            throw new Error(`linkedUnitId must be an RFC variant-2 UUIDv7; received '${document.linkedUnitId}'.`);
        }
    }
    assertString(document.chassis, 'chassis');
    assertString(document.model, 'model', true);
    assertString(document.assetType, 'assetType');
    if (!ASSET_TYPES.has(document.assetType)) {
        throw new Error(`Unsupported assetType '${document.assetType}'.`);
    }
    validateOptionalString(document.cardTitle, 'cardTitle');
    validateOptionalString(document.cardSubtitle, 'cardSubtitle');
    if (document.year !== undefined) {
        assertInteger(document.year, 'year', 1);
    }
    if (document.techBase !== undefined) {
        assertString(document.techBase, 'techBase');
        if (!TECH_BASES.has(document.techBase)) {
            throw new Error(`Unsupported techBase '${document.techBase}'.`);
        }
    }
    validateOptionalString(document.source, 'source');
    const movement = requireObject(document.movement, 'movement');
    requireExactKeys(movement, new Set(['mp', 'mode']), 'movement');
    assertInteger(movement.mp, 'movement.mp', 0);
    assertString(movement.mode, 'movement.mode');
    if (!MOVEMENT_MODES.has(movement.mode)) {
        throw new Error(`Unsupported movement.mode '${movement.mode}'.`);
    }
    assertInteger(document.tmm, 'tmm', 0);
    if (!Array.isArray(document.range) || document.range.length !== 3
        || !(document.range.every((value) => Number.isInteger(value) && value >= 0 && value <= 2_147_483_647)
            || document.range.every((value) => value === -1))) {
        throw new Error('range must contain three nonnegative integers or exactly [-1,-1,-1].');
    }
    if (document.range[0] !== -1
        && !(document.range[0] <= document.range[1] && document.range[1] <= document.range[2])) {
        throw new Error('range values must be ascending.');
    }
    validateProfile(document.skill, 'skill');
    const damage = requireObject(document.damage, 'damage');
    requireExactKeys(damage, new Set(['perHit', 'hits']), 'damage');
    assertInteger(damage.perHit, 'damage.perHit', 0);
    assertInteger(damage.hits, 'damage.hits', 0);
    if ((damage.perHit === 0) !== (damage.hits === 0)) {
        throw new Error('damage.perHit and damage.hits must both be zero or both be positive.');
    }
    assertInteger(document.destroyCheck, 'destroyCheck', 0);
    assertInteger(document.threshold, 'threshold', 0);
    validateProfile(document.cost, 'cost');
    if (!Array.isArray(document.specials)
        || !document.specials.every((special) => typeof special === 'string' && special.trim().length > 0)) {
        throw new Error('specials must contain only nonblank strings.');
    }
    if (document.role !== undefined) {
        assertString(document.role, 'role');
        if (!UNIT_ROLES.has(document.role)) {
            throw new Error(`Unsupported role '${document.role}'.`);
        }
    }
    if (document.assetType === 'Emplacement'
        && (movement.mode !== 'NONE' || movement.mp !== 0 || document.tmm !== 0
            || !document.specials.includes('Immobile'))) {
        throw new Error('Emplacements require NONE movement, MP/TMM 0, and Immobile.');
    }
}

/** Parses generated YAML and rejects fields outside the current Java BFS schema. */
export function parseRenderedBfs(content: string): BfsDocument {
    const value = load(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The .bfs document root must be an object.');
    }
    const record = value as Record<string, unknown>;
    const parsed = record as unknown as BfsDocument;
    validateBfsDocument(parsed);
    return parsed;
}
