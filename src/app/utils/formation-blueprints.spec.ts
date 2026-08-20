// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem, Rulebook } from '../models/common.model';
import {
    FORMATION_RUNTIME_DEFINITIONS,
    getFormationBlueprint,
    getFormationDefinition,
    getFormationDefinitions,
} from './formation-blueprints';
import type {
    FormationAssignmentEffectGroup,
    FormationSharedPoolEffectGroup,
    FormationTypeDefinition,
} from './formation-type.model';

function definition(id: string, gameSystem: GameSystem): FormationTypeDefinition {
    const result = getFormationDefinition(id, gameSystem);
    if (!result) throw new Error(`Formation '${id}' not found for ${gameSystem}.`);
    return result;
}

function assignmentGroup(
    id: string,
    gameSystem: GameSystem,
    index = 0,
): FormationAssignmentEffectGroup {
    const group = definition(id, gameSystem).effectGroups?.[index];
    if (!group || group.distribution === 'shared-pool' || group.distribution === 'formation-wide') {
        throw new Error(`Formation '${id}' effect group ${index} is not assignable.`);
    }
    return group;
}

function sharedPoolGroup(id: string, gameSystem: GameSystem): FormationSharedPoolEffectGroup {
    const group = definition(id, gameSystem).effectGroups?.[0];
    if (!group || group.distribution !== 'shared-pool') {
        throw new Error(`Formation '${id}' does not have a shared-pool effect.`);
    }
    return group;
}

describe('formation blueprint game-system rules', () => {
    it('keeps identity common while resolving every formation for both systems', () => {
        const classic = getFormationDefinitions(GameSystem.CLASSIC);
        const alphaStrike = getFormationDefinitions(GameSystem.ALPHA_STRIKE);

        expect(classic.map(item => item.id)).toEqual(FORMATION_RUNTIME_DEFINITIONS.map(item => item.id));
        expect(alphaStrike.map(item => item.id)).toEqual(FORMATION_RUNTIME_DEFINITIONS.map(item => item.id));

        for (const source of FORMATION_RUNTIME_DEFINITIONS) {
            expect('effectDescription' in source).toBeFalse();
            expect('effectGroups' in source).toBeFalse();
            expect('requirements' in source).toBeFalse();
            expect('rulesRef' in source).toBeFalse();

            const classicDefinition = definition(source.id, GameSystem.CLASSIC);
            const alphaStrikeDefinition = definition(source.id, GameSystem.ALPHA_STRIKE);
            expect(classicDefinition.name).toBe(source.name);
            expect(alphaStrikeDefinition.name).toBe(source.name);
            expect(classicDefinition.gameSystem).toBe(GameSystem.CLASSIC);
            expect(alphaStrikeDefinition.gameSystem).toBe(GameSystem.ALPHA_STRIKE);
        }
    });

    it('keeps ASCE references Alpha-Strike-only and preserves intentionally shared CO references', () => {
        for (const source of FORMATION_RUNTIME_DEFINITIONS) {
            const classicRefs = source.classic.rulesRef ?? [];
            const alphaStrikeRefs = source.alphaStrike.rulesRef ?? [];

            expect(classicRefs.some(reference => reference.book === Rulebook.ASCE))
                .withContext(source.id)
                .toBeFalse();

            for (const alphaStrikeCoRef of alphaStrikeRefs.filter(reference => reference.book === Rulebook.CO)) {
                expect(classicRefs)
                    .withContext(source.id)
                    .toContain(alphaStrikeCoRef);
            }

            expect(classicRefs.filter(reference => reference.book !== Rulebook.CO && reference.book !== Rulebook.ASCE))
                .withContext(source.id)
                .toEqual(alphaStrikeRefs.filter(reference => reference.book !== Rulebook.CO && reference.book !== Rulebook.ASCE));
        }
    });

    it('uses the source pages for the weight-specific Battle Lance variants', () => {
        for (const id of ['light-battle-lance', 'medium-battle-lance', 'heavy-battle-lance']) {
            expect(definition(id, GameSystem.CLASSIC).rulesRef)
                .withContext(id)
                .toContain(jasmine.objectContaining({ book: Rulebook.CO, page: 63 }));
            expect(definition(id, GameSystem.ALPHA_STRIKE).rulesRef)
                .withContext(id)
                .toContain(jasmine.objectContaining({ book: Rulebook.ASCE, page: 118 }));
        }
    });

    it('uses the system-specific Assault, Command, and Fire recipient counts', () => {
        expect(assignmentGroup('assault-lance', GameSystem.CLASSIC)).toEqual(jasmine.objectContaining({
            distribution: 'fixed',
            count: 2,
            perTurn: true,
        }));
        expect(assignmentGroup('assault-lance', GameSystem.ALPHA_STRIKE)).toEqual(jasmine.objectContaining({
            distribution: 'half-round-down',
            perTurn: true,
        }));

        for (const id of ['command-lance', 'vehicle-command-lance']) {
            expect(assignmentGroup(id, GameSystem.CLASSIC)).withContext(id).toEqual(jasmine.objectContaining({
                distribution: 'fixed',
                count: 2,
                excludeCommander: true,
            }));
            expect(assignmentGroup(id, GameSystem.ALPHA_STRIKE)).withContext(id).toEqual(jasmine.objectContaining({
                distribution: 'half-round-up',
            }));
        }

        for (const id of ['fire-lance', 'anti-air-lance', 'artillery-fire-lance', 'direct-fire-lance', 'fire-support-lance']) {
            expect(assignmentGroup(id, GameSystem.CLASSIC)).withContext(id).toEqual(jasmine.objectContaining({
                distribution: 'fixed',
                count: 2,
                perTurn: true,
            }));
            expect(assignmentGroup(id, GameSystem.ALPHA_STRIKE)).withContext(id).toEqual(jasmine.objectContaining({
                distribution: 'half-round-down',
                perTurn: true,
            }));
        }
    });

    it('uses the correct Battle Lance Lucky pools', () => {
        const classic = sharedPoolGroup('battle-lance', GameSystem.CLASSIC).sharedPool;
        const alphaStrike = sharedPoolGroup('battle-lance', GameSystem.ALPHA_STRIKE).sharedPool;

        expect(classic).toEqual(jasmine.objectContaining({
            level: { kind: 'fixed', value: 6 },
            totalUsesPerScenario: 6,
            maxUsesPerUnitPerScenario: 4,
            stacksWithIndividualAbility: true,
        }));
        expect(alphaStrike).toEqual(jasmine.objectContaining({
            level: { kind: 'unit-count-plus', offset: 2 },
            maxUsesPerUnitPerScenario: 4,
            stacksWithIndividualAbility: true,
        }));
        expect(alphaStrike.totalUsesPerScenario).toBeUndefined();
    });

    it('models all three Recon variants independently for Classic and Alpha Strike', () => {
        expect(definition('recon-lance', GameSystem.CLASSIC).effectGroups).toEqual([
            { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'fixed', count: 3 },
            { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
        ]);
        expect(definition('recon-lance', GameSystem.ALPHA_STRIKE).effectGroups).toEqual([{
            abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
            selection: 'choose-one',
            distribution: 'all',
        }]);

        expect(definition('heavy-recon-lance', GameSystem.CLASSIC).effectGroups).toEqual([
            { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'fixed', count: 2 },
            { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
        ]);
        expect(definition('heavy-recon-lance', GameSystem.ALPHA_STRIKE).effectGroups).toEqual([{
            abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
            selection: 'choose-one',
            distribution: 'half-round-up',
        }]);

        expect(definition('light-recon-lance', GameSystem.CLASSIC).effectGroups).toEqual([
            { abilityIds: ['eagles_eyes', 'maneuvering_ace'], selection: 'choose-one', distribution: 'all' },
            { abilityIds: ['forward_observer'], selection: 'all', distribution: 'all' },
        ]);
        expect(definition('light-recon-lance', GameSystem.ALPHA_STRIKE).effectGroups).toEqual([{
            abilityIds: ['eagles_eyes', 'forward_observer', 'maneuvering_ace'],
            selection: 'choose-each',
            distribution: 'all',
        }]);
    });

    it('keeps Alpha Strike-only Blood Stalker formation targeting and system-specific Support text', () => {
        for (const id of ['pursuit-lance', 'probe-lance', 'sweep-lance']) {
            expect(definition(id, GameSystem.CLASSIC).effectDescription).withContext(id).not.toContain('enemy formation');
            expect(definition(id, GameSystem.ALPHA_STRIKE).effectDescription).withContext(id).toContain('enemy formation');
        }

        const classicSupport = definition('support-lance', GameSystem.CLASSIC);
        const alphaStrikeSupport = definition('support-lance', GameSystem.ALPHA_STRIKE);

        expect(classicSupport.effectDescription).toContain('For every two units');
        expect(classicSupport.effectDescription).toContain('choice of SPAs');
        expect(classicSupport.effectDescription).toContain('those choices may not change during play');
        expect(alphaStrikeSupport.effectDescription).toContain('Half the Support Lance units (round down)');
        expect(alphaStrikeSupport.effectDescription).toContain('number of copies of each SPA may not exceed');
        expect(alphaStrikeSupport.effectDescription).toContain('they may not be moved during play');

        for (const supportDefinition of [classicSupport, alphaStrikeSupport]) {
            expect(supportDefinition.effectGroups).toBeUndefined();
            expect(supportDefinition.effectDescription).toContain('at least three active units');
            expect(supportDefinition.effectDescription).toContain('not lost if the supported formation falls below its own retention threshold');
            expect(supportDefinition.effectDescription).toContain('SPAs actually granted to its non-commander units');
            expect(supportDefinition.effectDescription).toContain('Tactical Genius is never copied');
        }
    });

    it('uses each system\'s Communications Disruption effect', () => {
        const classicDefinition = definition('electronic-warfare-squadron', GameSystem.CLASSIC);
        const alphaStrikeDefinition = definition('electronic-warfare-squadron', GameSystem.ALPHA_STRIKE);
        const classic = classicDefinition.effectGroups?.[0];
        const alphaStrike = alphaStrikeDefinition.effectGroups?.[0];
        if (classic?.distribution !== 'formation-wide' || alphaStrike?.distribution !== 'formation-wide') {
            throw new Error('Electronic Warfare Squadron must expose a formation-wide ability.');
        }

        for (const effectDescription of [classicDefinition.effectDescription, alphaStrikeDefinition.effectDescription]) {
            expect(effectDescription).toContain('already has Communications Disruption');
            expect(effectDescription).toContain('choose the affected enemy lance or squadron');
            expect(effectDescription).toContain('Ground units can be affected only while');
        }
        expect(classic.formationWideAbilities[0].summary.join(' ')).toContain('Walking, Cruising, or Safe Thrust');
        expect(classic.formationWideAbilities[0].rulesRef).toEqual([{ book: Rulebook.CO, page: 84 }]);
        expect(alphaStrike.formationWideAbilities[0].summary.join(' ')).toContain('reduces Move by');
        expect(alphaStrike.formationWideAbilities[0].rulesRef).toEqual([{ book: Rulebook.ASCE, page: 103 }]);
    });

    it('splits system-specific composition constraints and encodes the corrected squadron and vehicle rules', () => {
        const classicBattle = getFormationBlueprint('battle-lance', GameSystem.CLASSIC);
        const alphaStrikeBattle = getFormationBlueprint('battle-lance', GameSystem.ALPHA_STRIKE);
        expect(classicBattle?.constraints.some(constraint => constraint.kind === 'matched-pairs-min')).toBeTrue();
        expect(alphaStrikeBattle?.constraints.some(constraint => constraint.kind === 'matched-pairs-min')).toBeFalse();

        const classicPursuitMove = getFormationBlueprint('pursuit-lance', GameSystem.CLASSIC)?.constraints
            .find(constraint => constraint.id === 'pursuit-move-percent');
        const alphaStrikePursuitMove = getFormationBlueprint('pursuit-lance', GameSystem.ALPHA_STRIKE)?.constraints
            .find(constraint => constraint.id === 'pursuit-move-percent');
        expect(classicPursuitMove).toEqual(jasmine.objectContaining({ rounding: 'ceil' }));
        expect(alphaStrikePursuitMove).toEqual(jasmine.objectContaining({ rounding: 'normal' }));

        const fireSupportConstraints = getFormationBlueprint('fire-support-squadron', GameSystem.ALPHA_STRIKE)?.constraints ?? [];
        expect(fireSupportConstraints).toContain(jasmine.objectContaining({
            kind: 'all',
            predicate: 'fire-support-or-dogfighter-role',
        }));

        const vehicleCommandConstraint = getFormationBlueprint('vehicle-command-lance', GameSystem.CLASSIC)?.constraints
            .find(constraint => constraint.id === 'vehicle-command-command-pair');
        expect(vehicleCommandConstraint).toEqual(jasmine.objectContaining({
            kind: 'count-min',
            predicate: 'command-heavy-role',
            count: 2,
        }));
    });
});
