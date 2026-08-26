// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The deliberately narrow migration boundary for old additional-server
 * `units.json` feeds.  That document is a search/catalog projection, not a
 * native entity source, so every accepted entry is catalog-only.
 */

import type { EntityType } from '../../models/entity/types';
import { isEntityLoadIssueArray } from '../../models/entity/parsers/parse-context';
import { UNIT_SUMMARY_VERSION, type UnitSummary, type Units } from '../../models/unit-summary.model';
import { sha256Base64Url } from '../../utils/sha256.util';
import {
    asUnitProviderId,
    asUnitUuid,
    type UnitProviderId,
} from './unit-catalog.types';

export const MAX_CUSTOM_PROVIDER_UNITS = 100_000;
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom:';

export class CustomProviderCatalogValidationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'CustomProviderCatalogValidationError';
    }
}

/** A stable opaque identity: moving a server changes providers instead of silently replacing designs. */
export async function customProviderIdForServer(server: string): Promise<UnitProviderId> {
    // UnitProviderId intentionally uses a conservative lower-case alphabet.
    // Escape each uppercase base64url character instead of lowercasing it (the
    // latter would create collisions).
    const digest = await sha256Base64Url(server);
    const canonical = digest.replace(/[A-Z]/gu, character => `_${character.toLowerCase()}`);
    return asUnitProviderId(`${CUSTOM_PROVIDER_ID_PREFIX}${canonical}`);
}

export async function importCustomProviderUnits(
    server: string,
    dataset: Units,
): Promise<readonly UnitSummary[]> {
    if (!isValidDatasetEnvelope(dataset)) {
        throw new CustomProviderCatalogValidationError('units.json must contain a non-empty bounded unit array');
    }
    const provider = await customProviderIdForServer(server);
    const identities = new Set<string>();
    const summaries: UnitSummary[] = [];
    for (const [index, raw] of dataset.units.entries()) {
        validateLegacyUnit(raw, index);
        const uuid = asUnitUuid(raw.uuid.toLowerCase());
        if (identities.has(uuid)) {
            throw new CustomProviderCatalogValidationError(`units.json contains duplicate UUID ${uuid}`);
        }
        identities.add(uuid);
        summaries.push(Object.freeze({
            ...summaryFields(raw),
            uuid,
            provider,
            origin: 'user',
            hash: dataset.assetHash.trim() || dataset.version.trim(),
            summaryVersion: UNIT_SUMMARY_VERSION,
            baseChassis: raw.chassis,
            entityType: entityTypeOf(raw),
            pv: raw.as.PV,
        } satisfies UnitSummary));
    }
    return Object.freeze(summaries);
}

function isValidDatasetEnvelope(value: Units): boolean {
    return !!value
        && typeof value.version === 'string'
        && typeof value.assetHash === 'string'
        && Array.isArray(value.units)
        && value.units.length > 0
        && value.units.length <= MAX_CUSTOM_PROVIDER_UNITS;
}

function validateLegacyUnit(unit: UnitSummary, index: number): void {
    const label = `units[${index}]`;
    if (!unit || typeof unit !== 'object'
        || Object.prototype.hasOwnProperty.call(unit, 'fluff')
        || typeof unit.uuid !== 'string'
        || typeof unit.name !== 'string' || !unit.name.trim()
        || typeof unit.chassis !== 'string' || typeof unit.model !== 'string'
        || typeof unit.type !== 'string' || typeof unit.subtype !== 'string'
        || !Array.isArray(unit.source) || !Array.isArray(unit.published)
        || !isEntityLoadIssueArray(unit.loadIssues)
        || !isRulesRefs(unit.rulesRefs)
        || !Array.isArray(unit.comp) || !Array.isArray(unit.quirks) || !Array.isArray(unit.features)
        || !unit.as || typeof unit.as !== 'object') {
        throw new CustomProviderCatalogValidationError(`${label} has an invalid legacy summary shape`);
    }
    const requiredStrings: readonly (keyof UnitSummary)[] = [
        'uuid', 'name', 'chassis', 'model', 'weightClass', 'level', 'techBase', 'techRating',
        'type', 'subtype', 'engine', 'armorType', 'role', 'c3', 'icon',
    ];
    const requiredNumbers: readonly (keyof UnitSummary)[] = [
        'id', 'year', 'tons', 'loadoutTons', 'offSpeedFactor', 'bv', 'cost', 'omni',
        'engineRating', 'engineHS', 'armor', 'armorPer', 'internal', 'heat', 'dissipation',
        'walk', 'walk2', 'run', 'run2', 'jump', 'jump2', 'umu', 'dpt', 'su', 'crewSize',
    ];
    if (requiredStrings.some(key => typeof unit[key] !== 'string')
        || requiredNumbers.some(key => typeof unit[key] !== 'number')
        || typeof unit.mixed !== 'boolean' || typeof unit.canon !== 'boolean'
        || typeof unit.canAntiMech !== 'boolean' || typeof unit.as.PV !== 'number') {
        throw new CustomProviderCatalogValidationError(`${label} has missing or mistyped required summary fields`);
    }
    try {
        asUnitUuid(unit.uuid.toLowerCase());
    } catch {
        throw new CustomProviderCatalogValidationError(`${label} has an invalid UUIDv7`);
    }
    for (const [name, value] of Object.entries(unit)) {
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw new CustomProviderCatalogValidationError(`${label}.${name} must be finite`);
        }
    }
    entityTypeOf(unit);
}

function isRulesRefs(value: unknown): value is string[][] {
    return Array.isArray(value)
        && value.every(combination => Array.isArray(combination)
            && combination.length > 0
            && combination.every(book => typeof book === 'string' && book.length > 0));
}

function entityTypeOf(unit: UnitSummary): EntityType {
    const direct: Partial<Record<UnitSummary['type'], EntityType>> = {
        Mek: 'Mek', Aero: 'Aero', Infantry: 'Infantry', Naval: 'Naval',
        ProtoMek: 'ProtoMek', Tank: 'Tank', VTOL: 'VTOL',
        'Gun Emplacement': 'GunEmplacement', 'Handheld Weapon': 'HandheldWeapon', Building: 'BuildingEntity',
    };
    const entityType = direct[unit.type];
    if (!entityType) throw new CustomProviderCatalogValidationError(`Unsupported legacy unit family ${unit.type}`);
    return entityType;
}

function summaryFields(unit: UnitSummary): Omit<UnitSummary, 'uuid' | 'provider' | 'origin' | 'hash' | 'summaryVersion' | 'baseChassis' | 'entityType' | 'pv'> {
    const { uuid: _uuid, provider: _provider, origin: _origin, hash: _hash, summaryVersion: _summaryVersion, ...fields } = unit;
    return {
        ...fields,
        engine: unit.engine || null,
        source: [...unit.source],
        published: [...unit.published],
        rulesRefs: unit.rulesRefs.map(combination => [...combination]),
        loadIssues: unit.loadIssues.map(issue => ({ ...issue })),
        comp: unit.comp.map(component => ({ ...component })),
        quirks: [...unit.quirks],
        features: [...unit.features],
    };
}
