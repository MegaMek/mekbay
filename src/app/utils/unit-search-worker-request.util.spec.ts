// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../models/common.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';
import { tokensToFilterState } from './semantic-filter.util';
import { buildWorkerExecutionQuery, getWorkerCorpusSnapshot } from './unit-search-worker-request.util';

describe('buildWorkerExecutionQuery', () => {
    it('serializes tri-state boolean filters by converting OR to yes and NOT to no', () => {
        const cases = [
            {
                filterState: {
                    canon: { value: 'or', interactedWith: true },
                    published: { value: 'not', interactedWith: true },
                },
                expectedQuery: 'canon:yes published:no',
                expectedTokens: [
                    jasmine.objectContaining({ field: 'canon', values: ['yes'] }),
                    jasmine.objectContaining({ field: 'published', values: ['no'] }),
                ],
            },
            {
                filterState: {
                    canon: { value: 'not', interactedWith: true },
                    published: { value: 'or', interactedWith: true },
                },
                expectedQuery: 'canon:no published:yes',
                expectedTokens: [
                    jasmine.objectContaining({ field: 'canon', values: ['no'] }),
                    jasmine.objectContaining({ field: 'published', values: ['yes'] }),
                ],
            },
        ] as const;

        for (const testCase of cases) {
            const executionQuery = buildWorkerExecutionQuery({
                effectiveFilterState: testCase.filterState,
                effectiveTextSearch: '',
                gameSystem: GameSystem.CLASSIC,
                totalRangesCache: {},
            });

            expect(executionQuery).toBe(testCase.expectedQuery);

            const parsed = parseSemanticQueryAST(executionQuery, GameSystem.CLASSIC);
            expect(parsed.textSearch).toBe('');
            expect(parsed.tokens).toEqual(testCase.expectedTokens);
        }
    });

    it('escapes plain-text apostrophes before appending worker filters', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {
                type: {
                    value: ['Mek'],
                    interactedWith: true,
                },
            },
            effectiveTextSearch: "Ti Ts'ang",
            gameSystem: GameSystem.CLASSIC,
            totalRangesCache: {},
        });

        expect(executionQuery).toBe("Ti Ts\\'ang type=Mek");

        const parsed = parseSemanticQueryAST(executionQuery, GameSystem.CLASSIC);
        expect(parsed.errors).toEqual([]);
        expect(parsed.textSearch).toBe("Ti Ts'ang");
        expect(parsed.tokens).toEqual([
            jasmine.objectContaining({
                field: 'type',
                operator: '=',
                values: ['Mek'],
            }),
        ]);
    });

    it('serializes weapon-type minimum quantities for worker execution', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {
                weaponType: {
                    value: {
                        AI: { name: 'AI', state: 'or', count: 2 },
                        AE: { name: 'AE', state: 'and', count: 1 },
                    },
                    interactedWith: true,
                },
            },
            effectiveTextSearch: '',
            gameSystem: GameSystem.CLASSIC,
            totalRangesCache: {},
        });

        expect(executionQuery).toContain('weaponType="AI:>=2"');
        expect(executionQuery).toContain('weaponType&=AE');
        expect(parseSemanticQueryAST(executionQuery, GameSystem.CLASSIC).errors).toEqual([]);
    });

    it('serializes contextual Alpha Strike special minima for worker execution', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {
                'as.specials': {
                    value: {
                        AC: {
                            name: 'AC',
                            state: 'or',
                            count: 1,
                            minimumValues: [null, null, 3],
                        },
                    },
                    interactedWith: true,
                },
            },
            effectiveTextSearch: '',
            gameSystem: GameSystem.ALPHA_STRIKE,
            totalRangesCache: {},
        });

        expect(executionQuery).toBe('specials="AC*/*/>=3"');
        expect(parseSemanticQueryAST(executionQuery, GameSystem.ALPHA_STRIKE).tokens).toEqual([
            jasmine.objectContaining({
                field: 'specials',
                operator: '=',
                values: ['AC*/*/>=3'],
            }),
        ]);
        expect(tokensToFilterState(
            parseSemanticQueryAST(executionQuery, GameSystem.ALPHA_STRIKE).tokens,
            GameSystem.ALPHA_STRIKE,
            {},
        )['as.specials']?.value).toEqual({
            AC: {
                name: 'AC',
                state: 'or',
                count: 1,
                minimumValues: [null, null, 3],
            },
        });
    });

    it('preserves repeated semantic clauses instead of flattening them through UI state', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {},
            effectiveTextSearch: '',
            semanticTokenTexts: [
                'specials&="AC*/>=4/*"',
                'specials&="AC*/*/>=3"',
            ],
            gameSystem: GameSystem.ALPHA_STRIKE,
            totalRangesCache: {},
        });

        expect(executionQuery).toBe('specials&="AC*/>=4/*" specials&="AC*/*/>=3"');
        expect(parseSemanticQueryAST(executionQuery, GameSystem.ALPHA_STRIKE).tokens).toEqual([
            jasmine.objectContaining({ operator: '&=', values: ['AC*/>=4/*'] }),
            jasmine.objectContaining({ operator: '&=', values: ['AC*/*/>=3'] }),
        ]);

        expect(tokensToFilterState(
            parseSemanticQueryAST(executionQuery, GameSystem.ALPHA_STRIKE).tokens,
            GameSystem.ALPHA_STRIKE,
            {},
        )['as.specials']?.semanticOnly).toBeTrue();
    });

    it('keeps formatted digit-bearing artillery minima UI-representable', () => {
        const parsed = parseSemanticQueryAST('specials="ARTCM5>=1"', GameSystem.ALPHA_STRIKE);
        const state = tokensToFilterState(parsed.tokens, GameSystem.ALPHA_STRIKE, {})['as.specials'];

        expect(state?.semanticOnly).toBeUndefined();
        expect(state?.value).toEqual({
            ARTCM5: {
                name: 'ARTCM5',
                state: 'or',
                count: 1,
                minimumValues: [1],
            },
        });
    });

    it('serializes plain rulebook selections for worker execution', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {
                rulesRefs: {
                    value: ['TW', 'Shrap01', 'AAA'],
                    interactedWith: true,
                },
            },
            effectiveTextSearch: '',
            gameSystem: GameSystem.CLASSIC,
            totalRangesCache: {},
        });

        expect(executionQuery).toBe('rulesRefs=TW,Shrap01,AAA');
        expect(parseSemanticQueryAST(executionQuery, GameSystem.CLASSIC).tokens).toEqual([
            jasmine.objectContaining({
                field: 'rulesrefs',
                operator: '=',
                values: ['TW', 'Shrap01', 'AAA'],
            }),
        ]);
    });

    it('groups a preserved complex query before applying UI filters', () => {
        const executionQuery = buildWorkerExecutionQuery({
            effectiveFilterState: {
                era: { value: ['Clan Invasion'], interactedWith: true },
            },
            effectiveTextSearch: 'Atlas',
            preservedQuery: 'faction=="Clan Coyote" Atlas OR faction="Federated Suns"',
            gameSystem: GameSystem.CLASSIC,
            totalRangesCache: {},
        });

        expect(executionQuery).toBe(
            '(faction=="Clan Coyote" Atlas OR faction="Federated Suns") era="Clan Invasion"',
        );
        expect(parseSemanticQueryAST(executionQuery, GameSystem.CLASSIC).errors).toEqual([]);
    });
});

describe('getWorkerCorpusSnapshot', () => {
    it('reuses a matching corpus snapshot', () => {
        const unit = createEmptyUnit({ name: 'Cached Unit' });
        const first = getWorkerCorpusSnapshot(
            { version: null, snapshot: null },
            '1:0',
            [unit],
            {},
            {},
        );
        const second = getWorkerCorpusSnapshot(first.cache, '1:0', [unit], {}, {});

        expect(second.snapshot).toBe(first.snapshot);
    });
});
