// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { CORE_2026_GAME_RULES } from '../models/rules/game-rules';
import {
    buildReferenceTableView,
    defaultReferenceTableOption,
    FULL_CLUSTER_SIZES,
    hasUnitDefaultReferenceTables,
    REFERENCE_TABLE_GROUPS,
    resolveReferenceTableRoll,
    type ReferenceTableBuildContext,
    type ReferenceTableOptionId,
} from './reference-table-definition';

describe('reference-table-definition', () => {
    const context: ReferenceTableBuildContext = {
        physicalRows: CORE_2026_GAME_RULES.physicalLocationRows,
        clusterSizes: [5],
        clusterNotes: [{ id: 'hag', text: 'HAG note' }],
    };

    function table(option: ReferenceTableOptionId, key: string) {
        const view = buildReferenceTableView(option, context);
        return [...view.tables, ...(view.combinedTable ? [view.combinedTable] : [])]
            .find(candidate => candidate.key === key)!;
    }

    it('defines the requested groups and subtypes', () => {
        expect(REFERENCE_TABLE_GROUPS.map(group => [group.label, ...group.options.map(option => option.label)]))
            .toEqual([
                ['Cluster', 'Full Table'],
                ['Mek', 'Biped', 'Tripod', 'Quad'],
                ['Vehicle', 'Ground', 'Superheavy', 'VTOL'],
                ['Infantry', 'Battle Armor', 'Conventional'],
            ]);
    });

    it('keeps every catalog table structurally complete', () => {
        const optionIds = REFERENCE_TABLE_GROUPS.flatMap(group => group.options.map(option => option.id));

        for (const optionId of optionIds) {
            const view = buildReferenceTableView(optionId, context);
            const tables = [...view.tables, ...(view.combinedTable ? [view.combinedTable] : [])];
            for (const candidate of tables) {
                expect(new Set(candidate.columns.map(column => column.key)).size)
                    .withContext(`${candidate.key} column keys`).toBe(candidate.columns.length);
                expect(new Set(candidate.rows.map(row => row.key)).size)
                    .withContext(`${candidate.key} row keys`).toBe(candidate.rows.length);
                expect(candidate.headerGroups?.reduce((sum, group) => sum + group.span, 0) ?? candidate.columns.length)
                    .withContext(`${candidate.key} header groups`).toBe(candidate.columns.length);
                for (const row of candidate.rows) {
                    expect(candidate.columns.every(column => row.cells[column.key] !== undefined))
                        .withContext(`${candidate.key}/${row.key} cells`).toBeTrue();
                    expect(candidate.dice === undefined || row.roll !== undefined)
                        .withContext(`${candidate.key}/${row.key} roll range`).toBeTrue();
                }
            }
        }
    });

    it('selects a default from unit identity without conflating it with unit type', () => {
        expect(defaultReferenceTableOption({ type: 'Mek', subtype: 'Tripod BattleMek' })).toBe('mek-tripod');
        expect(defaultReferenceTableOption({ type: 'VTOL', subtype: 'Combat Vehicle' })).toBe('vehicle-vtol');
        expect(defaultReferenceTableOption({
            type: 'Tank', subtype: 'Support Vehicle', weightClass: 'Large Support Vehicle', tons: 150,
        })).toBe('vehicle-ground-superheavy');
        expect(defaultReferenceTableOption({ type: 'Infantry', subtype: 'Battle Armor' })).toBe('infantry-battle-armor');
        expect(defaultReferenceTableOption({ type: 'Infantry', subtype: 'Conventional Infantry' }))
            .toBe('infantry-conventional');
        expect(hasUnitDefaultReferenceTables({ type: 'Tank' })).toBeTrue();
        expect(hasUnitDefaultReferenceTables({ type: 'Aero' })).toBeFalse();
    });

    it('resolves Mek, physical, and merged cluster rolls through the same API', () => {
        const view = buildReferenceTableView('mek-biped', context);
        const location = view.tables.find(candidate => candidate.key === 'mek-biped-locations')!;
        const physical = view.tables.find(candidate => candidate.key === 'mek-physical-locations')!;
        const combined = view.combinedTable!;

        expect(resolveReferenceTableRoll(location, 'frontRear', 7)?.value).toBe('CT');
        expect(resolveReferenceTableRoll(physical, 'kickFrontRear', 4)?.value).toBe('LL');
        expect(resolveReferenceTableRoll(combined, 'rack-5', 7)?.value).toBe('3');
        expect(resolveReferenceTableRoll(combined, 'frontRear', 7)?.source).toEqual({
            tableKey: 'mek-biped-locations',
            tableLabel: 'Biped',
        });
        expect(resolveReferenceTableRoll(combined, 'rack-5', 7)?.source).toEqual({
            tableKey: 'cluster-unit',
            tableLabel: 'Cluster',
        });
        expect(combined.shortTitle).toBe('Biped + Cluster');
        expect(combined.columns.map(column => column.label)).toEqual(['LS', 'F/R', 'RS', '5']);
    });

    it('builds the canonical full cluster table', () => {
        const fullContext = { ...context, clusterSizes: [] };
        const full = buildReferenceTableView('cluster-full', fullContext).tables[0];

        expect(full.columns.map(column => Number(column.label))).toEqual(FULL_CLUSTER_SIZES);
        expect(full.rows).toHaveSize(11);
        expect(resolveReferenceTableRoll(full, 'rack-40', 7)?.value).toBe('24');
    });

    it('contains ground vehicle hit, motive, modifier, and critical tables', () => {
        const view = buildReferenceTableView('vehicle-ground', { ...context, clusterSizes: [] });
        const keys = view.tables.map(candidate => candidate.key);
        const locations = view.tables[0];
        const motive = view.tables.find(candidate => candidate.key === 'vehicle-motive-damage')!;
        const modifiers = view.tables.find(candidate => candidate.key === 'vehicle-motive-modifiers')!;
        const critical = view.tables.find(candidate => candidate.key === 'vehicle-ground-critical')!;

        expect(keys).toEqual([
            'vehicle-ground-locations',
            'vehicle-motive-damage',
            'vehicle-motive-modifiers',
            'vehicle-ground-critical',
        ]);
        expect(resolveReferenceTableRoll(locations, 'side', 8)?.value).toBe('Side (critical)*');
        expect(resolveReferenceTableRoll(motive, 'effect', 9)?.value).toContain('Moderate damage');
        expect(resolveReferenceTableRoll(critical, 'rear', 12)?.value).toBe('Fuel Tank*');
        expect(critical.notes?.some(note => note.includes('Fuel Cell'))).toBeTrue();
        expect(critical.notes?.some(note => note.includes('locations without weapons'))).toBeTrue();
        expect(modifiers.dice).toBeUndefined();
        expect(resolveReferenceTableRoll(modifiers, 'modifier', 7)).toBeNull();
    });

    it('uses four attack directions for large support and superheavy ground vehicles', () => {
        const locations = table('vehicle-ground-superheavy', 'vehicle-superheavy-locations');

        expect(locations.columns.map(column => column.label)).toEqual(['FRONT', 'REAR', 'FRONT SIDE§', 'REAR SIDE§']);
        expect(resolveReferenceTableRoll(locations, 'frontSide', 2)?.value).toBe('Side (critical)');
        expect(resolveReferenceTableRoll(locations, 'frontSide', 3)?.value).toBe('Front†');
        expect(resolveReferenceTableRoll(locations, 'rearSide', 3)?.value).toBe('Rear†');
        expect(resolveReferenceTableRoll(locations, 'frontSide', 8)?.value).toBe('Side (critical)*');
        expect(locations.notes?.find(note => note.startsWith('§'))).toContain('Front Right Attack Direction');
    });

    it('contains VTOL location and critical results without ground motive tables', () => {
        const view = buildReferenceTableView('vehicle-vtol', { ...context, clusterSizes: [] });
        const locations = view.tables[0];
        const critical = view.tables[1];

        expect(view.tables.map(candidate => candidate.key)).toEqual([
            'vehicle-vtol-locations',
            'vehicle-vtol-critical',
        ]);
        expect(resolveReferenceTableRoll(locations, 'front', 3)?.value).toBe('Rotors†');
        expect(resolveReferenceTableRoll(critical, 'rotors', 11)?.value).toBe('Rotors Destroyed');
    });

    it('marks only the Battle Armor swarm location table as rollable', () => {
        const view = buildReferenceTableView('infantry-battle-armor', context);
        const rollable = view.tables.filter(candidate => candidate.dice);
        const swarm = rollable[0];

        expect(rollable.map(candidate => candidate.key)).toEqual(['battle-armor-swarm-locations']);
        expect(resolveReferenceTableRoll(swarm, 'quad', 3)?.value).toBe('Front Right Torso');
        expect(view.tables.find(candidate => candidate.key === 'battle-armor-leg-attacks')?.dice).toBeUndefined();
    });

    it('marks only naturally narrow infantry tables as compact', () => {
        const battleArmor = buildReferenceTableView('infantry-battle-armor', context);
        const conventional = buildReferenceTableView('infantry-conventional', context);

        expect(battleArmor.tables.filter(candidate => candidate.layout === 'compact').map(candidate => candidate.key))
            .toEqual([
                'battle-armor-leg-attacks',
                'battle-armor-swarm-attacks',
                'battle-armor-swarm-equipment',
                'battle-armor-swarm-situations',
                'battle-armor-transport-positions',
                'battle-armor-large-support-positions',
            ]);
        expect(conventional.tables.filter(candidate => candidate.layout === 'compact').map(candidate => candidate.key))
            .toEqual(['conventional-burst-fire-vehicles', 'conventional-burst-fire-ba']);
    });

    it('keeps conventional infantry damage references informational', () => {
        const view = buildReferenceTableView('infantry-conventional', context);

        expect(view.tables).toHaveSize(3);
        expect(view.tables.every(candidate => candidate.dice === undefined)).toBeTrue();
        expect(view.tables[0].rows[0].cells['damage']).toBe('2D6');
    });
});
