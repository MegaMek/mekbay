import { GameSystem } from '../models/common.model';
import { filterUnitsWithAST, parseSemanticQueryAST, tokenizeForHighlight } from './semantic-filter-ast.util';
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
        expect(membershipChecks).toBe(0);
    });

    it('uses indexed results for exclusive external wildcard filters without per-unit membership scans', () => {
        const units = [
            { name: 'Unit 1', faction: ['Capellan Confederation'] },
            { name: 'Unit 2', faction: ['Capellan Confederation', 'Federated Suns'] },
            { name: 'Unit 3', faction: ['Federated Suns'] },
        ];
        const allFactionNames = [
            'Capellan Confederation',
            'Capellan March',
            'Federated Suns',
            ...Array.from({ length: 80 }, (_, index) => `Unused Faction ${index + 1}`),
        ];
        const result = parseSemanticQueryAST('faction=="Capellan *"', GameSystem.CLASSIC);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? allFactionNames : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey !== 'faction') {
                    return undefined;
                }

                if (value === 'Capellan Confederation') {
                    return new Set(['Unit 1', 'Unit 2']);
                }
                if (value === 'Capellan March') {
                    return new Set<string>();
                }
                if (value === 'Federated Suns') {
                    return new Set(['Unit 2', 'Unit 3']);
                }

                return new Set<string>();
            },
            unitBelongsToFaction: (unit: { faction?: string[] }, factionName: string) => {
                membershipChecks++;
                return (unit.faction ?? []).includes(factionName);
            },
            getAllFactionNames: () => allFactionNames,
        });

        expect(filtered).toEqual([units[0]]);
        expect(membershipChecks).toBe(0);
    });

    it('uses indexed results for wildcard external include filters without per-unit membership scans', () => {
        const units = [
            { name: 'Unit 1', faction: ['Capellan Confederation'] },
            { name: 'Unit 2', faction: ['Capellan March'] },
            { name: 'Unit 3', faction: ['Federated Suns'] },
        ];
        const allFactionNames = [
            'Capellan Confederation',
            'Capellan March',
            'Federated Suns',
        ];
        const result = parseSemanticQueryAST('faction="Capellan *"', GameSystem.CLASSIC);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? allFactionNames : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey !== 'faction') {
                    return undefined;
                }

                if (value === 'Capellan Confederation') {
                    return new Set(['Unit 1']);
                }
                if (value === 'Capellan March') {
                    return new Set(['Unit 2']);
                }
                if (value === 'Federated Suns') {
                    return new Set(['Unit 3']);
                }

                return new Set<string>();
            },
            unitBelongsToFaction: (unit: { faction?: string[] }, factionName: string) => {
                membershipChecks++;
                return (unit.faction ?? []).includes(factionName);
            },
            getAllFactionNames: () => allFactionNames,
        });

        expect(filtered).toEqual([units[0], units[1]]);
        expect(membershipChecks).toBe(0);
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

    it('scopes MegaMek rarity matches to the selected availability source', () => {
        const units = [
            {
                id: 1,
                bySource: {
                    Requisition: 'Common',
                    Salvage: 'Rare',
                },
            },
            {
                id: 2,
                bySource: {
                    Requisition: 'Rare',
                    Salvage: 'Common',
                },
            },
        ];
        const result = parseSemanticQueryAST('from=Requisition rarity=Rare', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: () => undefined,
            unitMatchesAvailabilityFrom: (unit: { bySource: Record<string, string> }, availabilityFromName: string) => {
                return unit.bySource[availabilityFromName] !== 'Not Available';
            },
            unitMatchesAvailabilityRarity: (
                unit: { bySource: Record<string, string> },
                rarityName: string,
                scope,
            ) => {
                const activeSources = scope?.availabilityFromNames ?? ['Requisition', 'Salvage'];
                return activeSources.some((availabilityFromName) => unit.bySource[availabilityFromName] === rarityName);
            },
            getAllAvailabilityFromNames: () => ['Requisition', 'Salvage'],
            getAllAvailabilityRarityNames: () => ['Not Available', 'Very Rare', 'Rare', 'Uncommon', 'Common', 'Very Common'],
        });

        expect(filtered).toEqual([units[1]]);
    });

    it('passes active era and faction scope to MegaMek rarity filters', () => {
        const units = [
            {
                id: 1,
                eras: ['Clan Invasion'],
                factionEras: {
                    'Federated Suns': ['Clan Invasion'],
                },
                rarityByContext: {
                    'Clan Invasion|Federated Suns': 'Rare',
                },
            },
            {
                id: 2,
                eras: ['Clan Invasion'],
                factionEras: {
                    'Federated Suns': ['Clan Invasion'],
                },
                rarityByContext: {
                    'Clan Invasion|Federated Suns': 'Common',
                },
            },
        ];
        const result = parseSemanticQueryAST('era="Clan Invasion" faction="Federated Suns" rarity=Rare', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: () => undefined,
            unitBelongsToEra: (unit: { eras?: string[] }, eraName: string) => (unit.eras ?? []).includes(eraName),
            unitBelongsToFaction: (
                unit: { factionEras?: Record<string, string[]> },
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEraNames = unit.factionEras?.[factionName] ?? [];
                if (eraNames !== undefined) {
                    return eraNames.some((eraName) => membershipEraNames.includes(eraName));
                }
                return membershipEraNames.length > 0;
            },
            unitMatchesAvailabilityRarity: (
                unit: { rarityByContext: Record<string, string> },
                rarityName: string,
                scope,
            ) => {
                const eraNames = scope?.eraNames ?? [];
                const factionNames = scope?.factionNames ?? [];
                return eraNames.some((eraName) => (
                    factionNames.some((factionName) => unit.rarityByContext[`${eraName}|${factionName}`] === rarityName)
                ));
            },
            getAllEraNames: () => ['Clan Invasion'],
            getAllFactionNames: () => ['Federated Suns'],
            getAllAvailabilityRarityNames: () => ['Not Available', 'Very Rare', 'Rare', 'Uncommon', 'Common', 'Very Common'],
        });

        expect(filtered).toEqual([units[0]]);
    });

    it('uses active faction scope for MegaMek era matches and indexed era candidates', () => {
        const units: Array<{
            id: number;
            eras: string[];
            factionEras: Record<string, string[]>;
        }> = [
            {
                id: 1,
                eras: ['Late Succession War - LosTech'],
                factionEras: {
                    Extinct: ['Early Succession War'],
                },
            },
            {
                id: 2,
                eras: ['Early Succession War'],
                factionEras: {
                    'Draconis Combine': ['Early Succession War'],
                },
            },
        ];
        const indexedScopes: Array<{ filterKey: string; value: string; factionNames?: readonly string[] }> = [];
        const result = parseSemanticQueryAST('faction=Extinct era="Early Succession War"', GameSystem.CLASSIC);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CLASSIC,
            getUnitId,
            getProperty: () => undefined,
            unitBelongsToEra: (
                unit: { eras?: string[]; factionEras?: Record<string, string[]> },
                eraName: string,
                scope,
            ) => {
                if (scope?.factionNames !== undefined) {
                    return scope.factionNames.some((factionName) => (
                        unit.factionEras?.[factionName]?.includes(eraName) ?? false
                    ));
                }

                return unit.eras?.includes(eraName) ?? false;
            },
            unitBelongsToFaction: (
                unit: { factionEras?: Record<string, string[]> },
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEraNames = unit.factionEras?.[factionName] ?? [];
                if (eraNames !== undefined) {
                    return eraNames.some((eraName) => membershipEraNames.includes(eraName));
                }

                return membershipEraNames.length > 0;
            },
            getAllEraNames: () => ['Early Succession War', 'Late Succession War - LosTech'],
            getAllFactionNames: () => ['Draconis Combine', 'Extinct'],
            getIndexedUnitIds: (filterKey: string, value: string, scope) => {
                indexedScopes.push({ filterKey, value, factionNames: scope?.factionNames });

                if (filterKey === 'faction') {
                    return new Set(
                        units
                            .filter((unit) => (unit.factionEras?.[value]?.length ?? 0) > 0)
                            .map(getUnitId),
                    );
                }

                if (filterKey === 'era') {
                    if (scope?.factionNames !== undefined) {
                        return new Set(
                            units
                                .filter((unit) => scope.factionNames!.some((factionName) => (
                                    unit.factionEras?.[factionName]?.includes(value) ?? false
                                )))
                                .map(getUnitId),
                        );
                    }

                    return new Set(
                        units
                            .filter((unit) => unit.eras?.includes(value) ?? false)
                            .map(getUnitId),
                    );
                }

                return undefined;
            },
            getIndexedFilterValues: (filterKey: string) => {
                if (filterKey === 'era') {
                    return ['Early Succession War', 'Late Succession War - LosTech'];
                }

                if (filterKey === 'faction') {
                    return ['Draconis Combine', 'Extinct'];
                }

                return [];
            },
        });

        expect(filtered).toEqual([units[0]]);
        expect(indexedScopes).toContain(jasmine.objectContaining({
            filterKey: 'era',
            value: 'Early Succession War',
            factionNames: ['Extinct'],
        }));
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

    it('keeps apostrophes inside plain text words while parsing following semantic filters', () => {
        const input = "Ti Ts'ang type=Mek";
        const result = parseSemanticQueryAST(input, GameSystem.CLASSIC, true);
        const highlightTokens = tokenizeForHighlight(input, GameSystem.CLASSIC);

        expect(result.errors).toEqual([]);
        expect(result.textSearch).toBe("Ti Ts'ang");
        expect(result.tokens).toEqual([
            jasmine.objectContaining({
                field: 'type',
                operator: '=',
                values: ['Mek'],
                rawText: 'type=Mek',
            }),
        ]);
        expect(result.lexTokens.map(token => ({ type: token.type, value: token.value }))).toEqual([
            { type: 'TEXT', value: 'Ti' },
            { type: 'TEXT', value: "Ts'ang" },
            { type: 'FILTER', value: 'type=Mek' },
            { type: 'EOF', value: '' },
        ]);
        expect(highlightTokens.some(token => token.type === 'error')).toBeFalse();
        expect(highlightTokens).toContain(jasmine.objectContaining({ type: 'key', value: 'type' }));
        expect(highlightTokens).toContain(jasmine.objectContaining({ type: 'operator', value: '=' }));
        expect(highlightTokens).toContain(jasmine.objectContaining({ type: 'value', value: 'Mek' }));
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