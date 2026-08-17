// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { TemplateRef } from '@angular/core';
import type { DataTableCellContext, DataTableColumn } from '../components/data-table/data-table.component';
import { GameSystem } from '../models/common.model';
import type { Unit } from '../models/units.model';
import {
    buildUnitDataTableColumns,
    getUnitDataTableSortSlotHeader,
    isUnitDataTableSortActive,
} from './unit-data-table.util';

interface TestRow {
    unit: Unit | null;
}

describe('unit data table utilities', () => {
    const template = {} as TemplateRef<DataTableCellContext<TestRow>>;
    const templates = {
        icon: template,
        name: template,
        year: template,
        value: template,
        movement: template,
        type: template,
        specials: template,
    };

    it('treats composite damage and movement sorts as visible', () => {
        const sortOptions = [{ key: 'heat', label: 'Heat' }];

        expect(getUnitDataTableSortSlotHeader(
            GameSystem.ALPHA_STRIKE,
            'as.dmg._dmgM',
            sortOptions,
        )).toBeNull();
        expect(getUnitDataTableSortSlotHeader(
            GameSystem.CLASSIC,
            'jump',
            sortOptions,
        )).toBeNull();
        expect(getUnitDataTableSortSlotHeader(
            GameSystem.CLASSIC,
            'heat',
            sortOptions,
        )).toBe('Heat');
        expect(isUnitDataTableSortActive('run', 'movement')).toBeTrue();
        expect(isUnitDataTableSortActive('as.dmg._dmgL', 'as.damage')).toBeTrue();
    });

    it('builds the Classic column set with caller-specific crew and trailing columns', () => {
        const unit = {
            type: 'Mek',
            subtype: 'BattleMek',
            role: 'Brawler',
            tons: 55,
            year: 3025,
            level: 'Standard',
            _techBaseDisplay: 'Inner Sphere',
            walk: 5,
            run: 8,
            run2: 8,
            jump: 5,
            umu: 0,
            armor: 152,
            internal: 91,
            _mdSumNoPhysical: 20,
            dpt: 13.5,
            c3: '',
            cost: 5_000_000,
        } as Unit;
        const crewColumn: DataTableColumn<TestRow> = {
            id: 'skill',
            header: 'G/P',
            track: 56,
            value: () => '3/4',
        };

        const columns = buildUnitDataTableColumns<TestRow>({
            gameSystem: GameSystem.CLASSIC,
            getUnit: row => row.unit,
            isSortActive: key => key === 'movement',
            templates,
            afterValueColumns: [crewColumn],
            sortSlot: { header: 'Heat', value: () => 10 },
            trailingColumns: [{ id: 'actions', header: '', track: 40 }],
        });

        expect(columns.map(column => column.id)).toEqual([
            'icon', 'name', 'type', 'subtype', 'role', 'bv', 'skill', 'tons', 'year',
            'rules', 'tech', 'movement', 'armor', 'structure', 'firepower',
            'damage-per-turn', 'network', 'cost', 'sort-slot', 'actions',
        ]);
        expect(columns.find(column => column.id === 'movement')?.sortActive).toBeTrue();
        expect(columns.find(column => column.id === 'tons')?.value?.({ unit }, 0)).toBe('55');
        expect(columns.find(column => column.id === 'type')?.value?.({ unit: null }, 0)).toBe('');
    });

    it('builds the Alpha Strike column set without Classic-only stats', () => {
        const skillColumn: DataTableColumn<TestRow> = {
            id: 'skill',
            header: 'Skill',
            track: 40,
        };

        const columns = buildUnitDataTableColumns<TestRow>({
            gameSystem: GameSystem.ALPHA_STRIKE,
            getUnit: row => row.unit,
            isSortActive: () => false,
            templates,
            afterValueColumns: [skillColumn],
        });

        expect(columns.map(column => column.id)).toEqual([
            'icon', 'name', 'year', 'type', 'role', 'pv', 'skill', 'sz', 'mv',
            'tmm', 'damage', 'arm', 'str', 'ov', 'specials',
        ]);
        expect(columns.some(column => column.id === 'tons')).toBeFalse();
        expect(columns.some(column => column.id === 'bv')).toBeFalse();
    });
});
