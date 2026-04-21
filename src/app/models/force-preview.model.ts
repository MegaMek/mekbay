import { GameSystem } from './common.model';
import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import type { ForceEntryResolver } from './force-entry-resolver.model';
import type { Force } from './force.model';
import type {
    ASSerializedUnit,
    CBTSerializedState,
    CBTSerializedUnit,
    SerializedForce,
    SerializedUnit,
} from './force-serialization';
import type { ForceUnit } from './force-unit.model';
import type {
    RemoteLoadForceEntry,
    RemoteLoadForceGroup,
    RemoteLoadForceUnit,
} from './remote-load-force-entry.model';
import type { Unit } from './units.model';

export interface ForcePreviewUnit {
    unit: Unit | undefined;
    alias?: string;
    destroyed: boolean;
    skill?: number;
    gunnery?: number;
    piloting?: number;
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
    instanceId: string;
    timestamp: string;
    type: GameSystem;
    owned: boolean;
    cloud: boolean;
    local: boolean;
    missing: boolean;
    name: string;
    note?: string;
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

function isASSerializedUnit(unit: SerializedUnit): unit is ASSerializedUnit {
    return typeof (unit as Partial<ASSerializedUnit>).skill === 'number';
}

function isCBTSerializedUnit(unit: SerializedUnit): unit is CBTSerializedUnit {
    return Array.isArray((unit.state as Partial<CBTSerializedState>).crew);
}

type LiveClassicPilotStatsForceUnit = ForceUnit & {
    gunnerySkill: () => number;
    pilotingSkill: () => number;
};

type LiveAlphaStrikePilotStatsForceUnit = ForceUnit & {
    getPilotSkill: () => number;
};

function hasLiveClassicPilotStats(forceUnit: ForceUnit): forceUnit is LiveClassicPilotStatsForceUnit {
    return typeof (forceUnit as Partial<LiveClassicPilotStatsForceUnit>).gunnerySkill === 'function'
        && typeof (forceUnit as Partial<LiveClassicPilotStatsForceUnit>).pilotingSkill === 'function';
}

function hasLiveAlphaStrikePilotStats(forceUnit: ForceUnit): forceUnit is LiveAlphaStrikePilotStatsForceUnit {
    return typeof (forceUnit as Partial<LiveAlphaStrikePilotStatsForceUnit>).getPilotSkill === 'function';
}

function createForcePreviewGroups(
    rawGroups: readonly RemoteLoadForceGroup[] | undefined,
    getUnitByName: (name: string) => Unit | undefined,
): ForcePreviewGroup[] {
    if (!Array.isArray(rawGroups)) {
        return [];
    }

    return rawGroups.map((group) => ({
        name: group.name,
        formationId: group.formationId,
        units: (group.units ?? []).map((unit: RemoteLoadForceUnit) => createForcePreviewUnit(unit, getUnitByName)),
    }));
}

function createForcePreviewEntryData(data: Partial<ForcePreviewEntry>): ForcePreviewEntry {
    const previewEntry: ForcePreviewEntry = {
        instanceId: data.instanceId ?? '',
        timestamp: data.timestamp ?? '',
        type: data.type ?? GameSystem.CLASSIC,
        owned: data.owned ?? true,
        cloud: data.cloud ?? false,
        local: data.local ?? false,
        missing: data.missing ?? false,
        name: data.name ?? '',
        note: data.note || undefined,
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
    getUnitByName: (name: string) => Unit | undefined,
): ForcePreviewUnit {
    const previewUnit: ForcePreviewUnit = {
        unit: getUnitByName(raw.unit),
        destroyed: raw.state?.destroyed ?? false,
    };

    assignForcePreviewUnitField(previewUnit, 'alias', raw.alias);
    assignForcePreviewUnitField(previewUnit, 'skill', raw.skill);
    assignForcePreviewUnitField(previewUnit, 'gunnery', raw.g);
    assignForcePreviewUnitField(previewUnit, 'piloting', raw.p);
    assignForcePreviewUnitField(previewUnit, 'commander', raw.commander);

    return previewUnit;
}

export function createForcePreviewUnitFromSerializedUnit(
    unit: SerializedUnit,
    getUnitByName: (name: string) => Unit | undefined,
): ForcePreviewUnit {
    const previewUnit: ForcePreviewUnit = {
        unit: getUnitByName(unit.unit),
        destroyed: unit.state?.destroyed ?? false,
        lockKey: unit.id,
    };

    assignForcePreviewUnitField(previewUnit, 'alias', unit.alias);
    assignForcePreviewUnitField(previewUnit, 'commander', unit.commander);

    if (isASSerializedUnit(unit)) {
        assignForcePreviewUnitField(previewUnit, 'skill', unit.skill);
        return previewUnit;
    }

    if (!isCBTSerializedUnit(unit)) {
        return previewUnit;
    }

    const [pilot, gunner] = unit.state.crew;
    const gunnery = gunner?.gunnerySkill ?? pilot?.gunnerySkill;
    const piloting = pilot?.pilotingSkill;

    assignForcePreviewUnitField(previewUnit, 'gunnery', gunnery);
    assignForcePreviewUnitField(previewUnit, 'piloting', piloting);
    return previewUnit;
}

export function createForcePreviewUnitFromForceUnit(
    forceUnit: ForceUnit,
    gameSystem: GameSystem,
): ForcePreviewUnit {
    const previewUnit: ForcePreviewUnit = {
        unit: forceUnit.getUnit(),
        destroyed: forceUnit.destroyed,
        lockKey: forceUnit.id,
    };

    assignForcePreviewUnitField(previewUnit, 'alias', forceUnit.alias());
    assignForcePreviewUnitField(previewUnit, 'commander', forceUnit.commander());

    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        const skill = hasLiveAlphaStrikePilotStats(forceUnit)
            ? forceUnit.getPilotSkill()
            : Number(forceUnit.getPilotStats());

        if (Number.isFinite(skill)) {
            assignForcePreviewUnitField(previewUnit, 'skill', skill);
        }
        return previewUnit;
    }

    if (hasLiveClassicPilotStats(forceUnit)) {
        assignForcePreviewUnitField(previewUnit, 'gunnery', forceUnit.gunnerySkill());
        assignForcePreviewUnitField(previewUnit, 'piloting', forceUnit.pilotingSkill());
    }

    return previewUnit;
}

export function createForcePreviewEntry(
    raw: RemoteLoadForceEntry,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): ForcePreviewEntry {
    return createForcePreviewEntryData({
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: raw.owned ?? true,
        instanceId: raw.instanceId,
        name: raw.name,
        note: raw.note || undefined,
        type: raw.type ?? GameSystem.CLASSIC,
        faction: raw.factionId != null ? resolver.getFactionById(raw.factionId) ?? null : null,
        era: raw.eraId != null ? resolver.getEraById(raw.eraId) ?? null : null,
        bv: raw.bv,
        pv: raw.pv,
        timestamp: raw.timestamp,
        groups: createForcePreviewGroups(raw.groups, (name) => resolver.getUnitByName(name)),
    });
}

export function createForcePreviewEntryFromSerializedForce(
    raw: SerializedForce,
    resolver: ForceEntryResolver,
    options: { cloud?: boolean; local?: boolean } = {},
): ForcePreviewEntry {
    return createForcePreviewEntryData({
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: raw.owned ?? true,
        instanceId: raw.instanceId,
        name: raw.name,
        note: raw.note || undefined,
        type: raw.type ?? GameSystem.CLASSIC,
        faction: raw.factionId != null ? resolver.getFactionById(raw.factionId) ?? null : null,
        era: raw.eraId != null ? resolver.getEraById(raw.eraId) ?? null : null,
        bv: raw.bv,
        pv: raw.pv,
        timestamp: raw.timestamp,
        groups: (raw.groups ?? []).map((group) => ({
            name: group.name,
            formationId: group.formationId,
            units: group.units.map((unit) => createForcePreviewUnitFromSerializedUnit(unit, (name) => resolver.getUnitByName(name))),
        })),
    });
}

export function createForcePreviewEntryFromForce(
    force: Force,
    options: { cloud?: boolean; local?: boolean } = {},
): ForcePreviewEntry {
    const groups = force.groups()
        .filter((group) => group.units().length > 0)
        .map((group) => ({
            name: group.name() || undefined,
            formationId: group.activeFormation()?.id,
            units: group.units().map((unit) => createForcePreviewUnitFromForceUnit(unit, force.gameSystem)),
        }));

    return createForcePreviewEntryData({
        cloud: options.cloud ?? false,
        local: options.local ?? false,
        owned: force.owned(),
        instanceId: force.instanceId() ?? '',
        name: force.name,
        note: force.note || undefined,
        type: force.gameSystem,
        faction: force.faction(),
        era: force.era(),
        bv: force.gameSystem === GameSystem.CLASSIC ? force.totalBv() : undefined,
        pv: force.gameSystem === GameSystem.ALPHA_STRIKE ? force.totalBv() : undefined,
        timestamp: force.timestamp ?? '',
        groups,
    });
}

export function getForcePreviewUnitEntries(forcePreview: ForcePreviewEntry): ForcePreviewUnit[] {
    return forcePreview.groups.flatMap((group) => group.units);
}

export function getForcePreviewResolvedUnits(forcePreview: ForcePreviewEntry): Unit[] {
    return getForcePreviewUnitEntries(forcePreview)
        .flatMap((entry) => entry.unit ? [entry.unit] : []);
}

export function getForcePreviewUnitPilotStats(forcePreviewUnit: ForcePreviewUnit, gameSystem: GameSystem): string {
    if (gameSystem === GameSystem.ALPHA_STRIKE) {
        return `${forcePreviewUnit.skill ?? forcePreviewUnit.gunnery ?? '?'}`;
    }

    const gunnery = forcePreviewUnit.gunnery ?? forcePreviewUnit.skill ?? '?';
    if (forcePreviewUnit.unit?.type === 'ProtoMek') {
        return `${gunnery}`;
    }

    const piloting = forcePreviewUnit.piloting ?? '?';
    return `${gunnery}/${piloting}`;
}