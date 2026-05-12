import type { MegaMekRulesetWhen } from '../models/megamek/rulesets.model';
import {
    matchesMegaMekRulesetCollectionExpression,
    matchesMegaMekRulesetDateExpression,
    matchesMegaMekRulesetStringExpression,
    matchesMegaMekRulesetWhen,
} from './megamek-ruleset-predicate.util';

describe('MegaMek ruleset predicate evaluator', () => {
    it('matches blank string predicates only against missing or blank values', () => {
        expect(matchesMegaMekRulesetStringExpression(undefined, '')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression(null, '')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression('', '')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression('Mek', '')).toBeFalse();
    });

    it('uses comma as AND and pipe as OR for string predicates', () => {
        expect(matchesMegaMekRulesetStringExpression('Mek', 'Mek|Tank')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression('Mek', 'Mek,Tank')).toBeFalse();
        expect(matchesMegaMekRulesetStringExpression('Tank', '!Mek|Tank')).toBeFalse();
        expect(matchesMegaMekRulesetStringExpression('Infantry', '!Mek|Tank')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression(undefined, 'null|Mek')).toBeTrue();
        expect(matchesMegaMekRulesetStringExpression(null, 'null|Mek')).toBeTrue();
    });

    it('uses comma as AND and pipe as OR for collection predicates', () => {
        expect(matchesMegaMekRulesetCollectionExpression(['command', 'recon'], 'command,recon|fire')).toBeTrue();
        expect(matchesMegaMekRulesetCollectionExpression(['command'], 'command,recon|fire')).toBeFalse();
        expect(matchesMegaMekRulesetCollectionExpression(['protomek'], '!protomek')).toBeFalse();
        expect(matchesMegaMekRulesetCollectionExpression([], '')).toBeTrue();
    });

    it('evaluates MegaMek date expressions with OR and AND groups', () => {
        expect(matchesMegaMekRulesetDateExpression(3050, ',3059|3075,')).toBeTrue();
        expect(matchesMegaMekRulesetDateExpression(3068, ',3059|3075,')).toBeFalse();
        expect(matchesMegaMekRulesetDateExpression(3075, ',3059|3075,')).toBeTrue();
        expect(matchesMegaMekRulesetDateExpression(3080, ',3059|3075,')).toBeTrue();

        expect(matchesMegaMekRulesetDateExpression(3040, '3025,3050+3030,3060')).toBeTrue();
        expect(matchesMegaMekRulesetDateExpression(3027, '3025,3050+3030,3060')).toBeFalse();
        expect(matchesMegaMekRulesetDateExpression(3055, '3025,3050+3030,3060')).toBeFalse();
    });

    it('evaluates full when expressions with force descriptor context fields', () => {
        const when: MegaMekRulesetWhen = {
            expressions: {
                ifUnitType: 'Mek|Tank',
                ifRole: 'command,recon|fire',
                ifFlags: 'elite,recon',
                ifAugmented: '0',
                ifTopLevel: '1',
                ifIndex: '!0',
            },
        };

        expect(matchesMegaMekRulesetWhen(when, {
            unitType: 'Mek',
            roles: ['command', 'recon'],
            flags: ['elite', 'recon'],
            augmented: false,
            topLevel: true,
            index: 2,
        })).toBeTrue();

        expect(matchesMegaMekRulesetWhen(when, {
            unitType: 'Mek',
            roles: ['command'],
            flags: ['elite'],
            augmented: false,
            topLevel: true,
            index: 2,
        })).toBeFalse();
    });

    it('normalizes MegaMek constant tokens in raw echelon expressions', () => {
        expect(matchesMegaMekRulesetWhen({
            expressions: { ifEschelon: '%TRINARY%|%BINARY%' },
        }, {
            echelon: 'BINARY',
        })).toBeTrue();
        expect(matchesMegaMekRulesetWhen({
            expressions: { ifEschelon: '%COMPANY%^|%LANCE%^' },
        }, {
            echelon: 'COMPANY^',
        })).toBeTrue();
    });

    it('keeps MegaMek ifName negation semantics for unnamed descriptors', () => {
        const when: MegaMekRulesetWhen = { expressions: { ifName: '!Alpha Galaxy' } };

        expect(matchesMegaMekRulesetWhen(when, {})).toBeTrue();
        expect(matchesMegaMekRulesetWhen(when, { name: 'Alpha Galaxy' })).toBeFalse();
        expect(matchesMegaMekRulesetWhen(when, { name: 'Beta Galaxy' })).toBeTrue();
    });

    it('treats unknown raw predicates as non-matching', () => {
        const when = { expressions: { ifDoesNotExist: 'Mek' } } as unknown as MegaMekRulesetWhen;

        expect(matchesMegaMekRulesetWhen(when, { unitType: 'Mek' })).toBeFalse();
    });

    it('uses raw expressions instead of lossy normalized date and blank fields', () => {
        const when: MegaMekRulesetWhen = {
            expressions: {
                ifDateBetween: ',3059|3075,',
                ifUnitType: '',
            },
            toYear: 3059,
            unitTypes: [],
        };

        expect(matchesMegaMekRulesetWhen(when, { year: 3075 })).toBeTrue();
        expect(matchesMegaMekRulesetWhen(when, { year: 3075, unitType: 'Mek' })).toBeFalse();
    });

    it('keeps normalized fallback behavior for pre-v3 rulesets', () => {
        const when: MegaMekRulesetWhen = {
            unitTypes: ['Mek'],
            flags: ['!forbidden'],
        };

        expect(matchesMegaMekRulesetWhen(when, { unitType: 'mek', flags: [] })).toBeTrue();
        expect(matchesMegaMekRulesetWhen(when, { unitType: 'Tank', flags: [] })).toBeFalse();
        expect(matchesMegaMekRulesetWhen(when, { unitType: 'Mek', flags: ['FORBIDDEN'] })).toBeFalse();
    });
});