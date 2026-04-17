import { GameSystem } from '../models/common.model';
import { parseSemanticQueryAST } from './semantic-filter-ast.util';
import { buildWorkerExecutionQuery } from './unit-search-worker-request.util';

describe('buildWorkerExecutionQuery', () => {
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