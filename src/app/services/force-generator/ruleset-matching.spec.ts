// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { MegaMekRulesetForceNode, MegaMekRulesetRecord } from '../../models/megamek/rulesets.model';
import { findMatchingForceNode, matchesRulesetWhen, resolvePreferredForceNode, type RulesetMatchContext } from './ruleset-matching';

function ruleset(forces: MegaMekRulesetForceNode[], forceIndexesByEchelon: Record<string, number[]> = {}): MegaMekRulesetRecord {
    return { factionKey: 'FS', forces, forceCount: forces.length, indexes: { forceIndexesByEchelon } };
}

describe('ruleset conditions', () => {
    it('requires a year for bounded conditions and includes both endpoints', () => {
        const when = { fromYear: 3000, toYear: 3050 };
        expect(matchesRulesetWhen(when, {})).toBeFalse();
        expect(matchesRulesetWhen(when, { year: 2999 })).toBeFalse();
        expect(matchesRulesetWhen(when, { year: 3000 })).toBeTrue();
        expect(matchesRulesetWhen(when, { year: 3050 })).toBeTrue();
        expect(matchesRulesetWhen(when, { year: 3051 })).toBeFalse();
    });

    it('normalizes string values, gives exclusions priority, and allows missing values only without positive requirements', () => {
        expect(matchesRulesetWhen({ roles: [' Brawler ', '!Scout'] }, { role: 'BRAWLER' })).toBeTrue();
        expect(matchesRulesetWhen({ roles: ['Scout', '!SCOUT'] }, { role: 'scout' })).toBeFalse();
        expect(matchesRulesetWhen({ roles: ['!Scout'] }, {})).toBeTrue();
        expect(matchesRulesetWhen({ roles: ['Brawler', '!Scout'] }, {})).toBeFalse();
        expect(matchesRulesetWhen({ unitTypes: ['Mek'], factions: ['!FS'] }, { unitType: 'mek', factionKey: 'fs' })).toBeFalse();
    });

    it('accepts any required flag but rejects any forbidden flag', () => {
        const when = { flags: ['Elite', 'Guard', '!Salvage'] };
        expect(matchesRulesetWhen(when, { flags: [' GUARD ', 'other'] })).toBeTrue();
        expect(matchesRulesetWhen(when, { flags: ['elite', 'SALVAGE'] })).toBeFalse();
        expect(matchesRulesetWhen(when, { flags: ['other'] })).toBeFalse();
        expect(matchesRulesetWhen(when, {})).toBeFalse();
        expect(matchesRulesetWhen({ flags: ['!Salvage'] }, {})).toBeTrue();
    });

    it('defaults boolean conditions to false and requires an exact echelon code', () => {
        expect(matchesRulesetWhen({ topLevel: false, augmented: false }, {})).toBeTrue();
        expect(matchesRulesetWhen({ topLevel: true }, {})).toBeFalse();
        expect(matchesRulesetWhen({ augmented: true }, {})).toBeFalse();
        expect(matchesRulesetWhen({ echelons: [{ code: 'LANCE', augmented: false }] }, { echelon: 'LANCE' })).toBeTrue();
        expect(matchesRulesetWhen({ echelons: [{ code: 'LANCE', augmented: true }] }, { echelon: 'LANCE' })).toBeFalse();
        expect(matchesRulesetWhen({ echelons: [{ code: 'LANCE' }] }, { echelon: 'lance' })).toBeFalse();
        expect(matchesRulesetWhen({ echelons: [{ code: 'LANCE' }] }, {})).toBeFalse();
    });
});

describe('preferred force-node selection', () => {
    it('finds exact matches throughout the inheritance chain before accepting structural matches', () => {
        const structural: MegaMekRulesetForceNode = { when: { unitTypes: ['Mek'], roles: ['Scout'] } };
        const exact: MegaMekRulesetForceNode = { when: { unitTypes: ['Mek'], roles: ['Brawler'] } };
        const selected = resolvePreferredForceNode([ruleset([structural]), ruleset([exact])], { unitType: 'Mek', role: 'Brawler' }, 'first');

        expect(selected.forceNode).toBe(exact);
    });

    it('relaxes unit preferences while retaining structural conditions', () => {
        const wrongFaction: MegaMekRulesetForceNode = { when: { factions: ['DC'] } };
        const wrongType: MegaMekRulesetForceNode = { when: { unitTypes: ['Tank'] } };
        const structural: MegaMekRulesetForceNode = {
            when: { unitTypes: ['Mek'], factions: ['FS'], weightClasses: ['heavy'], roles: ['Scout'], motives: ['tracked'], flags: ['elite'] },
        };
        const selected = resolvePreferredForceNode([ruleset([wrongFaction, wrongType, structural])], { unitType: 'Mek', factionKey: 'FS' }, 'first');

        expect(selected.forceNode).toBe(structural);
        expect(selected.matchContext.role).toBe('Scout');
        expect(selected.matchContext.weightClass).toBe('heavy');
        expect(selected.matchContext.motive).toBe('tracked');
    });

    it('keeps a structural match at the requested echelon ahead of exact fallback matches', () => {
        const fallback: MegaMekRulesetForceNode = {};
        const requested: MegaMekRulesetForceNode = { echelon: { code: 'LANCE' }, when: { roles: ['Scout'] } };
        const selected = resolvePreferredForceNode([ruleset([fallback, requested], { LANCE: [1] })], { echelon: 'LANCE' }, 'first');

        expect(selected.forceNode).toBe(requested);
    });

    it('drops the requested echelon only after both matching passes fail and derives the selected node context', () => {
        const wrongType: MegaMekRulesetForceNode = { when: { unitTypes: ['Tank'] } };
        const fallback: MegaMekRulesetForceNode = { echelon: { code: 'COMPANY', augmented: false }, when: { roles: ['!Scout', 'Brawler'] } };
        const original: RulesetMatchContext = { echelon: 'LANCE', unitType: 'Mek', augmented: true, flags: ['guard'] };
        const selected = resolvePreferredForceNode([ruleset([wrongType, fallback], { LANCE: [0] })], original, 'first');

        expect(selected.forceNode).toBe(fallback);
        expect(selected.matchContext).toEqual({ ...original, echelon: 'COMPANY', augmented: false, weightClass: undefined, role: 'Brawler', motive: undefined });
        expect(original.echelon).toBe('LANCE');
    });

    it('returns the original context when no node matches, including after echelon fallback', () => {
        const context: RulesetMatchContext = { echelon: 'LANCE', unitType: 'Mek' };
        const selected = resolvePreferredForceNode([ruleset([{ when: { unitTypes: ['Tank'] } }])], context, 'first');

        expect(selected.forceNode).toBeUndefined();
        expect(selected.matchContext).toBe(context);
    });

    it('uses all nodes when the echelon index has no valid entries', () => {
        const node: MegaMekRulesetForceNode = { echelon: { code: 'LANCE' } };
        expect(resolvePreferredForceNode([ruleset([node], { LANCE: [99] })], { echelon: 'LANCE' }, 'first').forceNode).toBe(node);
    });

    it('samples only the first matching ruleset and does not draw randomness for preview or singleton selections', () => {
        const first: MegaMekRulesetForceNode = { weight: 1 };
        const second: MegaMekRulesetForceNode = { weight: 3 };
        const inherited: MegaMekRulesetForceNode = { weight: 100 };
        const random = spyOn(Math, 'random').and.returnValue(0.5);
        const chain = [ruleset([first, second]), ruleset([inherited])];

        expect(resolvePreferredForceNode(chain, {}, 'first').forceNode).toBe(first);
        expect(resolvePreferredForceNode([ruleset([first])], {}, 'weighted').forceNode).toBe(first);
        expect(random).not.toHaveBeenCalled();
        expect(resolvePreferredForceNode(chain, {}, 'weighted').forceNode).toBe(second);
        expect(random).toHaveBeenCalledTimes(1);
    });

    it('uses a uniform draw when all matching node weights are nonpositive', () => {
        const first: MegaMekRulesetForceNode = { weight: -1 };
        const second: MegaMekRulesetForceNode = { weight: 0 };
        spyOn(Math, 'random').and.returnValue(0.75);

        expect(resolvePreferredForceNode([ruleset([first, second])], {}, 'weighted').forceNode).toBe(second);
    });
});

describe('child force-node lookup', () => {
    it('requires the actual node echelon before falling back and preserves full preference matching', () => {
        const wrongEchelon: MegaMekRulesetForceNode = { echelon: { code: 'COMPANY' } };
        const wrongRole: MegaMekRulesetForceNode = { echelon: { code: 'LANCE' }, when: { roles: ['Scout'] } };
        const matching: MegaMekRulesetForceNode = { echelon: { code: 'LANCE' }, when: { roles: ['Brawler'] } };

        expect(findMatchingForceNode([ruleset([wrongEchelon, wrongRole, matching])], { echelon: 'LANCE', role: 'Brawler' })).toBe(matching);
        expect(findMatchingForceNode([ruleset([wrongRole])], { echelon: 'LANCE', role: 'Brawler' })).toBeUndefined();
        expect(findMatchingForceNode([ruleset([wrongEchelon])], { echelon: 'LANCE' })).toBe(wrongEchelon);
    });
});
