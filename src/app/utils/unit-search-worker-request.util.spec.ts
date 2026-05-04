import { GameSystem } from '../models/common.model';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';
import { buildWorkerExecutionQuery } from './unit-search-worker-request.util';

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
});