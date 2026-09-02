// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import type { ForceEntryResolver } from './force-entry-resolver.model';
import type { Force } from './force.model';
import type {
    ASSerializedUnit,
    SerializedForce,
} from './force-serialization';
import {
    forceMemberAdjustedValue,
    isCBTForceMember,
    type ForceMember,
} from './force-member.model';
import type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';
import type { UnitSummary } from './unit-summary.model';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { uuidv7 } from '../utils/uuid.util';
import type { CrewMemberDetails } from './crew-member.model';
import type { SerializedCBTForceV2 } from './runtime/persistence-v2';

export interface ForcePreviewUnit {
    unit: UnitSummary | undefined;
    alias?: string;
    destroyed: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
    crew?: CrewMemberDetails[];
    commander?: boolean;
    lockKey?: string;
}

export interface ForcePreviewGroup {
    name?: string;
    formationId?: string;
    force?: ForcePreviewEntry;
    units: ForcePreviewUnit[];
}

export interface ForcePreviewEntry {
    persistenceVersion: 1 | 2;
    instanceId: string;
    timestamp: string;
    type: GameSystem;
    owned: boolean;
    cloud: boolean;
    local: boolean;
    missing: boolean;
    name: string;
    note?: string;
    tags?: string[];
    faction: Faction | null;
    era: Era | null;
    bv?: number;
    pv?: number;
    groups: ForcePreviewGroup[];
}

function assignForcePreviewUnitField<K extends keyof ForcePreviewUnit>(
    target: ForcePreviewUnit,
    key: K,
    value: ForcePreviewUnit[K] | undefined,
): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

function resolveSerializedUnitId(id: string | undefined): string {
    const normalizedId = id?.trim();
    if (normalizedId && Number(normalizedId) > 0) {
        return normalizedId;
    }

    return uuidv7();
}

function createForcePreviewGroups(
    rawGroups: readonly RemoteLoadForceGroup[] | undefined,
    getUnitByName: (name: string) => UnitSummary | undefined,
    getUnitByUuid?: (uuid: UnitUuid) => UnitSummary | undefined,
): ForcePreviewGroup[] {
    if (!Array.isArray(rawGroups)) {
        return [];
    }

    return rawGroups.map((group) => ({
        name: group.name,
        formationId: group.formationId,
        units: (group.units ?? []).map((unit: RemoteLoadForceUnit) =>
            createForcePreviewUnit(unit, getUnitByName, getUnitByUuid)),
    }));
}

function createForcePreviewEntryData(data: Partial<ForcePreviewEntry>): ForcePreviewEntry {
    const previewEntry: ForcePreviewEntry = {
        persistenceVersion: data.persistenceVersion ?? 2,
        instanceId: data.instanceId ?? '',
        timestamp: data.timestamp ?? '',
        type: data.type ?? GameSystem.CBT,
        owned: data.owned ?? true,
        cloud: data.cloud ?? false,
        local: data.local ?? false,
        missing: data.missing ?? false,
        name: data.name ?? '',
        note: data.note || undefined,
        tags: data.tags?.length ? [...data.tags] : undefined,
        faction: data.faction ?? null,
        era: data.era ?? null,
        bv: data.bv,
        pv: data.pv,
        groups: data.groups ?? [],
    };

    for (const group of previewEntry.groups) {
        group.force = previewEntry;
    }

    return previewEntry;
}

export function isForcePreviewEntry(value: unknown): value is ForcePreviewEntry {
    return typeof value === 'object'
        && value !== null
        && Array.isArray((value as Partial<ForcePreviewEntry>).groups);
}

export function createForcePreviewUnit(
    raw: RemoteLoadForceUnit,
    getUnitByName: (name: string) => UnitSummary | undefined,
    getUnitByUuid?: (uuid: UnitUuid) => UnitSummary | undefined,
): ForcePreviewUnit {
    const previewUnit: ForcePreviewUnit = {
        unit: raw.uuid !== undefined
            ? getUnitByUuid?.(raw.uuid)
            : raw.unit === undefined ? undefined : getUnitByName(raw.unit),
        destroyed: raw.state?.destroyed ?? false,
        lockKey: uuidv7(),
    };

    assignForcePreviewUnitField(previewUnit, 'alias', raw.alias);
    assignForcePreviewUnitField(previewUnit, 'skill', raw.skill);
    assignForcePreviewUnitField(previewUnit, 'gunnery', raw.g);
    assignForcePreviewUnitField(previewUnit, 'piloting', raw.p);
    assignForcePreviewUnitField(previewUnit, 'commander', raw.commander);

    return previewUnit;
}

export function createForcePreviewUnitFromSerializedUnit(
    unit: ASSerializedUnit,
    getUnitByUuid: (uuid: UnitUuid) => UnitSummary | undefined,
): ForcePreviewUnit {
    const resolvedUnit = getUnitByUuid(unit.uuid);
    const previewUnit: ForcePreviewUnit = {
        unit: resolvedUnit,
        destroyed: unit.state?.destroyed ?? false,
        lockKey: resolveSerializedUnitId(unit.id),
    };

    assignForcePreviewUnitField(previewUnit, 'alias', unit.alias);
    assignForcePreviewUnitField(previewUnit, 'commander', unit.commander);

    assignForcePreviewUnitField(previewUnit, 'skill', unit.skill);
    return previewUnit;
}

export function createForcePreviewUnitFromForceMember(
    member: ForceMember,
    resolveCBTSummary?: (member: Extract<ForceMember, { readonly kind: 'cbt' }>) => UnitSummary | undefined,
): ForcePreviewUnit {
    if (isCBTForceMember(member)) {
        const crew = member.force.getUnitCrewAssignment(member.id)?.positions ?? [];
        const previewUnit: ForcePreviewUnit = {
            unit: resolveCBTSummary?.(member),
            destroyed: member.force.getUnitDestroyed(member.id) ?? false,
            lockKey: member.id,
        };
        if (crew.length > 0) {
            assignForcePreviewUnitField(previewUnit, 'gunnery', Math.min(...crew.map(position => position.gunnery)));
            assignForcePreviewUnitField(previewUnit, 'piloting', Math.min(...crew.map(position => position.piloting)));
        }
        if (member.force.isUnitCommander(member.id)) {
            assignForcePreviewUnitField(previewUnit, 'commander', true);
        }
        return previewUnit;
    }

    const forceUnit = member;
    const previewUnit: ForcePreviewUnit = {
        unit: forceUnit.getSummary(),
        destroyed: forceUnit.destroyed,
        lockKey: resolveSerializedUnitId(forceUnit.id),
    };

    assignForcePreviewUnitField(previewUnit, 'alias', forceUnit.alias());
    assignForcePreviewUnitField(previewUnit, 'commander', forceUnit.commander());

    assignForcePreviewUnitField(previewUnit, 'skill', forceUnit.getPilotSkill());
    return previewUnit;
}

function createCBTForcePreviewGroups(
    cbt: SerializedCBTForceV2,
    resolver: ForceEntryResolver,
): ForcePreviewGroup[] {
    const entries = new Map(cbt.units.map(entry => [entry.instanceId, entry] as const));
    return cbt.roster.groups.map(group => ({
        name: group.name,
        formationId: group.formationId,
        units: group.members.map(member => {
            const entry = entries.get(member.instanceId)!;
            const identity = entry.unit.entity;
            const preview: ForcePreviewUnit = {
                unit: resolver.getUnitByUuid(identity),
                destroyed: entry.unit.destroyed === true,
                lockKey: member.instanceId,
            };
            if (member.commander === true) preview.commander = true;
            const positions = entry.unit.deployment.values.crewAssignment.positions;
            if (positions.length > 0) {
                preview.gunnery = Math.min(...positions.map(position => position.gunnery));
                preview.piloting = Math.min(...positions.map(position => position.piloting));
                preview.crew = positions.map((position, index) => ({
                    id: index,
                    name: position.name,
                    gunnery: position.gunnery,
                    piloting: position.piloting,
                }));
            }
            return preview;
        }),
    }));
}

export function createForcePreviewEntry(
    raw: RemoteLoadForceEntry,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): ForcePreviewEntry {
    return createForcePreviewEntryData({
        persistenceVersion: raw.version ?? 1,
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: raw.owned ?? true,
        instanceId: raw.instanceId,
        name: raw.name,
        note: raw.note || undefined,
        tags: raw.tags?.length ? [...raw.tags] : undefined,
        type: raw.type ?? GameSystem.CBT,
        faction: raw.factionId != null ? resolver.getFactionById(raw.factionId) ?? null : null,
        era: raw.eraId != null ? resolver.getEraById(raw.eraId) ?? null : null,
        bv: raw.bv,
        pv: raw.pv,
        timestamp: raw.timestamp,
        groups: createForcePreviewGroups(
            raw.groups,
            (name) => resolver.getUnitByName(name),
            (uuid) => resolver.getUnitByUuid(uuid),
        ),
    });
}

export function createForcePreviewEntryFromSerializedForce(
    raw: SerializedForce,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): ForcePreviewEntry {
    if (raw.version !== 2 || (raw.type === GameSystem.CBT && raw.cbt === undefined)) {
        throw new Error('Force preview requires normalized current persistence');
    }
    return createForcePreviewEntryData({
        persistenceVersion: 2,
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: raw.owned ?? true,
        instanceId: raw.instanceId,
        name: raw.name,
        note: raw.note || undefined,
        tags: raw.tags?.length ? [...raw.tags] : undefined,
        type: raw.type ?? GameSystem.CBT,
        faction: raw.factionId != null ? resolver.getFactionById(raw.factionId) ?? null : null,
        era: raw.eraId != null ? resolver.getEraById(raw.eraId) ?? null : null,
        bv: raw.bv,
        pv: raw.pv,
        timestamp: raw.timestamp,
        groups: raw.type === GameSystem.CBT
            ? createCBTForcePreviewGroups(raw.cbt!, resolver)
            : (raw.groups ?? []).map((group) => ({
                name: group.name,
                formationId: group.formationId,
                units: group.units.map((unit) => createForcePreviewUnitFromSerializedUnit(
                    unit as ASSerializedUnit,
                    (uuid) => resolver.getUnitByUuid(uuid),
                )),
            })),
    });
}

export function createForcePreviewEntryFromForce(
    force: Force,
    members: readonly ForceMember[],
    options: { cloud?: boolean; local?: boolean } = {},
    resolveCBTSummary?: (member: Extract<ForceMember, { readonly kind: 'cbt' }>) => UnitSummary | undefined,
): ForcePreviewEntry {
    const tags = force.tags ?? [];
    const groups = force.groups()
        .map((group) => {
            const alphaStrikeMembers = new Set(group.units());
            const groupMembers = members.filter(member => isCBTForceMember(member)
                ? member.rosterGroupId === group.id
                : alphaStrikeMembers.has(member));
            return {
                name: group.name() || undefined,
                formationId: group.activeFormation()?.id,
                units: groupMembers.map(member =>
                    createForcePreviewUnitFromForceMember(member, resolveCBTSummary)),
            };
        })
        .filter(group => group.units.length > 0);
    const total = members.reduce((sum, member) =>
        sum + forceMemberAdjustedValue(member, 'damaged'), 0);

    return createForcePreviewEntryData({
        persistenceVersion: 2,
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: force.owned(),
        instanceId: force.instanceId() ?? '',
        name: force.name,
        note: force.note || undefined,
        tags: tags.length ? [...tags] : undefined,
        type: force.gameSystem,
        faction: force.faction(),
        era: force.era(),
        bv: force.gameSystem === GameSystem.CBT ? total : undefined,
        pv: force.gameSystem === GameSystem.AS ? total : undefined,
        timestamp: force.timestamp ?? '',
        groups,
    });
}

export function getForcePreviewUnitEntries(forcePreview: ForcePreviewEntry): ForcePreviewUnit[] {
    return forcePreview.groups.flatMap((group) => group.units);
}

export function getForcePreviewResolvedUnits(forcePreview: ForcePreviewEntry): UnitSummary[] {
    return getForcePreviewUnitEntries(forcePreview)
        .flatMap((entry) => entry.unit ? [entry.unit] : []);
}

export function getForcePreviewUnitPilotStats(forcePreviewUnit: ForcePreviewUnit, gameSystem: GameSystem): string {
    if (gameSystem === GameSystem.AS) {
        return `${forcePreviewUnit.skill ?? forcePreviewUnit.gunnery ?? '?'}`;
    }

    const gunnery = forcePreviewUnit.gunnery ?? forcePreviewUnit.skill ?? '?';
    if (forcePreviewUnit.unit?.type === 'ProtoMek') {
        return `${gunnery}`;
    }

    const piloting = forcePreviewUnit.piloting ?? '?';
    return `${gunnery}/${piloting}`;
}
