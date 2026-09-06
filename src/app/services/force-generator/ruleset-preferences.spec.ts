// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    applyForceNodeToProfile,
    createRulesetTemplate,
    getRulesetMatchReasons,
    getRulesetMatchScore,
    type RulesetProfile,
} from './ruleset-preferences';

function profile(): RulesetProfile {
    return {
        requiredUnitTypes: new Set(),
        preferredUnitTypes: new Set(),
        preferredWeightClasses: new Set(),
        preferredRoles: new Set(),
        preferredMotives: new Set(),
        templates: [],
        explanationNotes: [],
    };
}

describe('ruleset preferences', () => {
    it('requires only positive force-node unit types and combines assignments with the selected option', () => {
        const preferences = profile();
        spyOn(Math, 'random').and.returnValue(0.9);
        applyForceNodeToProfile(preferences, {
            when: { unitTypes: [' Mek ', '!Tank'], roles: ['Brawler', '!Scout'] },
            assign: { unitTypes: ['Aero'], motives: ['Jump'] },
            weightClass: {
                options: [
                    { weight: 1, weightClasses: ['light'] },
                    { weight: 3, weightClasses: ['Heavy'], when: { roles: ['Brawler', '!Scout'] }, assign: { motives: ['Tracked'] } },
                    { weight: 100, weightClasses: ['medium'], when: { factions: ['DC'] } },
                ],
            },
        }, { role: 'Brawler', factionKey: 'FS' });

        expect([...preferences.requiredUnitTypes]).toEqual(['mek']);
        expect([...preferences.preferredUnitTypes]).toEqual(['mek', 'aero']);
        expect([...preferences.preferredRoles]).toEqual(['brawler']);
        expect([...preferences.preferredWeightClasses]).toEqual(['heavy']);
        expect([...preferences.preferredMotives]).toEqual(['jump', 'tracked']);
    });

    it('skips unmatched groups and samples matching rule groups in field order', () => {
        const preferences = profile();
        const random = spyOn(Math, 'random').and.returnValues(0.9, 0.1);
        applyForceNodeToProfile(preferences, {
            unitType: { when: { factions: ['DC'] }, options: [{ unitTypes: ['Tank'] }, { unitTypes: ['Aero'] }] },
            ruleGroup: [
                { when: { factions: ['DC'] }, role: { options: [{ roles: ['Scout'] }] } },
                {
                    when: { factions: ['FS'] },
                    weightClass: { options: [{ weightClasses: ['light'] }, { weightClasses: ['heavy'] }] },
                    role: { options: [{ roles: ['Brawler'] }, { roles: ['Scout'] }] },
                },
            ],
        }, { factionKey: 'FS' });

        expect(preferences.preferredUnitTypes.size).toBe(0);
        expect([...preferences.preferredWeightClasses]).toEqual(['heavy']);
        expect([...preferences.preferredRoles]).toEqual(['brawler']);
        expect(random).toHaveBeenCalledTimes(2);
    });

    it('combines child and assigned template preferences without duplicating normalized values', () => {
        const template = createRulesetTemplate({ unitTypes: [' Mek '], roles: ['Scout'], assign: { unitTypes: ['mek'], weightClasses: ['Light'], motives: ['Jump'] } });

        expect(template).toEqual({ unitTypes: new Set(['mek']), roles: new Set(['scout']), weightClasses: new Set(['light']), motives: new Set(['jump']) });
        expect(createRulesetTemplate({ echelon: { code: 'LANCE' } })).toBeNull();
    });
});

describe('ruleset ranking', () => {
    it('is neutral without a profile or when a candidate lacks an optional preference', () => {
        const candidate = { megaMekUnitType: 'Mek' };
        const preferences = profile();
        preferences.preferredWeightClasses.add('heavy');
        preferences.preferredRoles.add('brawler');
        preferences.preferredMotives.add('jump');
        preferences.templates.push(createRulesetTemplate({ roles: ['Brawler'] })!);

        expect(getRulesetMatchScore(candidate, null)).toBe(1);
        expect(getRulesetMatchScore(candidate, preferences)).toBe(1);
        expect(getRulesetMatchReasons(candidate, null)).toEqual([]);
    });

    it('multiplies preference weights and takes the strongest template without stacking duplicates', () => {
        const preferences = profile();
        applyForceNodeToProfile(preferences, { assign: { unitTypes: ['Mek'], weightClasses: ['heavy'], roles: ['Brawler'], motives: ['Jump'] } }, {});
        const strongest = createRulesetTemplate({ unitTypes: ['Mek'], weightClasses: ['heavy'], roles: ['Brawler'], motives: ['Jump'] })!;
        preferences.templates.push(createRulesetTemplate({ unitTypes: ['Mek'] })!, strongest, strongest);
        const candidate = { megaMekUnitType: 'MEK', megaMekWeightClass: 'Heavy', role: 'brawler', motive: 'jump' };

        expect(getRulesetMatchScore(candidate, preferences)).toBeCloseTo(1.6 * 1.3 * 1.2 * 1.1 * 1.5 * 1.25 * 1.15 * 1.05, 12);
        expect(getRulesetMatchReasons(candidate, preferences)).toEqual(['unit type MEK', 'weight Heavy', 'role brawler']);
    });

    it('penalizes mismatched preferences but never applies an additional penalty from child templates', () => {
        const preferences = profile();
        applyForceNodeToProfile(preferences, { assign: { unitTypes: ['Aero'], weightClasses: ['light'], roles: ['Scout'], motives: ['Tracked'] } }, {});
        preferences.templates.push(createRulesetTemplate({ unitTypes: ['Aero'], roles: ['Scout'] })!);
        const candidate = { megaMekUnitType: 'Mek', megaMekWeightClass: 'Heavy', role: 'Brawler', motive: 'Jump' };

        expect(getRulesetMatchScore(candidate, preferences)).toBeCloseTo(0.75 * 0.9 * 0.95 * 0.98, 12);
        expect(getRulesetMatchReasons(candidate, preferences)).toEqual([]);
    });

    it('reports a child-template match when any one of its preferences matches', () => {
        const preferences = profile();
        preferences.templates.push(createRulesetTemplate({ unitTypes: ['Aero'], roles: ['Brawler'] })!);

        expect(getRulesetMatchReasons({ megaMekUnitType: 'Mek', role: 'Brawler' }, preferences)).toEqual(['matched a child template']);
    });
});
