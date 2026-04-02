import type { Era } from '../models/eras.model';
import { MULFACTION_MERCENARY, type MULFaction } from '../models/mulfactions.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { Unit } from '../models/units.model';
import { ForceNamerUtil } from './force-namer.util';

function createUnit(id: number, year: number): Unit {
    return {
        id,
        name: `Unit ${id}`,
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
            specials: []
        }
    } as unknown as Unit;
}

function createForceUnit(unit: Unit): ForceUnit {
    return {
        getUnit: () => unit
    } as ForceUnit;
}

function createEra(id: number, from: number, to: number): Era {
    return {
        id,
        name: `Era ${id}`,
        years: { from, to },
        factions: new Set<number>(),
        units: new Set<number>()
    };
}

function createFaction(id: number, name: string, eraUnits: Record<number, number[]>): MULFaction {
    const eras: Record<number, Set<number>> = {};
    for (const [eraId, unitIds] of Object.entries(eraUnits)) {
        eras[Number(eraId)] = new Set(unitIds);
    }

    return {
        id,
        name,
        group: id === MULFACTION_MERCENARY ? 'Mercenary' : 'Inner Sphere',
        img: '',
        eras
    };
}

describe('ForceNamerUtil.pickRandomFaction', () => {
    it('restricts random selection to the explicitly selected era', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const laterEra = createEra(3050, 3050, 3061);
        const unit = createUnit(101, 3055);
        const forceUnits = [createForceUnit(unit)];
        const selectedEraFaction = createFaction(10, 'Selected Era Faction', { 3025: [101] });
        const laterEraFaction = createFaction(11, 'Later Era Faction', { 3050: [101] });

        const result = ForceNamerUtil.pickRandomFaction(
            forceUnits,
            [selectedEraFaction, laterEraFaction],
            [selectedEra, laterEra],
            selectedEra
        );

        expect(result).toBe(selectedEraFaction);
    });

    it('falls back to factions that exist in the selected era when no composition match exists', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3055);
        const forceUnits = [createForceUnit(unit)];
        const selectedEraFaction = createFaction(10, 'Selected Era Faction', { 3025: [202] });
        const outOfEraMercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary', { 3050: [101] });

        spyOn(Math, 'random').and.returnValue(0);

        const result = ForceNamerUtil.pickRandomFaction(
            forceUnits,
            [selectedEraFaction, outOfEraMercenary],
            [selectedEra],
            selectedEra
        );

        expect(result).toBe(selectedEraFaction);
    });
});

describe('ForceNamerUtil.buildFactionDisplayList', () => {
    it('uses the selected era for match percentages when one is provided', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const laterEra = createEra(3050, 3050, 3061);
        const unit = createUnit(101, 3055);
        const forceUnits = [createForceUnit(unit)];
        const selectedEraFaction = createFaction(10, 'Selected Era Faction', { 3025: [101] });
        const laterEraFaction = createFaction(11, 'Later Era Faction', { 3050: [101] });

        const result = ForceNamerUtil.buildFactionDisplayList(
            forceUnits,
            [selectedEraFaction, laterEraFaction],
            [selectedEra, laterEra],
            selectedEra
        );

        expect(result.find(item => item.faction.id === selectedEraFaction.id)?.matchPercentage).toBe(1);
        expect(result.find(item => item.faction.id === selectedEraFaction.id)?.isMatching).toBeTrue();
        expect(result.find(item => item.faction.id === laterEraFaction.id)?.matchPercentage).toBe(0);
        expect(result.find(item => item.faction.id === laterEraFaction.id)?.isMatching).toBeFalse();
    });

    it('keeps using the best eligible era when no era is selected', () => {
        const earlierEra = createEra(3025, 3025, 3049);
        const eligibleEra = createEra(3050, 3050, 3061);
        const unit = createUnit(101, 3055);
        const forceUnits = [createForceUnit(unit)];
        const earlierFaction = createFaction(10, 'Earlier Era Faction', { 3025: [101] });
        const eligibleFaction = createFaction(11, 'Eligible Era Faction', { 3050: [101] });

        const result = ForceNamerUtil.buildFactionDisplayList(
            forceUnits,
            [earlierFaction, eligibleFaction],
            [earlierEra, eligibleEra]
        );

        expect(result.find(item => item.faction.id === earlierFaction.id)?.matchPercentage).toBe(0);
        expect(result.find(item => item.faction.id === eligibleFaction.id)?.matchPercentage).toBe(1);
        expect(result[0].faction.id).toBe(eligibleFaction.id);
    });
});