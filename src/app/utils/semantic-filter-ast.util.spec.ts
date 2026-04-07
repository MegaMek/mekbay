import { GameSystem } from '../models/common.model';
import { filterUnitsWithAST, parseSemanticQueryAST } from './semantic-filter-ast.util';
import { matchesSearch, parseSearchQuery } from './search.util';

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

    it('does not try indexed pruning for external force pack filters', () => {
        const units = [
            { id: 1, packMemberships: ['Essentials Box Set'] },
            { id: 2, packMemberships: [] },
        ];
        const result = parseSemanticQueryAST('pack="Essentials Box Set"', GameSystem.CLASSIC);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: () => undefined,
            getIndexedFilterValues: () => [],
            getIndexedUnitIds: () => undefined,
            unitBelongsToForcePack: (unit: { packMemberships?: string[] }, packName: string) => {
                membershipChecks++;
                return (unit.packMemberships ?? []).includes(packName);
            },
            getAllForcePackNames: () => ['Essentials Box Set'],
        });

        expect(filtered).toEqual([units[0]]);
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

    it('scopes faction matches to the selected era when both filters are present', () => {
        const units = [
            {
                id: 1,
                era: ['Clan Invasion'],
                factionEras: {
                    'Clan Coyote': ['Clan Invasion'],
                },
            },
            {
                id: 2,
                era: ['Clan Invasion'],
                factionEras: {
                    'Clan Coyote': ['Jihad'],
                },
            },
            {
                id: 3,
                era: ['Jihad'],
                factionEras: {
                    'Clan Coyote': ['Jihad'],
                },
            },
        ];
        const result = parseSemanticQueryAST('era="Clan Invasion" faction="Clan Coyote"', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: (unit: { era?: string[] }, key: string) => unit[key as keyof typeof unit],
            unitBelongsToEra: (unit: { era?: string[] }, eraName: string) =>
                (unit.era ?? []).includes(eraName),
            unitBelongsToFaction: (
                unit: { factionEras?: Record<string, string[]> },
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEraNames = unit.factionEras?.[factionName] ?? [];
                if (eraNames !== undefined) {
                    return eraNames.some(eraName => membershipEraNames.includes(eraName));
                }

                return membershipEraNames.length > 0;
            },
            getAllEraNames: () => ['Clan Invasion', 'Jihad'],
            getAllFactionNames: () => ['Clan Coyote'],
        });

        expect(filtered).toEqual([units[0]]);
    });

    it('preserves grouped boolean expressions with parentheses', () => {
        const units = [
            { id: 1, type: 'Mek', bv: 1200 },
            { id: 2, type: 'Mek', bv: 900 },
            { id: 3, type: 'Aero', bv: 800 },
            { id: 4, type: 'Aero', bv: 1400 },
        ];
        const result = parseSemanticQueryAST('(type=Mek bv>1000) OR (type=Aero bv<1000)', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: (unit: { type?: string; bv?: number }, key: string) => unit[key as keyof typeof unit],
        });

        expect(result.errors).toEqual([]);
        expect(filtered).toEqual([units[0], units[2]]);
    });

    it('returns structural lexer tokens for grouped boolean expressions', () => {
        const result = parseSemanticQueryAST(
            '(type=Mek bv>1000) OR (type=Aero bv<1000)',
            GameSystem.CLASSIC,
            true,
        );

        expect(result.errors).toEqual([]);
        expect(result.lexTokens.map(token => token.type)).toEqual([
            'LPAREN',
            'FILTER',
            'FILTER',
            'RPAREN',
            'OR',
            'LPAREN',
            'FILTER',
            'FILTER',
            'RPAREN',
            'EOF',
        ]);
    });

    it('keeps quoted Alpha Strike specials intact for plain text matching', () => {
        const units = [
            { id: 1, text: 'TUR(4/4/2,IF1,TAG)' },
            { id: 2, text: 'IF1' },
            { id: 3, text: 'TAG' },
        ];
        const result = parseSemanticQueryAST('"TUR(4/4/2,IF1,TAG)"', GameSystem.ALPHA_STRIKE);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.ALPHA_STRIKE,
            getUnitId,
            getProperty: () => undefined,
            matchesText: (unit: { text: string }, text: string) => matchesSearch(unit.text, parseSearchQuery(text), true),
        });

        expect(result.errors).toEqual([]);
        expect(result.textSearch).toBe('"TUR(4/4/2,IF1,TAG)"');
        expect(filtered).toEqual([units[0]]);
    });

    it('tokenizes quoted plain-text specials as a single text node', () => {
        const result = parseSemanticQueryAST('"TUR(2/3/3,IF2,LRM1/2/2)" OR tag', GameSystem.ALPHA_STRIKE, true);

        expect(result.errors).toEqual([]);
        expect(result.lexTokens.map(token => ({ type: token.type, value: token.value }))).toEqual([
            { type: 'TEXT', value: '"TUR(2/3/3,IF2,LRM1/2/2)"' },
            { type: 'OR', value: 'OR' },
            { type: 'TEXT', value: 'tag' },
            { type: 'EOF', value: '' },
        ]);
    });

    it('parses quoted Alpha Strike specials with embedded commas as a single semantic value', () => {
        const units = [
            { id: 1, specials: ['TUR(4/4/2,IF1,TAG)'] },
            { id: 2, specials: ['IF1', 'TAG'] },
            { id: 3, specials: ['TUR(4/4/2)'] },
        ];
        const result = parseSemanticQueryAST('specials="TUR(4/4/2,IF1,TAG)"', GameSystem.ALPHA_STRIKE);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.ALPHA_STRIKE,
            getUnitId,
            getProperty: (unit: { specials?: string[] }, key: string) => key === 'as.specials' ? unit.specials : undefined,
        });

        expect(result.errors).toEqual([]);
        expect(result.tokens).toEqual([
            jasmine.objectContaining({
                field: 'specials',
                operator: '=',
                values: ['TUR(4/4/2,IF1,TAG)'],
                rawText: 'specials="TUR(4/4/2,IF1,TAG)"',
            }),
        ]);
        expect(filtered).toEqual([units[0]]);
    });

    it('parses multiple quoted semantic dropdown values separated by commas', () => {
        const result = parseSemanticQueryAST('specials="TUR(2/3/3,IF2,LRM1/2/2)","TAG"', GameSystem.ALPHA_STRIKE);

        expect(result.errors).toEqual([]);
        expect(result.tokens).toEqual([
            jasmine.objectContaining({
                field: 'specials',
                operator: '=',
                values: ['TUR(2/3/3,IF2,LRM1/2/2)', 'TAG'],
                rawText: 'specials="TUR(2/3/3,IF2,LRM1/2/2)","TAG"',
            }),
        ]);
    });
});