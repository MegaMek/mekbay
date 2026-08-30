// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AS_SPECIAL_ABILITIES, type ASSpecialAbility } from '../models/as-abilities.model';
import type { AbilitySelection, ASForceUnit } from '../models/as-force-unit.model';
import type { UnitGroup } from '../models/force.model';
import type { ParsedAbility } from '../services/as-ability-lookup.service';
import type { FormationAssignmentPreview } from './formation-ability-assignment.util';
import type { FormationAssignmentEffectGroup, FormationTypeDefinition } from './formation-type.model';
import {
    collectASPrintRulesReferenceData,
    getASPrintRulesReferenceStyles,
    renderASPrintRulesReferencePage,
} from './as-print-reference.util';

describe('Alpha Strike print rules reference', () => {
    it('deduplicates unit specials by definition while retaining every notation and unit', () => {
        const ecm = getSpecial('Electronic Countermeasures');
        const indirectFire = getSpecial('Indirect Fire');
        const lookup = createLookup(text => text === 'ECM' ? ecm : indirectFire);
        const units = [
            createUnit('u1', 'Atlas', 'AS7-D', ['ECM', 'IF1']),
            createUnit('u2', 'Catapult', 'CPLT-C1', ['ECM', 'IF2']),
        ];

        const data = collectASPrintRulesReferenceData([createGroup(units)], lookup, false);

        expect(data.specials.length).toBe(2);
        const ecmReference = data.specials.find(entry => entry.name === 'Electronic Countermeasures')!;
        const indirectFireReference = data.specials.find(entry => entry.name === 'Indirect Fire')!;
        expect(ecmReference.notations).toEqual(['ECM']);
        expect(ecmReference.unitNames).toEqual(['Atlas AS7-D', 'Catapult CPLT-C1']);
        expect(indirectFireReference.notations).toEqual(['IF1', 'IF2']);
        expect(indirectFireReference.unitNames).toEqual(['Atlas AS7-D', 'Catapult CPLT-C1']);
        expect(indirectFireReference.description.length).toBeGreaterThan(0);
    });

    it('uses chassis and model only and deduplicates identical unit designs', () => {
        const ecm = getSpecial('Electronic Countermeasures');
        const firstGroup = createGroup([
            createUnit('u1', 'Akuma', 'AKU-2XK', ['ECM']),
        ], null, 'Battle Company');
        const secondGroup = createGroup([
            createUnit('u2', 'Akuma', 'AKU-2XK', ['ECM']),
            createUnit('u3', 'Akuma', 'AKU-2XK', ['ECM']),
        ], null, 'Second Company');

        const data = collectASPrintRulesReferenceData(
            [firstGroup, secondGroup],
            createLookup(() => ecm),
            false,
        );

        expect(data.specials[0].unitNames).toEqual(['Akuma AKU-2XK']);
    });

    it('combines formation availability, current assignments, and pilot selections into one ability entry', () => {
        const formation: FormationTypeDefinition = {
            id: 'test-formation',
            name: 'Test Formation',
            description: 'A test formation description.',
            effectDescription: 'Choose Marksman or Multi-Tasker for one unit each turn.',
            minUnits: 2,
        };
        const units = [
            createUnit('u1', 'Atlas', 'AS7-D', [], ['marksman']),
            createUnit('u2', 'Catapult', 'CPLT-C1', [], [], ['marksman']),
        ];
        const group = createGroup(units, formation);
        const preview = createFormationPreview(formation);

        const data = collectASPrintRulesReferenceData(
            [group],
            createLookup(() => null),
            false,
            () => preview,
        );

        expect(data.formations.length).toBe(1);
        expect(data.formations[0].formationName).toBe('Test Formation');
        expect(data.formations[0].effectDescription).toContain('Choose Marksman or Multi-Tasker');
        expect(data.formations[0].applications[0].application).toContain('assignments may change each turn');
        expect(data.formations[0].applications[0].currentAssignments).toEqual(['Marksman: Catapult CPLT-C1.']);

        const marksman = data.abilities.find(entry => entry.name === 'Marksman')!;
        expect(data.abilities.filter(entry => entry.name === 'Marksman').length).toBe(1);
        expect(marksman.availableFrom.length).toBe(1);
        expect(marksman.pilotUnits).toEqual(['Atlas AS7-D']);
        expect(marksman.formationUnits).toEqual(['Catapult CPLT-C1']);
        expect(marksman.description.length).toBeGreaterThan(0);
        expect(data.abilities.some(entry => entry.name === 'Multi-Tasker')).toBeTrue();
    });

    it('renders formations, ability application context, and specials in dedicated sections', () => {
        const page = renderASPrintRulesReferencePage({
            formations: [{
                groupName: 'First Lance',
                formationName: 'Assault Lance',
                description: 'Heavy line formation.',
                effectDescription: 'Assign one ability each turn.',
                rulesReferences: [],
                applications: [{
                    abilityNames: ['Marksman'],
                    application: 'One recipient each turn.',
                    currentAssignments: ['Marksman: Atlas AS7-D.'],
                }],
            }],
            abilities: [{
                key: 'pilot:marksman',
                name: 'Marksman',
                kind: 'Pilot ability',
                description: ['A Marksman description.'],
                rulesReferences: [],
                availableFrom: ['Assault Lance'],
                pilotUnits: [],
                formationUnits: ['Atlas AS7-D'],
            }],
            specials: [{
                key: 'known:ecm',
                name: 'Electronic Countermeasures',
                notations: ['ECM'],
                unitNames: ['Atlas AS7-D'],
                description: ['An ECM description.'],
                rulesReference: null,
            }],
        }, 'Example Force');

        expect(page.classList).toContain('as-rules-reference');
        expect(page.textContent).toContain('Formation & Ability Reference');
        expect(page.textContent).toContain('Assign one ability each turn.');
        expect(page.textContent).toContain('Formation assignment: Atlas AS7-D');
        expect(page.textContent).toContain('Electronic Countermeasures');
        expect(page.querySelectorAll('.as-reference-section').length).toBe(3);
        expect(page.querySelector('.as-reference-specials-section')).not.toBeNull();

        const styles = getASPrintRulesReferenceStyles();
        expect(styles).toContain('.as-reference-specials-section');
        expect(styles).toContain('page-break-before: always;');
        expect(styles).toContain('break-before: page;');
    });
});

function createFormationPreview(formation: FormationTypeDefinition): FormationAssignmentPreview {
    const group: FormationAssignmentEffectGroup = {
        abilityIds: ['marksman', 'multi_tasker'],
        selection: 'choose-each',
        distribution: 'fixed',
        count: 1,
        perTurn: true,
    };
    return {
        formation,
        commanderUnitId: null,
        requirementsFiltered: false,
        eligibleUnitIds: ['u1', 'u2'],
        assignmentsByUnitId: new Map([
            ['u1', []],
            ['u2', ['marksman']],
        ]),
        effectPreviews: [{
            descriptor: {
                key: 'test-formation:0',
                sourceFormationId: formation.id,
                sourceFormationName: formation.name,
                sourceFormationDescription: formation.description,
                group,
                abilityIds: ['marksman', 'multi_tasker'],
            },
            candidateUnitIds: ['u1', 'u2'],
            recipientUnitIds: ['u2'],
            assignedByUnitId: new Map([['u2', ['marksman']]]),
            recipientLimit: 1,
            maxPerUnit: 1,
            lockedAbilityId: null,
        }],
        sharedPoolPreviews: [],
        formationWideAbilities: [],
    };
}

function createLookup(resolve: (text: string) => ASSpecialAbility | null): { parseAbility(text: string): ParsedAbility } {
    return {
        parseAbility(text: string): ParsedAbility {
            return { originalText: text, ability: resolve(text) };
        },
    };
}

function getSpecial(name: string): ASSpecialAbility {
    const ability = AS_SPECIAL_ABILITIES.find(entry => entry.name === name);
    if (!ability) throw new Error(`Missing test special: ${name}`);
    return ability;
}

function createUnit(
    id: string,
    chassis: string,
    model: string,
    specials: string[],
    manualAbilities: AbilitySelection[] = [],
    formationAbilities: string[] = [],
): ASForceUnit {
    return {
        id,
        alias: () => undefined,
        manualPilotAbilities: () => manualAbilities,
        formationAbilities: () => formationAbilities,
        getSummary: () => ({
            name: `${chassis} ${model}`,
            chassis,
            model,
            as: { specials },
        }),
    } as unknown as ASForceUnit;
}

function createGroup(
    units: ASForceUnit[],
    formation: FormationTypeDefinition | null = null,
    groupName?: string,
): UnitGroup<ASForceUnit> {
    return {
        units: () => units,
        activeFormation: () => formation,
        groupDisplayName: () => groupName ?? formation?.name ?? 'First Lance',
        formationDisplayName: () => formation?.name ?? null,
        hasValidFormation: () => true,
    } as unknown as UnitGroup<ASForceUnit>;
}

