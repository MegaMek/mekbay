import type { Era } from '../models/eras.model';
import { MULFACTION_MERCENARY, MULFACTION_NONE, type MULFaction } from '../models/mulfactions.model';
import type { ForceUnit } from '../models/force-unit.model';
import type { Unit } from '../models/units.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { ForceNamerUtil } from './force-namer.util';
import type { ForceAvailabilityContext } from './force-availability.util';

function createUnit(id: number, year: number): Unit {
    return createEmptyUnit({
        id,
        name: `Unit ${id}`,
        chassis: 'Test',
        model: 'Unit',
        year,
    });
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

    it('does not pick the synthetic None faction from composition matches', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3025);
        const forceUnits = [createForceUnit(unit)];
        const noneFaction = createFaction(MULFACTION_NONE, 'None', { 3025: [101] });
        const mercenary = createFaction(MULFACTION_MERCENARY, 'Mercenary', { 3025: [202] });

        const result = ForceNamerUtil.pickRandomFaction(
            forceUnits,
            [noneFaction, mercenary],
            [selectedEra]
        );

        expect(result).toBe(mercenary);
    });

    it('does not pick the synthetic None faction from selected-era fallback choices', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3025);
        const forceUnits = [createForceUnit(unit)];
        const noneFaction = createFaction(MULFACTION_NONE, 'None', { 3025: [202] });
        const selectedEraFaction = createFaction(10, 'Selected Era Faction', { 3025: [303] });

        spyOn(Math, 'random').and.returnValue(0);

        const result = ForceNamerUtil.pickRandomFaction(
            forceUnits,
            [noneFaction, selectedEraFaction],
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

    it('uses the provided availability context instead of raw MUL membership', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3055);
        unit.name = 'Shadow Hawk SHD-2H';
        const forceUnits = [createForceUnit(unit)];
        const rawFaction = createFaction(10, 'Raw Faction', { 3025: [101] });
        const contextFaction = createFaction(11, 'Context Faction', { 3025: [] });

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: () => new Set([unit.name]),
            getFactionUnitIds: (faction) => faction.id === contextFaction.id ? new Set([unit.name]) : new Set<string>(),
            getFactionEraUnitIds: (faction) => faction.id === contextFaction.id ? new Set([unit.name]) : new Set<string>(),
        };

        const result = ForceNamerUtil.buildFactionDisplayList(
            forceUnits,
            [rawFaction, contextFaction],
            [selectedEra],
            selectedEra,
            availabilityContext
        );

        expect(result.find(item => item.faction.id === rawFaction.id)?.matchPercentage).toBe(0);
        expect(result.find(item => item.faction.id === contextFaction.id)?.matchPercentage).toBe(1);
        expect(result[0].faction.id).toBe(contextFaction.id);
    });

    it('filters the synthetic None faction out of the selector list', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3025);
        const forceUnits = [createForceUnit(unit)];
        const noneFaction = createFaction(MULFACTION_NONE, 'None', { 3025: [101] });
        const regularFaction = createFaction(10, 'Regular Faction', { 3025: [101] });

        const result = ForceNamerUtil.buildFactionDisplayList(
            forceUnits,
            [noneFaction, regularFaction],
            [selectedEra],
            selectedEra
        );

        expect(result.map(item => item.faction.id)).toEqual([regularFaction.id]);
    });
});

describe('ForceNamerUtil.pickBestFaction', () => {
    it('uses the provided availability context for best-faction selection', () => {
        const selectedEra = createEra(3025, 3025, 3049);
        const unit = createUnit(101, 3025);
        unit.name = 'Phoenix Hawk PXH-1';
        const forceUnits = [createForceUnit(unit)];
        const rawFaction = createFaction(10, 'Raw Faction', { 3025: [101] });
        const contextFaction = createFaction(11, 'Context Faction', { 3025: [] });

        const availabilityContext: ForceAvailabilityContext = {
            source: 'megamek',
            getUnitKey: (candidate) => candidate.name,
            getVisibleEraUnitIds: () => new Set([unit.name]),
            getFactionUnitIds: (faction) => faction.id === contextFaction.id ? new Set([unit.name]) : new Set<string>(),
            getFactionEraUnitIds: (faction) => faction.id === contextFaction.id ? new Set([unit.name]) : new Set<string>(),
        };

        const result = ForceNamerUtil.pickBestFaction(
            forceUnits,
            [rawFaction, contextFaction],
            [selectedEra],
            null,
            availabilityContext
        );

        expect(result).toBe(contextFaction);
    });
});