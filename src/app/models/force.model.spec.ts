import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import { buildEraWarningMessage, getEraUnitValidationSummary } from './force.model';
import type { ForceUnit } from './force-unit.model';
import type { Unit } from './units.model';
import type { ForceAvailabilityContext } from '../utils/force-availability.util';

function createUnit(id: number, name: string, year: number): Unit {
    return {
        id,
        name,
        chassis: 'Test',
        model: 'Unit',
        year,
        weightClass: 'Medium',
        tons: 50,
        offSpeedFactor: 0,
        bv: 0,
        pv: 0,
        cost: 0,
        level: 0,
        techBase: 'Inner Sphere',
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        role: '',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal: 1,
        heat: 0,
        dissipation: 0,
        moveType: 'Tracked',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: {
            TP: 'BM',
            PV: 0,
            SZ: 0,
            TMM: 0,
            MV: '',
            ROLE: '',
            SKILL: 4,
            M: 0,
            S: 0,
            MSL: 0,
            L: 0,
            OV: 0,
            ARM: 0,
            STR: 0,
            specials: [],
        },
    } as unknown as Unit;
}

function createForceUnit(unit: Unit): ForceUnit {
    return {
        getUnit: () => unit,
        getDisplayName: () => unit.name,
    } as ForceUnit;
}

function createEra(id: number, from: number, to: number): Era {
    return {
        id,
        name: `Era ${id}`,
        years: { from, to },
        factions: new Set<number>(),
        units: new Set<number>(),
    };
}

function createFaction(id: number, name: string): Faction {
    return {
        id,
        name,
        group: 'Inner Sphere',
        img: '',
        eras: {},
    };
}

describe('getEraUnitValidationSummary', () => {
    it('treats context-provided extinct units as extinct even when they are absent from visible era units', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const earlierEra = createEra(3000, 3000, 3024);
        const extinctFaction = createFaction(3, 'Extinct');
        const unit = createUnit(101, 'Shadow Hawk SHD-2H', 3020);

        const visibilityByEra = new Map<number, ReadonlySet<string>>([
            [earlierEra.id, new Set([unit.name])],
            [selectedEra.id, new Set()],
        ]);
        const extinctByEra = new Map<number, ReadonlySet<string>>([
            [selectedEra.id, new Set([unit.name])],
        ]);

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: (era) => visibilityByEra.get(era.id) ?? new Set<string>(),
            getFactionUnitIds: () => new Set<string>(),
            getFactionEraUnitIds: (faction, era) => faction.id === extinctFaction.id
                ? (extinctByEra.get(era.id) ?? new Set<string>())
                : new Set<string>(),
        };

        const summary = getEraUnitValidationSummary(
            [createForceUnit(unit)],
            selectedEra,
            [earlierEra, selectedEra],
            extinctFaction,
            availabilityContext
        );

        expect(summary.extinctTrackedUnits).toBe(1);
        expect(summary.extinctTrackedUnitNames).toEqual([unit.name]);
        expect(summary.invalidTrackedUnits).toBe(0);
    });
});

describe('buildEraWarningMessage', () => {
    it('accepts a custom faction-exists predicate for force-scoped availability contexts', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 'Phoenix Hawk PXH-1', 3020);
        const faction = createFaction(11, 'Context Faction');

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: () => new Set([unit.name]),
            getFactionUnitIds: () => new Set<string>(),
            getFactionEraUnitIds: () => new Set<string>(),
        };

        const warning = buildEraWarningMessage(
            [createForceUnit(unit)],
            selectedEra,
            faction,
            [selectedEra],
            null,
            availabilityContext,
            () => true,
        );

        expect(warning).toBeNull();
    });
});