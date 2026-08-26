// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UNIT_SUMMARY_VERSION, type UnitSummary } from '../models/unit-summary.model';
import {
    CBT_FORCE_MINIMUM_WRITER_VERSION,
    CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
    asForceId,
    emptyRuntimeHistory,
    type SerializedCBTForceV2,
} from '../models/runtime/persistence-v2';
import { asStateRevision } from '../models/runtime/runtime-state';
import { getUnitTechBaseDisplay } from '../models/tech.model';
import { uuidv4 } from '../utils/uuid.util';

type TestAlphaStrikeOverrides = Partial<Omit<UnitSummary['as'], 'dmg'>> & {
    dmg?: Partial<UnitSummary['as']['dmg']>;
};

export type TestUnitOverrides = Partial<Omit<UnitSummary, 'as' | 'uuid'>> & {
    uuid?: string;
    /** Hostile transport-only field used to prove persisted summaries reject prose. */
    fluff?: unknown;
    as?: TestAlphaStrikeOverrides;
};

export function createEmptyCBTForceForTest(
    forceId: string = 'force:test',
    revision: number = 0,
): SerializedCBTForceV2 {
    const stateRevision = asStateRevision(revision);
    return {
        schemaVersion: CBT_FORCE_PERSISTENCE_SCHEMA_VERSION,
        minimumWriterVersion: CBT_FORCE_MINIMUM_WRITER_VERSION,
        forceId: asForceId(forceId),
        forceRevision: stateRevision,
        scenarioRules: { schemaVersion: 1, values: { id: 'test' } },
        history: emptyRuntimeHistory(),
        units: [],
        roster: { schemaVersion: 1, groups: [] },
        encounter: {
            encounterRevision: stateRevision,
            state: { schemaVersion: 2, encounterRevision: stateRevision, facts: [] },
        },
        restoration: { schemaVersion: 2, unresolvedEncounter: [] },
    };
}

function createEmptyAlphaStrikeStats(overrides: TestAlphaStrikeOverrides = {}): UnitSummary['as'] {
    const base: UnitSummary['as'] = {
        TP: 'BM',
        PV: 0,
        SZ: 0,
        TMM: 0,
        usesOV: false,
        OV: 0,
        MV: '0',
        MVm: {},
        MVp: '',
        usesTh: false,
        Th: 0,
        Arm: 0,
        Str: 0,
        specials: [],
        dmg: {
            dmgS: '0',
            dmgM: '0',
            dmgL: '0',
            dmgE: '0',
        },
        usesE: false,
        usesArcs: false,
    };

    return {
        ...base,
        ...overrides,
        MVm: overrides.MVm ? { ...overrides.MVm } : base.MVm,
        specials: overrides.specials ? [...overrides.specials] : base.specials,
        dmg: {
            ...base.dmg,
            ...overrides.dmg,
        },
    };
}

export function createEmptyUnit(overrides: TestUnitOverrides = {}): UnitSummary {
    const { as: asOverrides, uuid, fluff, ...unitOverrides } = overrides;
    const unit: UnitSummary = {
        uuid: (uuid ?? uuidv4()) as UnitSummary['uuid'],
        provider: 'mm-data' as UnitSummary['provider'],
        origin: 'megamek',
        hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA',
        summaryVersion: UNIT_SUMMARY_VERSION,
        loadIssues: [],
        name: 'Test Unit',
        id: -1,
        chassis: 'Test',
        baseChassis: 'Test',
        model: 'TST-1',
        year: 3151,
        weightClass: 'Medium',
        tons: 50,
        loadoutTons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 'Introductory',
        techBase: 'Inner Sphere',
        mixed: false,
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        entityType: 'Mek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        published: [],
        rulesRefs: [],
        canon: true,
        canAntiMech: false,
        role: '',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal: 1,
        squads: 0,
        squadSize: 0,
        heat: 0,
        dissipation: 0,
        moveType: 'Tracked',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        jump2: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        as: createEmptyAlphaStrikeStats(asOverrides),
        _searchKey: '',
        _displayType: '',
        _techBaseDisplay: 'Inner Sphere',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...unitOverrides,
    };

    if (fluff !== undefined) {
        (unit as UnitSummary & { fluff?: unknown }).fluff = fluff;
    }

    unit._techBaseDisplay = getUnitTechBaseDisplay(unit);

    unit.source = unitOverrides.source ? [...unitOverrides.source] : [];
    unit.published = unitOverrides.published ? [...unitOverrides.published] : [];
    unit.rulesRefs = unitOverrides.rulesRefs
        ? unitOverrides.rulesRefs.map(combination => [...combination])
        : [];
    unit.comp = unitOverrides.comp ? [...unitOverrides.comp] : [];
    unit.quirks = unitOverrides.quirks ? [...unitOverrides.quirks] : [];
    unit.features = unitOverrides.features ? [...unitOverrides.features] : [];
    unit._nameTags = unitOverrides._nameTags ? [...unitOverrides._nameTags] : [];
    unit._chassisTags = unitOverrides._chassisTags ? [...unitOverrides._chassisTags] : [];

    return unit;
}
