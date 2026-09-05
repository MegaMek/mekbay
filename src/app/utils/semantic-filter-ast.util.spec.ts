// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from '../models/common.model';
import { asUnitUuid, type UnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { prepareASTSearch, parseSemanticQueryAST, tokenizeForHighlight, type EvaluatorContext, type GroupASTNode, type ParseResult } from './semantic-filter-ast.util';
import type { AvailabilityFilterScope } from '../services/unit-search-filters.model';
import { filterStateToSemanticText, tokensToFilterState } from './semantic-filter.util';
import { matchesSearch, parseSearchQuery } from './search.util';

function filterUnitsWithAST<TUnit extends object>(
    units: TUnit[], ast: GroupASTNode, context: EvaluatorContext<TUnit>, scope?: AvailabilityFilterScope,
): TUnit[] {
    return prepareASTSearch(ast, context, scope).filter(units);
}

function testUnitUuid(value: string | number): UnitUuid {
    const text = String(value);
    let hash = 0;
    for (const character of text) {
        hash = ((hash * 31) ^ character.charCodeAt(0)) >>> 0;
    }
    const suffix = `${hash.toString(16).padStart(8, '0')}${text.length.toString(16).padStart(4, '0')}`;
    return asUnitUuid(`01900000-0000-7000-8000-${suffix}`);
}

function getUnitId(unit: unknown): UnitUuid {
    if (!unit || typeof unit !== 'object') return testUnitUuid('missing');
    const value = unit as { id?: string | number; name?: string };
    if (value.id !== undefined) {
        return testUnitUuid(value.id);
    }

    return testUnitUuid(value.name ?? 'missing');
}

function unitIds(...values: readonly (string | number)[]): Set<UnitUuid> {
    return new Set(values.map(testUnitUuid));
}

describe('prepared semantic search', () => {
    const context = {
        gameSystem: GameSystem.CBT,
        getUnitId,
        getProperty: (unit: { name: string; bv: number }, key: string) => key === 'bv' ? unit.bv : unit.name,
        matchesText: (unit: { name: string; bv: number }, text: string) => unit.name.includes(text),
    };

    it('reads current unit facts without retaining previous matches', () => {
        const unit = { name: 'Atlas', bv: 1200 };
        const search = prepareASTSearch(parseSemanticQueryAST('Atlas bv>1000', GameSystem.CBT).ast, context);
        expect(search.filter([unit])).toEqual([unit]);
        unit.bv = 900;
        expect(search.filter([unit])).toEqual([]);
    });

    it('uses the first matching OR branch for relevance even when several branches match', () => {
        const unit = { name: 'Atlas AS7', bv: 1200 };
        const search = prepareASTSearch(parseSemanticQueryAST('(Atlas bv>1000) OR AS7', GameSystem.CBT).ast, context);
        expect(search.filter([unit])).toEqual([unit]);
        expect(search.matchingText(unit)).toEqual(['Atlas']);
        unit.bv = 900;
        expect(search.matchingText(unit)).toEqual(['AS7']);
    });

    it('unescapes literal search text consistently for filtering and relevance', () => {
        const unit = { name: 'Puma (Adder)', bv: 1200 };
        const search = prepareASTSearch(parseSemanticQueryAST('Puma \\(Adder\\)', GameSystem.CBT).ast, context);
        expect(search.filter([unit])).toEqual([unit]);
        expect(search.matchingText(unit)).toEqual(['Puma', '(Adder)']);
    });

    it('keeps query scopes independent when one parsed query is used in different searches', () => {
        const unit = { name: 'Atlas', bv: 1200 };
        const ast = parseSemanticQueryAST('faction="Federated Suns"', GameSystem.CBT).ast;
        const scopedContext = {
            ...context,
            unitBelongsToFaction: (_unit: typeof unit, _faction: string, eras?: readonly string[]) =>
                eras?.includes('Jihad') ?? false,
            getAllFactionNames: () => ['Federated Suns'],
        };
        const jihad = prepareASTSearch(ast, scopedContext, { eraNames: ['Jihad'] });
        const invasion = prepareASTSearch(ast, scopedContext, { eraNames: ['Clan Invasion'] });
        expect(invasion.filter([unit])).toEqual([]);
        expect(jihad.filter([unit])).toEqual([unit]);
    });
});

describe('semantic boolean filters', () => {
    const units = [
        { id: 1, name: 'Canon Published', canon: true, published: ['RS:3050'] },
        { id: 2, name: 'Canon Unpublished', canon: true, published: [] },
        { id: 3, name: 'Non-Canon Published', canon: false, published: ['RS:Custom'] },
        { id: 4, name: 'Non-Canon Unpublished', canon: false, published: [] },
    ];

    function filterUnitNames(query: string): string[] {
        const result = parseSemanticQueryAST(query, GameSystem.CBT);
        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit: typeof units[number], key: string) => unit[key as keyof typeof unit],
        });

        return filtered.map(unit => unit.name);
    }

    it('parses key:yes/no boolean syntax as semantic filters', () => {
        const result = parseSemanticQueryAST('canon:yes canon:no published:yes published:no', GameSystem.CBT);

        expect(result.textSearch).toBe('');
        expect(result.tokens).toEqual([
            jasmine.objectContaining({ field: 'canon', operator: '=', values: ['yes'], rawText: 'canon:yes' }),
            jasmine.objectContaining({ field: 'canon', operator: '=', values: ['no'], rawText: 'canon:no' }),
            jasmine.objectContaining({ field: 'published', operator: '=', values: ['yes'], rawText: 'published:yes' }),
            jasmine.objectContaining({ field: 'published', operator: '=', values: ['no'], rawText: 'published:no' }),
        ]);
    });

    it('accepts true/false and y/n aliases for boolean semantic values', () => {
        expect(filterUnitNames('canon:true')).toEqual(['Canon Published', 'Canon Unpublished']);
        expect(filterUnitNames('canon:y')).toEqual(['Canon Published', 'Canon Unpublished']);
        expect(filterUnitNames('published:false')).toEqual(['Canon Unpublished', 'Non-Canon Unpublished']);
        expect(filterUnitNames('published:n')).toEqual(['Canon Unpublished', 'Non-Canon Unpublished']);
    });

    it('filters canon and non-canon units from key:yes/no syntax', () => {
        expect(filterUnitNames('canon:yes')).toEqual(['Canon Published', 'Canon Unpublished']);
        expect(filterUnitNames('canon:no')).toEqual(['Non-Canon Published', 'Non-Canon Unpublished']);
    });

    it('filters published and unpublished record-sheet status from key:yes/no syntax', () => {
        expect(filterUnitNames('published:yes')).toEqual(['Canon Published', 'Non-Canon Published']);
        expect(filterUnitNames('published:no')).toEqual(['Canon Unpublished', 'Non-Canon Unpublished']);
    });

    it('combines boolean keywords with normal semantic filters', () => {
        expect(filterUnitNames('canon:yes published:yes')).toEqual(['Canon Published']);
        expect(filterUnitNames('canon:no published:no')).toEqual(['Non-Canon Unpublished']);
    });

    it('leaves bare boolean words as text search', () => {
        const result = parseSemanticQueryAST('canon published', GameSystem.CBT);

        expect(result.textSearch).toBe('canon published');
        expect(result.tokens).toEqual([]);
    });

    it('uses indexed boolean candidates when available', () => {
        const result = parseSemanticQueryAST('canon:yes', GameSystem.CBT);
        let propertyChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit: typeof units[number], key: string) => {
                propertyChecks++;
                return unit[key as keyof typeof unit];
            },
            getIndexedFilterValues: (filterKey: string) => filterKey === 'canon' ? ['no', 'yes'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey !== 'canon') {
                    return undefined;
                }
                return value === 'yes'
                    ? unitIds(1, 2)
                    : unitIds(3, 4);
            },
        });

        expect(filtered).toEqual([units[0], units[1]]);
        expect(propertyChecks).toBe(2);
    });
});

describe('semantic countable filters', () => {
    it('uses the equipment posting as a safe prefilter before checking quantity', () => {
        const units = [
            { id: 1, componentName: ['LRM 5'], counts: new Map([['lrm 5', 4]]) },
            { id: 2, componentName: ['LRM 5'], counts: new Map([['lrm 5', 1]]) },
            { id: 3, componentName: ['Medium Laser'], counts: new Map([['medium laser', 2]]) },
        ];
        const result = parseSemanticQueryAST('equipment="LRM 5:>=2"', GameSystem.CBT);
        const exactCheckedUnitIds = new Set<number>();

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit, key) => unit[key as keyof typeof unit],
            getCountableValues: unit => {
                exactCheckedUnitIds.add(unit.id);
                return unit.counts;
            },
            getIndexedFilterValues: filterKey => filterKey === 'componentName'
                ? ['LRM 5', 'Medium Laser']
                : [],
            getIndexedUnitIds: (filterKey, value) => {
                if (filterKey !== 'componentName') return undefined;
                return value === 'LRM 5' ? unitIds(1, 2) : unitIds(3);
            },
        });

        expect(result.errors).toEqual([]);
        expect(filtered).toEqual([units[0]]);
        expect(exactCheckedUnitIds).toEqual(new Set([1, 2]));
    });
});

describe('semantic Alpha Strike damage filters', () => {
    const units = [
        { id: 1, name: 'zero-damage', as: { dmg: { _dmgS: 0 } } },
        { id: 2, name: 'zero-star-damage', as: { dmg: { _dmgS: 0.5 } } },
        { id: 3, name: 'one-damage', as: { dmg: { _dmgS: 1 } } },
        { id: 4, name: 'two-damage', as: { dmg: { _dmgS: 2 } } },
    ];

    function getNestedProperty(unit: any, key: string): unknown {
        return key.split('.').reduce((current, part) => current?.[part], unit);
    }

    function filterASDamageUnitNames(query: string): string[] {
        const result = parseSemanticQueryAST(query, GameSystem.AS);
        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: getNestedProperty,
        });

        expect(result.errors).toEqual([]);
        return filtered.map(unit => unit.name);
    }

    it('matches zero-star damage as a distinct value between zero and one', () => {
        expect(filterASDamageUnitNames('dmgs=0*')).toEqual(['zero-star-damage']);
        expect(filterASDamageUnitNames('dmgs>0')).toEqual(['zero-star-damage', 'one-damage', 'two-damage']);
        expect(filterASDamageUnitNames('dmgs<1')).toEqual(['zero-damage', 'zero-star-damage']);
        expect(filterASDamageUnitNames('dmgs=0-1')).toEqual(['zero-damage', 'zero-star-damage', 'one-damage']);
    });

    it('round-trips zero-star damage through semantic filter state', () => {
        const parsed = parseSemanticQueryAST('dmgs=0* dmgm>0 dmgl<1', GameSystem.AS);
        const state = tokensToFilterState(parsed.tokens, GameSystem.AS, {
            'as.dmg._dmgS': [0, 6],
            'as.dmg._dmgM': [0, 6],
            'as.dmg._dmgL': [0, 6],
        });

        expect(state['as.dmg._dmgS']).toEqual(jasmine.objectContaining({ value: [0.5, 0.5] }));
        expect(state['as.dmg._dmgM']).toEqual(jasmine.objectContaining({ value: [0.5, 6] }));
        expect(state['as.dmg._dmgL']).toEqual(jasmine.objectContaining({ value: [0, 0.5] }));
        expect(filterStateToSemanticText({
            'as.dmg._dmgS': {
                value: [0.5, 0.5],
                interactedWith: true,
            },
        }, '', GameSystem.AS, {
            'as.dmg._dmgS': [0, 6],
        })).toBe('dmgs=0*');
    });

    it('formats zero-star damage exclusion ranges without nonexistent half steps', () => {
        const parsed = parseSemanticQueryAST('dmgs!=1', GameSystem.AS);
        const state = tokensToFilterState(parsed.tokens, GameSystem.AS, {
            'as.dmg._dmgS': [0, 6],
        });

        expect(state['as.dmg._dmgS']).toEqual(jasmine.objectContaining({
            value: [0, 6],
            displayText: '0-0*, 2-6',
        }));
    });
});

describe('semantic filter exclusivity', () => {
    it('parses == as an operator for dropdown-like filters', () => {
        const result = parseSemanticQueryAST('faction=="Draconis Combine"', GameSystem.CBT);

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
        const result = parseSemanticQueryAST('faction==draco*', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
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
        const result = parseSemanticQueryAST('role==sc*', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
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
        const result = parseSemanticQueryAST('faction=draco*', GameSystem.CBT);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? ['Draconis Combine', 'Federated Suns'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey === 'faction' && value === 'Draconis Combine') {
                    return unitIds('Unit 1', 'Unit 2');
                }
                if (filterKey === 'faction' && value === 'Federated Suns') {
                    return unitIds('Unit 3', 'Unit 4', 'Unit 5', 'Unit 6');
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
        const result = parseSemanticQueryAST('faction=="Capellan *"', GameSystem.CBT);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? allFactionNames : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey !== 'faction') {
                    return undefined;
                }

                if (value === 'Capellan Confederation') {
                    return unitIds('Unit 1', 'Unit 2');
                }
                if (value === 'Capellan March') {
                    return new Set<UnitUuid>();
                }
                if (value === 'Federated Suns') {
                    return unitIds('Unit 2', 'Unit 3');
                }

                return new Set<UnitUuid>();
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

    it('keeps an explicit empty era scope distinct from global exclusivity', () => {
        const units = [{ id: 1 }, { id: 2 }];
        const result = parseSemanticQueryAST('faction=="Clan Coyote"', GameSystem.CBT);
        const context = {
            gameSystem: GameSystem.CBT,
            getProperty: () => undefined,
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction'
                ? ['Clan Coyote', 'Federated Suns']
                : [],
            getIndexedUnitIds: (filterKey: string, value: string, scope?: { eraNames?: readonly string[] }) => {
                if (filterKey !== 'faction') {
                    return undefined;
                }
                if (scope?.eraNames !== undefined) {
                    return new Set<UnitUuid>();
                }
                return value === 'Clan Coyote' ? unitIds(1) : unitIds(2);
            },
            getAllFactionNames: () => ['Clan Coyote', 'Federated Suns'],
        };

        expect(filterUnitsWithAST(units, result.ast, context)).toEqual([units[0]]);
        expect(filterUnitsWithAST(units, result.ast, context, { eraNames: [] })).toEqual([]);

        const fallbackContext = {
            gameSystem: GameSystem.CBT,
            getProperty: () => undefined,
            getUnitId,
            unitBelongsToFaction: (
                unit: { id: number },
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEra = unit.id === 1 && factionName === 'Clan Coyote'
                    ? 'Clan Invasion'
                    : unit.id === 2 && factionName === 'Federated Suns'
                        ? 'Jihad'
                        : null;
                return membershipEra !== null
                    && (eraNames === undefined || eraNames.includes(membershipEra));
            },
            unitBelongsToEra: (unit: { id: number }, eraName: string) => (
                (unit.id === 1 && eraName === 'Clan Invasion')
                || (unit.id === 2 && eraName === 'Jihad')
            ),
            getAllEraNames: () => ['Clan Invasion', 'Jihad'],
            getAllFactionNames: () => ['Clan Coyote', 'Federated Suns'],
        };

        expect(filterUnitsWithAST(units, result.ast, fallbackContext)).toEqual([units[0]]);
        expect(filterUnitsWithAST(units, result.ast, fallbackContext, { eraNames: [] })).toEqual([]);

        const scopedResult = parseSemanticQueryAST(
            'era="Clan Invasion" faction=="Clan Coyote"',
            GameSystem.CBT,
        );
        expect(filterUnitsWithAST(units, scopedResult.ast, fallbackContext)).toEqual([units[0]]);
        expect(filterUnitsWithAST(units, scopedResult.ast, fallbackContext, { eraNames: [] })).toEqual([]);
    });

    it('uses the same era scope when selecting relevance text from a complex query', () => {
        const unit = {
            id: 1,
            factionEras: {
                'Clan Coyote': ['Clan Invasion'],
                'Federated Suns': ['Jihad'],
            },
        };
        const result = parseSemanticQueryAST(
            '(faction=="Clan Coyote" Atlas) OR (faction=="Federated Suns" Zzz)',
            GameSystem.CBT,
        );
        const context = {
            gameSystem: GameSystem.CBT,
            getProperty: () => undefined,
            getUnitId,
            matchesText: (_unit: typeof unit, text: string) => text === 'Atlas',
            unitBelongsToFaction: (
                candidate: typeof unit,
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEras = candidate.factionEras[factionName as keyof typeof candidate.factionEras] ?? [];
                return eraNames === undefined
                    ? membershipEras.length > 0
                    : eraNames.some(eraName => membershipEras.includes(eraName));
            },
            getAllFactionNames: () => ['Clan Coyote', 'Federated Suns'],
        };
        const scope = { eraNames: ['Clan Invasion'] };

        expect(result.errors).toEqual([]);
        expect(filterUnitsWithAST([unit], result.ast, context, scope)).toEqual([unit]);
        expect(prepareASTSearch(result.ast, context, scope).matchingText(unit)).toEqual(['Atlas']);
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
        const result = parseSemanticQueryAST('faction="Capellan *"', GameSystem.CBT);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getUnitId,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? allFactionNames : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey !== 'faction') {
                    return undefined;
                }

                if (value === 'Capellan Confederation') {
                    return unitIds('Unit 1');
                }
                if (value === 'Capellan March') {
                    return unitIds('Unit 2');
                }
                if (value === 'Federated Suns') {
                    return unitIds('Unit 3');
                }

                return new Set<UnitUuid>();
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
        const result = parseSemanticQueryAST('pack="Essentials Box Set"', GameSystem.CBT);
        let membershipChecks = 0;

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
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
        const result = parseSemanticQueryAST('faction="Wolfs Dragoons"', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit: { faction?: string[] }, key: string) => unit[key as keyof typeof unit],
            getIndexedFilterValues: (filterKey: string) => filterKey === 'faction' ? ["Wolf's Dragoons", 'Clan Wolf'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey === 'faction' && value === "Wolf's Dragoons") {
                    return unitIds(1);
                }
                if (filterKey === 'faction' && value === 'Clan Wolf') {
                    return unitIds(2);
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
        const result = parseSemanticQueryAST('era="Clan Invasion" faction="Clan Coyote"', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit: typeof units[number], key: string) => unit[key as keyof typeof unit],
            unitBelongsToEra: (unit: typeof units[number], eraName: string) =>
                (unit.era ?? []).includes(eraName),
            unitBelongsToFaction: (
                unit: typeof units[number],
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEraNames = (unit.factionEras as Record<string, string[]> | undefined)?.[factionName] ?? [];
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
        const result = parseSemanticQueryAST('from=Requisition rarity=Rare', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
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
        const result = parseSemanticQueryAST('era="Clan Invasion" faction="Federated Suns" rarity=Rare', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: () => undefined,
            unitBelongsToEra: (unit: typeof units[number], eraName: string) => (unit.eras ?? []).includes(eraName),
            unitBelongsToFaction: (
                unit: typeof units[number],
                factionName: string,
                eraNames?: readonly string[],
            ) => {
                const membershipEraNames = (unit.factionEras as Record<string, string[]> | undefined)?.[factionName] ?? [];
                if (eraNames !== undefined) {
                    return eraNames.some((eraName) => membershipEraNames.includes(eraName));
                }
                return membershipEraNames.length > 0;
            },
            unitMatchesAvailabilityRarity: (
                unit: typeof units[number],
                rarityName: string,
                scope,
            ) => {
                const eraNames = scope?.eraNames ?? [];
                const factionNames = scope?.factionNames ?? [];
                return eraNames.some((eraName) => (
                    factionNames.some((factionName) => (
                        unit.rarityByContext as Record<string, string>
                    )[`${eraName}|${factionName}`] === rarityName)
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
        const result = parseSemanticQueryAST('faction=Extinct era="Early Succession War"', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
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
        const result = parseSemanticQueryAST('(type=Mek bv>1000) OR (type=Aero bv<1000)', GameSystem.CBT);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.CBT,
            getUnitId,
            getProperty: (unit: { type?: string; bv?: number }, key: string) => unit[key as keyof typeof unit],
        });

        expect(result.errors).toEqual([]);
        expect(filtered).toEqual([units[0], units[2]]);
    });

    it('returns structural lexer tokens for grouped boolean expressions', () => {
        const result = parseSemanticQueryAST(
            '(type=Mek bv>1000) OR (type=Aero bv<1000)',
            GameSystem.CBT,
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
        const result = parseSemanticQueryAST(input, GameSystem.CBT, true);
        const highlightTokens = tokenizeForHighlight(input, GameSystem.CBT);

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
        const result = parseSemanticQueryAST('"TUR(4/4/2,IF1,TAG)"', GameSystem.AS);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: () => undefined,
            matchesText: (unit: { text: string }, text: string) => matchesSearch(unit.text, parseSearchQuery(text), true),
        });

        expect(result.errors).toEqual([]);
        expect(result.textSearch).toBe('"TUR(4/4/2,IF1,TAG)"');
        expect(filtered).toEqual([units[0]]);
    });

    it('tokenizes quoted plain-text specials as a single text node', () => {
        const result = parseSemanticQueryAST('"TUR(2/3/3,IF2,LRM1/2/2)" OR tag', GameSystem.AS, true);

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
        const result = parseSemanticQueryAST('specials="TUR(4/4/2,IF1,TAG)"', GameSystem.AS);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.AS,
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
        const result = parseSemanticQueryAST('specials="TUR(2/3/3,IF2,LRM1/2/2)","TAG"', GameSystem.AS);

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

    type ASSpecialTestUnit = {
        id: number;
        name: string;
        specials?: string[] | string;
    };

    function filterASSpecialUnitNames(units: ASSpecialTestUnit[], query: string): { result: ParseResult; names: string[] } {
        const result = parseSemanticQueryAST(query, GameSystem.AS);
        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: (unit: ASSpecialTestUnit, key: string) => key === 'as.specials' ? unit.specials : undefined,
        });

        return { result, names: filtered.map(unit => unit.name) };
    }

    it('matches Alpha Strike specials inside TUR sub-abilities', () => {
        const units = [
            { id: 1, name: 'top-level', specials: ['CASE', 'FLK1/1/1'] },
            { id: 2, name: 'turret-only', specials: ['CASE', 'TUR(0*/0*/0*,FLK1/1/1)'] },
            { id: 3, name: 'different-turret', specials: ['TUR(0*/0*/0*,FLK0/1/1)'] },
        ];
        const result = parseSemanticQueryAST('specials=FLK1/1/1', GameSystem.AS);
        const wildcardResult = parseSemanticQueryAST('specials=flk*/*/*', GameSystem.AS);

        const filtered = filterUnitsWithAST(units, result.ast, {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: (unit: { specials?: string[] }, key: string) => key === 'as.specials' ? unit.specials : undefined,
            getIndexedFilterValues: (filterKey: string) => filterKey === 'as.specials' ? ['FLK1/1/1'] : [],
            getIndexedUnitIds: (filterKey: string, value: string) => {
                if (filterKey === 'as.specials' && value === 'FLK1/1/1') {
                    return unitIds(1);
                }
                return undefined;
            },
        });
        const wildcardFiltered = filterUnitsWithAST(units, wildcardResult.ast, {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: (unit: { specials?: string[] }, key: string) => key === 'as.specials' ? unit.specials : undefined,
        });

        expect(result.errors).toEqual([]);
        expect(wildcardResult.errors).toEqual([]);
        expect(filtered.map(unit => unit.name)).toEqual(['top-level', 'turret-only']);
        expect(wildcardFiltered.map(unit => unit.name)).toEqual(['top-level', 'turret-only', 'different-turret']);
    });

    it('expands Alpha Strike TUR sub-abilities with optional argument spacing case-insensitively', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'flat-turret', specials: ['TUR( 0*/0*/0*, tag, cAsEii )'] },
            { id: 2, name: 'top-tag', specials: ['TAG'] },
            { id: 3, name: 'damage-only', specials: ['TUR(0*/0*/0*)'] },
        ];
        const tagResult = filterASSpecialUnitNames(units, 'specials=TAG');
        const caseResult = filterASSpecialUnitNames(units, 'specials=CASEII');

        expect(tagResult.result.errors).toEqual([]);
        expect(caseResult.result.errors).toEqual([]);
        expect(tagResult.names).toEqual(['flat-turret', 'top-tag']);
        expect(caseResult.names).toEqual(['flat-turret']);
    });

    it('does not expose Alpha Strike TUR damage bands as searchable sub-abilities', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'turret-damage-with-tag', specials: ['TUR(0*/0*/0*,TAG)'] },
            { id: 2, name: 'top-level-damage-shaped-value', specials: ['0*/0*/0*'] },
        ];
        const result = filterASSpecialUnitNames(units, 'specials=0*/*/*');

        expect(result.result.errors).toEqual([]);
        expect(result.names).toEqual(['top-level-damage-shaped-value']);
    });

    it('applies Alpha Strike specials all-of and exclusion operators to expanded TUR values', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'all-in-turret', specials: ['TUR(0*/0*/0*,FLK1/1/1,TAG)'] },
            { id: 2, name: 'split-top-level', specials: ['FLK1/1/1', 'TAG'] },
            { id: 3, name: 'missing-tag', specials: ['TUR(0*/0*/0*,FLK1/1/1)'] },
            { id: 4, name: 'no-specials', specials: [] },
        ];
        const allOfResult = filterASSpecialUnitNames(units, 'specials&=FLK1/1/1,TAG');
        const excludeResult = filterASSpecialUnitNames(units, 'specials!=TAG');

        expect(allOfResult.result.errors).toEqual([]);
        expect(excludeResult.result.errors).toEqual([]);
        expect(allOfResult.names).toEqual(['all-in-turret', 'split-top-level']);
        expect(excludeResult.names).toEqual(['missing-tag', 'no-specials']);
    });

    it('keeps Alpha Strike specials exclusive matching scoped to top-level values', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'turret-only', specials: ['TUR(0*/0*/0*,FLK1/1/1)'] },
            { id: 2, name: 'top-level-only', specials: ['FLK1/1/1'] },
            { id: 3, name: 'top-level-extra', specials: ['FLK1/1/1', 'CASE'] },
        ];
        const subAbilityExclusive = filterASSpecialUnitNames(units, 'specials==FLK1/1/1');
        const turretExclusive = filterASSpecialUnitNames(units, 'specials=="TUR(0*/0*/0*,FLK1/1/1)"');

        expect(subAbilityExclusive.result.errors).toEqual([]);
        expect(turretExclusive.result.errors).toEqual([]);
        expect(subAbilityExclusive.names).toEqual(['top-level-only']);
        expect(turretExclusive.names).toEqual(['turret-only']);
    });

    it('supports numeric comparisons on Alpha Strike special ability slots', () => {
        const units = [
            { id: 1, name: 'low-flak', specials: ['FLK1/3/3'] },
            { id: 2, name: 'turret-flak', specials: ['TUR(0*/0*/0*,FLK2/1/0)'] },
            { id: 3, name: 'high-flak', specials: ['FLK3/4/0'] },
            { id: 4, name: 'zero-star-flak', specials: ['FLK0*/0*/0*'] },
            { id: 5, name: 'flat-two-flak', specials: ['FLK2/2/2'] },
            { id: 6, name: 'mixed-comparison-flak', specials: ['FLK2/3/1'] },
        ];
        const context = {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: (unit: { specials?: string[] }, key: string) => key === 'as.specials' ? unit.specials : undefined,
        };

        const firstSlotResult = parseSemanticQueryAST('specials=FLK>=2', GameSystem.AS);
        const secondSlotResult = parseSemanticQueryAST('specials=FLK*/<=2', GameSystem.AS);
        const exactSlotsResult = parseSemanticQueryAST('specials=FLK2/2/2', GameSystem.AS);
        const mixedSlotsResult = parseSemanticQueryAST('specials=FLK2/>2', GameSystem.AS);

        expect(firstSlotResult.errors).toEqual([]);
        expect(secondSlotResult.errors).toEqual([]);
        expect(exactSlotsResult.errors).toEqual([]);
        expect(mixedSlotsResult.errors).toEqual([]);
        expect(filterUnitsWithAST(units, firstSlotResult.ast, context).map(unit => unit.name)).toEqual(['turret-flak', 'high-flak', 'flat-two-flak', 'mixed-comparison-flak']);
        expect(filterUnitsWithAST(units, secondSlotResult.ast, context).map(unit => unit.name)).toEqual(['turret-flak', 'zero-star-flak', 'flat-two-flak']);
        expect(filterUnitsWithAST(units, exactSlotsResult.ast, context).map(unit => unit.name)).toEqual(['flat-two-flak']);
        expect(filterUnitsWithAST(units, mixedSlotsResult.ast, context).map(unit => unit.name)).toEqual(['mixed-comparison-flak']);
    });

    it('supports bracket sets for Alpha Strike special ability numbers', () => {
        const units = [
            { id: 1, name: 'car-one', specials: ['CAR1'] },
            { id: 2, name: 'car-two', specials: ['CAR2'] },
            { id: 3, name: 'turret-car-four', specials: ['TUR(1/1/1,CAR4)'] },
            { id: 4, name: 'car-five', specials: ['CAR5'] },
        ];
        const setResult = parseSemanticQueryAST('specials=CAR[2,4]', GameSystem.AS);
        const greaterThanResult = parseSemanticQueryAST('specials=CAR>2', GameSystem.AS);

        const context = {
            gameSystem: GameSystem.AS,
            getUnitId,
            getProperty: (unit: { specials?: string[] }, key: string) => key === 'as.specials' ? unit.specials : undefined,
        };

        expect(setResult.errors).toEqual([]);
        expect(greaterThanResult.errors).toEqual([]);
        expect(setResult.tokens[0]).toEqual(jasmine.objectContaining({ values: ['CAR[2,4]'] }));
        expect(filterUnitsWithAST(units, setResult.ast, context).map(unit => unit.name)).toEqual(['car-two', 'turret-car-four']);
        expect(filterUnitsWithAST(units, greaterThanResult.ast, context).map(unit => unit.name)).toEqual(['turret-car-four', 'car-five']);
    });

    it('supports four-slot Alpha Strike special ability comparisons', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'four-slot-ok', specials: ['AAA1/2/3/4'] },
            { id: 2, name: 'four-slot-too-low', specials: ['AAA1/1/3/4'] },
            { id: 3, name: 'three-slot-short', specials: ['AAA1/2/3'] },
            { id: 4, name: 'turret-four-slot', specials: ['TUR(0/0/0,AAA2/4/3/1)'] },
        ];
        const result = filterASSpecialUnitNames(units, 'specials=AAA*/>=2/*/<=4');

        expect(result.result.errors).toEqual([]);
        expect(result.names).toEqual(['four-slot-ok', 'turret-four-slot']);
    });

    it('supports missing slots in Alpha Strike special numbers', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'missing-slots', specials: ['LRM-/2/-'] },
            { id: 2, name: 'zero-slots', specials: ['LRM0/2/0'] },
        ];
        const missingResult = filterASSpecialUnitNames(units, 'specials=LRM-/>=2/-');
        const zeroResult = filterASSpecialUnitNames(units, 'specials=LRM0/>=2/0');

        expect(missingResult.result.errors).toEqual([]);
        expect(zeroResult.result.errors).toEqual([]);
        expect(missingResult.names).toEqual(['missing-slots']);
        expect(zeroResult.names).toEqual(['zero-slots']);
    });

    it('treats Alpha Strike 0-star as greater than 0 and less than 1 for comparisons', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'zero', specials: ['FLK0/0/0'] },
            { id: 2, name: 'zero-star', specials: ['FLK0*/0*/0*'] },
            { id: 3, name: 'one', specials: ['FLK1/1/1'] },
        ];

        const greaterThanZero = filterASSpecialUnitNames(units, 'specials=FLK>0');
        const lessThanOne = filterASSpecialUnitNames(units, 'specials=FLK<1');
        const greaterThanOrEqualOne = filterASSpecialUnitNames(units, 'specials=FLK>=1');
        const exactZero = filterASSpecialUnitNames(units, 'specials=FLK0');
        const exactZeroStar = filterASSpecialUnitNames(units, 'specials=FLK0*');

        expect(greaterThanZero.result.errors).toEqual([]);
        expect(lessThanOne.result.errors).toEqual([]);
        expect(greaterThanOrEqualOne.result.errors).toEqual([]);
        expect(exactZero.result.errors).toEqual([]);
        expect(exactZeroStar.result.errors).toEqual([]);
        expect(greaterThanZero.names).toEqual(['zero-star', 'one']);
        expect(lessThanOne.names).toEqual(['zero', 'zero-star']);
        expect(greaterThanOrEqualOne.names).toEqual(['one']);
        expect(exactZero.names).toEqual(['zero']);
        expect(exactZeroStar.names).toEqual(['zero-star']);
    });

    it('supports slot wildcards mixed with Alpha Strike zero-star values', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'third-zero-star', specials: ['FLK1/2/0*'] },
            { id: 2, name: 'all-zero-star', specials: ['FLK0*/0*/0*'] },
            { id: 3, name: 'third-zero', specials: ['FLK1/2/0'] },
            { id: 4, name: 'third-one', specials: ['FLK1/2/1'] },
            { id: 5, name: 'turret-third-zero-star', specials: ['TUR(0*/0*/0*,FLK2/3/0*)'] },
        ];
        const result = filterASSpecialUnitNames(units, 'specials=FLK*/*/0*');

        expect(result.result.errors).toEqual([]);
        expect(result.names).toEqual(['third-zero-star', 'all-zero-star', 'turret-third-zero-star']);
    });

    it('keeps Alpha Strike bracket sets intact when mixed with other values', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'car-one', specials: ['CAR1'] },
            { id: 2, name: 'car-two', specials: ['CAR2'] },
            { id: 3, name: 'tag-only', specials: ['TAG'] },
            { id: 4, name: 'car-four-turret', specials: ['TUR(0/0/0,CAR4)'] },
        ];
        const result = filterASSpecialUnitNames(units, 'specials=CAR[2,4],TAG');

        expect(result.result.errors).toEqual([]);
        expect(result.result.tokens[0]).toEqual(jasmine.objectContaining({ values: ['CAR[2,4]', 'TAG'] }));
        expect(result.names).toEqual(['car-two', 'tag-only', 'car-four-turret']);
    });

    it('treats malformed Alpha Strike numeric special syntax as a literal non-match', () => {
        const units: ASSpecialTestUnit[] = [
            { id: 1, name: 'car-two', specials: ['CAR2'] },
            { id: 2, name: 'car-four', specials: ['CAR4'] },
        ];
        const result = filterASSpecialUnitNames(units, 'specials=CAR[2,nope]');

        expect(result.result.errors).toEqual([]);
        expect(result.result.tokens[0]).toEqual(jasmine.objectContaining({ values: ['CAR[2,nope]'] }));
        expect(result.names).toEqual([]);
    });
});
