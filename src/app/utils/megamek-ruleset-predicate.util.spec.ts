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
            echelon: 'COMPANY',
            augmented: true,
        })).toBeTrue();
        expect(matchesMegaMekRulesetWhen({
            expressions: { ifEschelon: '%COMPANY%^|%LANCE%^' },
        }, {
            echelon: 'COMPANY',
            augmented: false,
        })).toBeFalse();
    });

    it('evaluates every raw predicate for both acceptance and rejection', () => {
        const cases: Array<{
            label: string;
            when: MegaMekRulesetWhen;
            passingContext: Parameters<typeof matchesMegaMekRulesetWhen>[1];
            failingContext: Parameters<typeof matchesMegaMekRulesetWhen>[1];
        }> = [
            {
                label: 'ifUnitType',
                when: { expressions: { ifUnitType: 'Mek|Tank' } },
                passingContext: { unitType: 'Mek' },
                failingContext: { unitType: 'AeroSpaceFighter' },
            },
            {
                label: 'ifWeightClass',
                when: { expressions: { ifWeightClass: 'H|A' } },
                passingContext: { weightClass: 'H' },
                failingContext: { weightClass: 'M' },
            },
            {
                label: 'ifRating',
                when: { expressions: { ifRating: 'A|B' } },
                passingContext: { rating: 'B' },
                failingContext: { rating: 'C' },
            },
            {
                label: 'ifEschelon',
                when: { expressions: { ifEschelon: '%COMPANY%^|%LANCE%' } },
                passingContext: { echelon: 'COMPANY', augmented: true },
                failingContext: { echelon: 'COMPANY', augmented: false },
            },
            {
                label: 'ifFormation',
                when: { expressions: { ifFormation: 'assault|strike' } },
                passingContext: { formation: 'strike' },
                failingContext: { formation: 'cavalry' },
            },
            {
                label: 'ifRole',
                when: { expressions: { ifRole: 'command,recon|fire' } },
                passingContext: { roles: ['command', 'recon'] },
                failingContext: { roles: ['command', 'urban'] },
            },
            {
                label: 'ifMotive',
                when: { expressions: { ifMotive: 'tracked|wheeled' } },
                passingContext: { motives: ['tracked'] },
                failingContext: { motives: ['hover'] },
            },
            {
                label: 'ifAugmented',
                when: { expressions: { ifAugmented: '1' } },
                passingContext: { augmented: true },
                failingContext: { augmented: false },
            },
            {
                label: 'ifDateBetween',
                when: { expressions: { ifDateBetween: '3025,3050|3075,' } },
                passingContext: { year: 3039 },
                failingContext: { year: 3060 },
            },
            {
                label: 'ifYearBetween',
                when: { expressions: { ifYearBetween: ',3050' } },
                passingContext: { year: 3025 },
                failingContext: { year: 3067 },
            },
            {
                label: 'ifTopLevel',
                when: { expressions: { ifTopLevel: '1' } },
                passingContext: { topLevel: true },
                failingContext: { topLevel: false },
            },
            {
                label: 'ifName',
                when: { expressions: { ifName: 'Alpha Galaxy|Beta Galaxy' } },
                passingContext: { name: 'Beta Galaxy' },
                failingContext: { name: 'Gamma Galaxy' },
            },
            {
                label: 'ifFaction',
                when: { expressions: { ifFaction: 'CC|FS' } },
                passingContext: { factionKey: 'CC' },
                failingContext: { factionKey: 'DC' },
            },
            {
                label: 'ifFlags',
                when: { expressions: { ifFlags: 'elite,recon|command' } },
                passingContext: { flags: ['elite', 'command'] },
                failingContext: { flags: ['elite'] },
            },
            {
                label: 'ifIndex',
                when: { expressions: { ifIndex: '!0' } },
                passingContext: { index: 2 },
                failingContext: { index: 0 },
            },
        ];

        for (const testCase of cases) {
            expect(matchesMegaMekRulesetWhen(testCase.when, testCase.passingContext)).withContext(`${testCase.label} accepts`).toBeTrue();
            expect(matchesMegaMekRulesetWhen(testCase.when, testCase.failingContext)).withContext(`${testCase.label} rejects`).toBeFalse();
        }
    });

    it('evaluates every normalized fallback predicate for both acceptance and rejection', () => {
        const baseWhen: MegaMekRulesetWhen = {
            fromYear: 3025,
            toYear: 3050,
            unitTypes: ['Mek'],
            weightClasses: ['H'],
            ratings: ['A'],
            formations: ['assault'],
            roles: ['command'],
            motives: ['tracked'],
            factions: ['CC'],
            names: ['Warhammer WHM-6R'],
            indexes: ['2'],
            topLevel: true,
            augmented: true,
            flags: ['elite'],
            echelons: [{ code: 'COMPANY', augmented: true }],
        };
        const passingContext = {
            year: 3039,
            unitType: 'Mek',
            weightClass: 'H',
            rating: 'A',
            formation: 'assault',
            role: 'command',
            motive: 'tracked',
            factionKey: 'CC',
            name: 'Warhammer WHM-6R',
            index: 2,
            topLevel: true,
            augmented: true,
            flags: ['elite'],
            echelon: 'COMPANY',
        };

        expect(matchesMegaMekRulesetWhen(baseWhen, passingContext)).toBeTrue();

        const failingContexts = [
            { year: 3060 },
            { unitType: 'Tank' },
            { weightClass: 'M' },
            { rating: 'B' },
            { formation: 'strike' },
            { role: 'recon' },
            { motive: 'hover' },
            { factionKey: 'FS' },
            { name: 'Locust LCT-1V' },
            { index: 3 },
            { topLevel: false },
            { augmented: false },
            { flags: ['green'] },
            { echelon: 'LANCE' },
        ];

        for (const failingPatch of failingContexts) {
            expect(matchesMegaMekRulesetWhen(baseWhen, { ...passingContext, ...failingPatch })).withContext(JSON.stringify(failingPatch)).toBeFalse();
        }
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