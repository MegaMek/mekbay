import type { Injector } from '@angular/core';
import { GameSystem } from './common.model';
import type { Era } from './eras.model';
import type { Faction } from './factions.model';
import { Force, buildEraWarningMessage, getEraUnitValidationSummary } from './force.model';
import type { ForceUnit } from './force-unit.model';
import type { SerializedForce, SerializedUnit } from './force-serialization';
import type { Unit } from './units.model';
import type { DataService } from '../services/data.service';
import type { UnitInitializerService } from '../services/unit-initializer.service';
import type { ForceAvailabilityContext } from '../utils/force-availability.util';
import { NO_FORMATION } from '../utils/formation-type.model';

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

function createSerializedUnit(id: string): SerializedUnit {
    return {
        id,
        unit: 'Test Unit',
        state: {
            modified: false,
            destroyed: false,
            shutdown: false,
        },
    };
}

function createStubDeserializedUnit(data: SerializedUnit): ForceUnit {
    const unit = createUnit(1, data.unit, 3025);

    return {
        id: data.id,
        destroy: () => undefined,
        update: () => undefined,
        getUnit: () => unit,
        getDisplayName: () => unit.name,
        serialize: () => data,
    } as unknown as ForceUnit;
}

class TestForce extends Force<ForceUnit> {
    override gameSystem = GameSystem.CLASSIC;

    constructor() {
        const dataService = {
            getFactionById: () => null,
            getEraById: () => null,
            getEras: () => [],
        } as unknown as DataService;
        const unitInitializer = {} as UnitInitializerService;
        const injector = {
            get: () => ({
                warn: () => undefined,
                error: () => undefined,
            }),
        } as unknown as Injector;

        super('Test Force', dataService, unitInitializer, injector);
    }

    protected override createForceUnit(_unit: Unit): ForceUnit {
        throw new Error('Not used in TestForce');
    }

    protected override deserializeForceUnit(data: SerializedUnit): ForceUnit {
        return createStubDeserializedUnit(data);
    }

    protected override transferPilotData(_fromUnit: ForceUnit, _toUnit: ForceUnit): void {
    }

    protected override sanitizeForceData(data: SerializedForce): SerializedForce {
        return data;
    }

    protected override deserializeFrom(_serialized: SerializedForce): Force<ForceUnit> {
        throw new Error('Not used in TestForce');
    }

    loadSerialized(data: SerializedForce): void {
        this.populateFromSerialized(data);
    }
}

function createSerializedForce(groups: SerializedForce['groups']): SerializedForce {
    return {
        version: 1,
        timestamp: new Date().toISOString(),
        instanceId: 'force-id',
        type: GameSystem.CLASSIC,
        name: 'Test Force',
        groups: groups ?? [],
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

describe('Force formation deserialization', () => {
    it('loads locked groups without a formation id as NO_FORMATION', () => {
        const force = new TestForce();

        force.loadSerialized(createSerializedForce([
            {
                id: 'group-1',
                formationLock: true,
                units: [],
            },
        ]));

        expect(force.groups()[0].formation()).toBe(NO_FORMATION);
        expect(force.groups()[0].formationLock).toBeTrue();
    });

    it('updates existing groups without a formation id to NO_FORMATION when locked', () => {
        const force = new TestForce();

        force.loadSerialized(createSerializedForce([
            {
                id: 'group-1',
                units: [],
            },
        ]));

        force.update(createSerializedForce([
            {
                id: 'group-1',
                formationLock: true,
                units: [createSerializedUnit('unit-1')],
            },
        ]));

        expect(force.groups()[0].formation()).toBe(NO_FORMATION);
        expect(force.groups()[0].formationLock).toBeTrue();
    });
});