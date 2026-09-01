// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { TemplateRef } from '@angular/core';
import { GameSystem } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { FormatNumberPipe } from '../pipes/format-number.pipe';
import type { DataTableCellContext, DataTableColumn } from '../components/data-table/data-table.component';
import { formatASDamageValue, isASDamageFilterKey } from './as-damage.util';
import { formatMovement } from './as-common.util';

export const UNIT_DATA_TABLE_SORT_KEY_GROUPS: Readonly<Record<string, readonly string[]>> = {
    'as.damage': ['as.dmg._dmgS', 'as.dmg._dmgM', 'as.dmg._dmgL', 'as.dmg._dmgE'],
    movement: ['walk', 'run', 'jump', 'umu'],
};

const UNIT_DATA_TABLE_VISIBLE_SORT_KEYS: Readonly<Record<GameSystem, readonly string[]>> = {
    [GameSystem.AS]: [
        'name', 'year', 'as.TP', 'role', 'as.PV', 'as.SZ', 'as._mv', 'as.TMM',
        'as.Arm', 'as.Str', 'as.OV',
    ],
    [GameSystem.CBT]: [
        'name', 'type', 'subtype', 'role', 'bv', 'tons', 'year', 'level',
        '_techBaseDisplay', 'moveType', 'armor', 'internal', '_mdSumNoPhysical',
        'dpt', 'c3', 'cost',
    ],
};

const UNIT_DATA_TABLE_VISIBLE_SORT_GROUPS: Readonly<Record<GameSystem, readonly string[]>> = {
    [GameSystem.AS]: ['as.damage'],
    [GameSystem.CBT]: ['movement'],
};

export interface UnitDataTableSortOption {
    readonly key: string;
    readonly label: string;
    readonly slotLabel?: string;
}

export interface UnitDataTableCellTemplates<Row> {
    readonly icon: TemplateRef<DataTableCellContext<Row>>;
    readonly name: TemplateRef<DataTableCellContext<Row>>;
    readonly year: TemplateRef<DataTableCellContext<Row>>;
    readonly value: TemplateRef<DataTableCellContext<Row>>;
    readonly movement: TemplateRef<DataTableCellContext<Row>>;
    readonly type?: TemplateRef<DataTableCellContext<Row>>;
    readonly specials?: TemplateRef<DataTableCellContext<Row>>;
}

export interface UnitDataTableSortSlot<Row> {
    readonly header: string;
    readonly value: (row: Row, index: number) => unknown;
    readonly track?: number;
}

export interface UnitDataTableColumnOptions<Row> {
    readonly gameSystem: GameSystem;
    readonly getUnit: (row: Row) => UnitSummary | null | undefined;
    readonly isSortActive: (keyOrGroup: string) => boolean;
    readonly templates: UnitDataTableCellTemplates<Row>;
    readonly valueTrack?: number;
    readonly afterValueColumns?: readonly DataTableColumn<Row>[];
    readonly sortSlot?: UnitDataTableSortSlot<Row> | null;
    readonly trailingColumns?: readonly DataTableColumn<Row>[];
}

/** Returns true when a selected sort is represented by a standard table column. */
export function isUnitDataTableSortVisible(gameSystem: GameSystem, sortKey: string): boolean {
    if (UNIT_DATA_TABLE_VISIBLE_SORT_KEYS[gameSystem].includes(sortKey)) {
        return true;
    }

    return UNIT_DATA_TABLE_VISIBLE_SORT_GROUPS[gameSystem].some(groupName =>
        UNIT_DATA_TABLE_SORT_KEY_GROUPS[groupName]?.includes(sortKey) === true
    );
}

/** Resolves the optional extra-column label used for a non-standard sort. */
export function getUnitDataTableSortSlotHeader(
    gameSystem: GameSystem,
    sortKey: string,
    sortOptions: readonly UnitDataTableSortOption[],
): string | null {
    if (!sortKey || isUnitDataTableSortVisible(gameSystem, sortKey)) {
        return null;
    }

    const option = sortOptions.find(candidate => candidate.key === sortKey);
    return option?.slotLabel ?? option?.label ?? sortKey;
}

/** Matches direct sort keys and composite table columns such as movement or AS damage. */
export function isUnitDataTableSortActive(
    currentSort: string,
    ...keysOrGroups: readonly string[]
): boolean {
    if (!currentSort) {
        return false;
    }

    return keysOrGroups.some(keyOrGroup =>
        keyOrGroup === currentSort
        || UNIT_DATA_TABLE_SORT_KEY_GROUPS[keyOrGroup]?.includes(currentSort) === true
    );
}

/** Formats a sort value that is not already represented by a standard table column. */
export function formatUnitDataTableSortSlotValue(
    unit: UnitSummary,
    sortKey: string,
    resolveRawValue: (unit: UnitSummary, key: string) => unknown = getNestedProperty,
): string {
    if (UNIT_DATA_TABLE_SORT_KEY_GROUPS['movement']?.includes(sortKey)) {
        return formatCBTUnitMovement(unit) || '—';
    }

    if (sortKey === 'subtype') {
        return formatCBTUnitSubtype(unit) || '—';
    }

    const rawValue = resolveRawValue(unit, sortKey);
    if (rawValue == null) {
        return '—';
    }

    if (typeof rawValue === 'number' && isASDamageFilterKey(sortKey)) {
        return formatASDamageValue(rawValue);
    }

    return typeof rawValue === 'number'
        ? FormatNumberPipe.formatValue(rawValue, true, false)
        : String(rawValue);
}

export function formatCBTUnitMovement(unit: UnitSummary): string {
    if (!unit.walk) {
        return '';
    }

    let movement = `${unit.walk} / ${unit.run}`;
    if (unit.run2 && unit.run2 !== unit.run) {
        movement += ` [${unit.run2}]`;
    }
    if (unit.jump) {
        movement += ` / ${unit.jump}`;
    }
    if (unit.umu) {
        movement += ` / ${unit.umu}`;
    }

    return movement;
}

export function formatCBTUnitSubtype(unit: UnitSummary): string {
    return unit.subtype && unit.subtype !== unit.type ? unit.subtype : '';
}

export function formatCBTUnitStat(value: number | undefined): string {
    return value == null ? '—' : FormatNumberPipe.formatValue(value, true, false);
}

export function formatUnitTons(tons: number | undefined): string {
    if (tons === undefined) {
        return '';
    }

    const rounded = (value: number) => Math.round(value * 100) / 100;
    if (tons < 1_000) {
        return `${rounded(tons)}`;
    }
    if (tons < 1_000_000) {
        return `${rounded(tons / 1_000)}k`;
    }
    return `${rounded(tons / 1_000_000)}M`;
}

export function formatAlphaStrikeUnitMovement(unit: UnitSummary, useHex: boolean): string {
    const movementModes = unit.as.MVm;
    if (!movementModes) {
        return unit.as.MV ?? '';
    }

    const entries = Object.entries(movementModes)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
        .sort(([firstMode], [secondMode]) => {
            if (firstMode === '') return -1;
            if (secondMode === '') return 1;
            return 0;
        });

    return entries.length > 0
        ? entries.map(([mode, inches]) => formatMovement(inches, mode, useHex)).join('/')
        : unit.as.MV ?? '';
}

/** Builds the shared AS or CBT unit-stat columns used by search and force overview. */
export function buildUnitDataTableColumns<Row>(
    options: UnitDataTableColumnOptions<Row>,
): readonly DataTableColumn<Row>[] {
    return options.gameSystem === GameSystem.AS
        ? buildAlphaStrikeColumns(options)
        : buildCBTColumns(options);
}

function buildAlphaStrikeColumns<Row>(options: UnitDataTableColumnOptions<Row>): DataTableColumn<Row>[] {
    const { templates } = options;
    const value = unitValue(options.getUnit);
    const columns: DataTableColumn<Row>[] = [
        iconColumn(templates.icon),
        nameColumn(templates.name, options.isSortActive),
        yearColumn(templates.year, options.isSortActive),
        {
            id: 'type',
            header: 'Type',
            track: 50,
            ...(templates.type ? { cellTemplate: templates.type } : { value: value(unit => unit.as.TP) }),
            sortKey: 'as.TP',
            sortActive: options.isSortActive('as.TP'),
            cellClass: tableCellClass('as-td-type', options.isSortActive('as.TP')),
            align: 'center',
        },
        {
            id: 'role',
            header: 'Role',
            track: 130,
            value: value(unit => unit.role !== 'None' ? unit.role : ''),
            sortKey: 'role',
            sortActive: options.isSortActive('role'),
            cellClass: tableCellClass('as-td-role', options.isSortActive('role')),
        },
        {
            id: 'pv',
            header: 'PV',
            track: options.valueTrack ?? 45,
            cellTemplate: templates.value,
            sortKey: 'as.PV',
            sortActive: options.isSortActive('as.PV'),
            cellClass: tableCellClass('as-td-pv is-bold', options.isSortActive('as.PV')),
            align: 'right',
        },
        ...(options.afterValueColumns ?? []),
        {
            id: 'sz',
            header: 'SZ',
            track: 30,
            value: value(unit => unit.as.SZ),
            sortKey: 'as.SZ',
            sortActive: options.isSortActive('as.SZ'),
            cellClass: tableCellClass('as-td-sz', options.isSortActive('as.SZ')),
            align: 'center',
        },
        {
            id: 'mv',
            header: 'MV',
            track: 65,
            cellTemplate: templates.movement,
            sortKey: 'as._mv',
            sortActive: options.isSortActive('as._mv'),
            cellClass: tableCellClass('as-td-mv', options.isSortActive('as._mv')),
            align: 'center',
        },
        {
            id: 'tmm',
            header: 'TMM',
            track: 40,
            value: value(unit => unit.as.TMM ?? '—'),
            sortKey: 'as.TMM',
            sortActive: options.isSortActive('as.TMM'),
            cellClass: tableCellClass('as-td-tmm', options.isSortActive('as.TMM')),
            align: 'center',
        },
        {
            id: 'damage',
            header: 'S/M/L',
            track: 60,
            value: value(unit => !unit.as.usesArcs
                ? `${unit.as.dmg.dmgS}/${unit.as.dmg.dmgM}/${unit.as.dmg.dmgL}`
                : ''),
            sortKey: 'as.dmg._dmgS',
            sortGroupKey: 'as.damage',
            sortActive: options.isSortActive('as.damage'),
            cellClass: tableCellClass('as-td-dmg', options.isSortActive('as.damage')),
            align: 'center',
        },
        {
            id: 'arm',
            header: 'A',
            track: 40,
            value: value(unit => unit.as.Arm),
            sortKey: 'as.Arm',
            sortActive: options.isSortActive('as.Arm'),
            cellClass: tableCellClass('as-td-arm', options.isSortActive('as.Arm')),
            align: 'center',
        },
        {
            id: 'str',
            header: 'S',
            track: 40,
            value: value(unit => unit.as.Str),
            sortKey: 'as.Str',
            sortActive: options.isSortActive('as.Str'),
            cellClass: tableCellClass('as-td-str', options.isSortActive('as.Str')),
            align: 'center',
        },
        {
            id: 'ov',
            header: 'OV',
            track: 30,
            value: value(unit => unit.as.usesOV ? unit.as.OV : ''),
            sortKey: 'as.OV',
            sortActive: options.isSortActive('as.OV'),
            cellClass: tableCellClass('as-td-ov', options.isSortActive('as.OV')),
            align: 'center',
        },
    ];

    appendSortSlot(columns, options.sortSlot, 80);
    if (templates.specials) {
        columns.push({
            id: 'specials',
            header: 'Special',
            track: { minPx: 220, flex: 1 },
            cellTemplate: templates.specials,
        });
    }
    columns.push(...(options.trailingColumns ?? []));
    return columns;
}

function buildCBTColumns<Row>(options: UnitDataTableColumnOptions<Row>): DataTableColumn<Row>[] {
    const { templates } = options;
    const value = unitValue(options.getUnit);
    const columns: DataTableColumn<Row>[] = [
        iconColumn(templates.icon),
        nameColumn(templates.name, options.isSortActive),
        {
            id: 'type',
            header: 'Type',
            track: 100,
            value: value(unit => unit.type),
            sortKey: 'type',
            sortActive: options.isSortActive('type'),
            cellClass: tableCellClass('cbt-td-type', options.isSortActive('type')),
        },
        {
            id: 'subtype',
            header: 'Subtype',
            track: 130,
            value: value(formatCBTUnitSubtype),
            sortKey: 'subtype',
            sortActive: options.isSortActive('subtype'),
            cellClass: tableCellClass('cbt-td-subtype', options.isSortActive('subtype')),
        },
        {
            id: 'role',
            header: 'Role',
            track: 130,
            value: value(unit => unit.role !== 'None' ? unit.role : ''),
            sortKey: 'role',
            sortActive: options.isSortActive('role'),
            cellClass: tableCellClass('as-td-role', options.isSortActive('role')),
        },
        {
            id: 'bv',
            header: 'BV',
            track: options.valueTrack ?? 78,
            cellTemplate: templates.value,
            sortKey: 'bv',
            sortActive: options.isSortActive('bv'),
            cellClass: tableCellClass('cbt-td-bv is-bold', options.isSortActive('bv')),
            align: 'right',
        },
        ...(options.afterValueColumns ?? []),
        {
            id: 'tons',
            header: 'Tons',
            track: 64,
            value: value(unit => formatUnitTons(unit.tons)),
            sortKey: 'tons',
            sortActive: options.isSortActive('tons'),
            cellClass: tableCellClass('cbt-td-tons', options.isSortActive('tons')),
            align: 'right',
        },
        yearColumn(templates.year, options.isSortActive),
        {
            id: 'rules',
            header: 'Rules',
            track: 108,
            value: value(unit => unit.level),
            sortKey: 'level',
            sortActive: options.isSortActive('level'),
            cellClass: tableCellClass('cbt-td-rules', options.isSortActive('level')),
        },
        {
            id: 'tech',
            header: 'Tech',
            track: 100,
            value: value(unit => unit._techBaseDisplay),
            sortKey: '_techBaseDisplay',
            sortActive: options.isSortActive('_techBaseDisplay'),
            cellClass: tableCellClass('cbt-td-tech', options.isSortActive('_techBaseDisplay')),
        },
        {
            id: 'movement',
            header: 'Move',
            track: 96,
            cellTemplate: templates.movement,
            sortKey: 'walk',
            sortGroupKey: 'movement',
            sortActive: options.isSortActive('movement'),
            cellClass: tableCellClass('cbt-td-mv', options.isSortActive('movement')),
        },
        {
            id: 'armor',
            header: 'Armor',
            track: 72,
            value: value(unit => unit.armor),
            sortKey: 'armor',
            sortActive: options.isSortActive('armor'),
            cellClass: tableCellClass('cbt-td-armor', options.isSortActive('armor')),
            align: 'right',
        },
        {
            id: 'structure',
            header: 'Structure',
            track: 86,
            value: value(unit => unit.internal),
            sortKey: 'internal',
            sortActive: options.isSortActive('internal'),
            cellClass: tableCellClass('cbt-td-structure', options.isSortActive('internal')),
            align: 'right',
        },
        {
            id: 'firepower',
            header: 'Firepower',
            track: 88,
            value: value(unit => formatCBTUnitStat(unit._mdSumNoPhysical)),
            sortKey: '_mdSumNoPhysical',
            sortActive: options.isSortActive('_mdSumNoPhysical'),
            cellClass: tableCellClass('cbt-td-firepower', options.isSortActive('_mdSumNoPhysical')),
            align: 'right',
        },
        {
            id: 'damage-per-turn',
            header: 'Dmg/Turn',
            track: 92,
            value: value(unit => formatCBTUnitStat(unit.dpt)),
            sortKey: 'dpt',
            sortActive: options.isSortActive('dpt'),
            cellClass: tableCellClass('cbt-td-dpt', options.isSortActive('dpt')),
            align: 'right',
        },
        {
            id: 'network',
            header: 'Network',
            track: 96,
            value: value(unit => unit.c3 ?? ''),
            sortKey: 'c3',
            sortActive: options.isSortActive('c3'),
            cellClass: tableCellClass('cbt-td-network', options.isSortActive('c3')),
        },
        {
            id: 'cost',
            header: 'Cost',
            track: 110,
            value: value(unit => unit.cost ? FormatNumberPipe.formatValue(unit.cost, true, false) : ''),
            sortKey: 'cost',
            sortActive: options.isSortActive('cost'),
            cellClass: tableCellClass('cbt-td-cost', options.isSortActive('cost')),
            align: 'right',
        },
    ];

    appendSortSlot(columns, options.sortSlot, 100);
    columns.push(...(options.trailingColumns ?? []));
    return columns;
}

function iconColumn<Row>(template: TemplateRef<DataTableCellContext<Row>>): DataTableColumn<Row> {
    return {
        id: 'icon',
        header: '',
        track: 40,
        cellTemplate: template,
        align: 'center',
    };
}

function nameColumn<Row>(
    template: TemplateRef<DataTableCellContext<Row>>,
    isSortActive: (keyOrGroup: string) => boolean,
): DataTableColumn<Row> {
    return {
        id: 'name',
        header: 'Name',
        track: { minPx: 320, flex: 1.35 },
        cellTemplate: template,
        sortKey: 'name',
        sortActive: isSortActive('name'),
    };
}

function yearColumn<Row>(
    template: TemplateRef<DataTableCellContext<Row>>,
    isSortActive: (keyOrGroup: string) => boolean,
): DataTableColumn<Row> {
    return {
        id: 'year',
        header: 'Year',
        track: 72,
        cellTemplate: template,
        sortKey: 'year',
        sortActive: isSortActive('year'),
        cellClass: tableCellClass('as-td-year', isSortActive('year')),
        align: 'center',
    };
}

function appendSortSlot<Row>(
    columns: DataTableColumn<Row>[],
    sortSlot: UnitDataTableSortSlot<Row> | null | undefined,
    defaultTrack: number,
): void {
    if (!sortSlot) {
        return;
    }

    columns.push({
        id: 'sort-slot',
        header: sortSlot.header,
        track: sortSlot.track ?? defaultTrack,
        value: sortSlot.value,
        headerClass: 'as-th-sort-slot',
        cellClass: 'as-td-sort-slot sort-slot',
        align: 'center',
    });
}

function unitValue<Row>(
    getUnit: (row: Row) => UnitSummary | null | undefined,
): (formatter: (unit: UnitSummary) => unknown) => (row: Row) => unknown {
    return formatter => row => {
        const unit = getUnit(row);
        return unit ? formatter(unit) : '';
    };
}

function tableCellClass(base: string, active: boolean): string {
    return active ? `${base} sort-slot` : base;
}

function getNestedProperty(unit: UnitSummary, key: string): unknown {
    if (!key) {
        return undefined;
    }

    let current: unknown = unit;
    for (const part of key.split('.')) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
