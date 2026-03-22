import { GameSystem } from '../models/common.model';
import { filterUnitsWithAST, parseSemanticQueryAST } from './semantic-filter-ast.util';

function getUnitId(unit: { id?: string | number; name?: string }): string {
    if (unit.id !== undefined) {
        return String(unit.id);
    }

    return unit.name ?? '';
}

describe('semantic filter exclusivity', () => {
    it('parses == as an operator for dropdown-like filters', () => {
        const result = parseSemanticQueryAST('faction=="Draconis Combine"', GameSystem.CLASSIC);

        expect(result.errors).toEqual([]);
        expect(result.tokens).toEqual([
            jasmine.objectContaining({
                field: 'faction',
                operator: '==',
                values: ['Draconis Combine'],
                rawText: 'faction=="Draconis Combine"'
            })
        ]);
    });

    it('filters external-style multi-value fields exclusively', () => {
        const units = [
            { id: 1, faction: ['Draconis Combine'] },
            { id: 2, faction: ['Draconis Combine', 'Federated Suns'] },
            { id: 3, faction: ['Federated Suns'] }
        ];
        const result = parseSemanticQueryAST('faction==draco*', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            unitBelongsToFaction: (unit: { faction?: string[] }, factionName: string) =>
                (unit.faction ?? []).includes(factionName),
            getAllFactionNames: () => ['Draconis Combine', 'Federated Suns']
        });

        expect(filtered).toEqual([units[0]]);
    });

    it('filters regular array dropdown fields exclusively', () => {
        const units = [
            { id: 1, role: ['Scout'] },
            { id: 2, role: ['Scout', 'Striker'] },
            { id: 3, role: ['Striker'] }
        ];
        const result = parseSemanticQueryAST('role==sc*', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: (unit: { role?: string[] }, key: string) => unit[key as keyof typeof unit]
        });

        expect(filtered).toEqual([units[0]]);
    });

    it('uses indexed candidates to avoid scanning non-matching external units', () => {
        const units = Array.from({ length: 6 }, (_, index) => ({
            name: `Unit ${index + 1}`,
            faction: index < 2 ? ['Draconis Combine'] : ['Federated Suns']
        }));
        const result = parseSemanticQueryAST('faction=draco*', GameSystem.CLASSIC);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? ['Draconis Combine', 'Federated Suns'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey === 'faction' && value === 'Draconis Combine') {
                    return new Set(['Unit 1', 'Unit 2']);
                }
                if (filterKey === 'faction' && value === 'Federated Suns') {
                    return new Set(['Unit 3', 'Unit 4', 'Unit 5', 'Unit 6']);
                }
                return undefined;
            },
            unitBelongsToFaction: (unit: { faction?: string[] }, factionName: string) => {
                membershipChecks++;
                return (unit.faction ?? []).includes(factionName);
            },
            getAllFactionNames: () => ['Draconis Combine', 'Federated Suns']
        });

        expect(filtered).toEqual([units[0], units[1]]);
        expect(membershipChecks).toBe(2);
    });

    it('matches external factions with punctuation-insensitive semantic values', () => {
        const units = [
            { id: 1, faction: ["Wolf's Dragoons"] },
            { id: 2, faction: ['Clan Wolf'] }
        ];
        const result = parseSemanticQueryAST('faction="Wolfs Dragoons"', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? ["Wolf's Dragoons", 'Clan Wolf'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey === 'faction' && value === "Wolf's Dragoons") {
                    return new Set(['1']);
                }
                if (filterKey === 'faction' && value === 'Clan Wolf') {
                    return new Set(['2']);
                }
                return undefined;
            },
            unitBelongsToFaction: (unit: { faction?: string[] }, factionName: string) =>
                (unit.faction ?? []).includes(factionName),
            getAllFactionNames: () => ["Wolf's Dragoons", 'Clan Wolf']
        });

        expect(filtered).toEqual([units[0]]);
    });
});