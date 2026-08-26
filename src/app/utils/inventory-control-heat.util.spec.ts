// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { asComponentId } from '../models/entity/entity-identifiers';
import {
    formatInventoryControlHeat,
    resolveHeatSummarySources,
    resolveInventoryControlHeat,
    resolveInventoryControlHeatEffect,
    resolveSelectedInventoryWeaponHeat,
    resolveSelectedWeaponFiringHeatSources,
    resolveSelectedWeaponPreviewHeatSources,
    type InventoryControlHeatComponentFacts,
} from './inventory-control-heat.util';

describe('inventory-control heat resolution', () => {
    it('resolves model heat and applies typed effects once', () => {
        const entry = component(3);
        const applyHeatEffects = jasmine.createSpy('applyHeatEffects').and.returnValue({ value: 5, weakened: true });

        expect(resolveInventoryControlHeat(entry, { applyHeatEffects })).toBe(5);
        expect(resolveInventoryControlHeatEffect(entry, { applyHeatEffects })).toEqual({ value: 5, weakened: true });
        expect(applyHeatEffects).toHaveBeenCalledWith(entry.componentId, { value: 3, weakened: false });
    });

    it('clamps negative effects and rejects non-finite effects', () => {
        expect(resolveInventoryControlHeat(component(3), { applyHeatEffects: () => ({ value: -1, weakened: false }) })).toBe(0);
        expect(resolveInventoryControlHeat(component(3), { applyHeatEffects: () => ({ value: Number.NaN, weakened: false }) })).toBeNull();
    });

    it('returns null when detached facts have no base or handler-provided heat', () => {
        expect(resolveInventoryControlHeat(component(null, 'misc'))).toBeNull();
        expect(resolveInventoryControlHeat(component(null, 'missing'))).toBeNull();
    });

    it('accepts zero heat from equipment data', () => {
        expect(resolveInventoryControlHeat(component(0))).toBe(0);
    });

    it('formats integer, fractional, and typed suffixed heat without presentation parsing', () => {
        expect(formatInventoryControlHeat(0)).toBe('—');
        expect(formatInventoryControlHeat(5)).toBe('5');
        expect(formatInventoryControlHeat(2.5)).toBe('2.5');
        expect(formatInventoryControlHeat(2, '*')).toBe('2*');
        expect(formatInventoryControlHeat(1, '', 6)).toBe('1/s');
        expect(formatInventoryControlHeat(2, '*', 2)).toBe('2*/s');
    });

    it('aggregates selected weapon heat with typed effects', () => {
        const first = component(3, 'first');
        const second = component(2, 'second');
        const selection = resolveSelectedInventoryWeaponHeat(
            [first, second],
            selectedStates(first, second),
            { applyHeatEffects: (componentId, effect) => ({ ...effect, value: componentId === 'first' ? 1 : 4 }) }
        );

        expect(selection.hasSelection).toBeTrue();
        expect(selection.value).toBe(5);
        expect([...selection.entryIds]).toEqual(['first', 'second']);
    });

    it('ignores selected non-weapons and physical weapons without a typed heat effect', () => {
        const misc = component(null, 'misc');
        const physical = component(null, 'physical');

        expect(resolveSelectedInventoryWeaponHeat(
            [misc, physical],
            selectedStates(misc, physical)
        )).toEqual({
            hasSelection: false,
            value: 0,
            entryIds: new Set<string>(),
        });
    });

    it('includes handler-provided physical heat in selected firing heat', () => {
        const physical = component(null, 'vibroblade');

        const selection = resolveSelectedInventoryWeaponHeat(
            [physical],
            selectedStates(physical),
            { resolveHeatEffect: () => ({ value: 5, weakened: false }) }
        );

        expect(selection.value).toBe(5);
        expect([...selection.entryIds]).toEqual(['vibroblade']);
    });

    it('preserves committed sources when no weapon is selected', () => {
        const sources = [{ id: 'weapons', label: 'Weapons', value: 8 }];
        const effective = resolveSelectedWeaponPreviewHeatSources(sources, {
            hasSelection: false,
            value: 0,
            entryIds: new Set(),
        });

        expect(effective).toEqual(sources);
        expect(effective).not.toBe(sources);
    });

    it('replaces committed weapon heat and matching passive heat with selected heat', () => {
        const effective = resolveSelectedWeaponPreviewHeatSources([
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'capacitor-a', label: 'Capacitor A', value: 5, replacedByFiringEntryId: 'a' },
            { id: 'capacitor-b', label: 'Capacitor B', value: 2, replacedByFiringEntryId: 'b' },
            { id: 'engine', label: 'Engine', value: 3 },
        ], {
            hasSelection: true,
            value: 4,
            entryIds: new Set(['a']),
        });

        expect(effective).toEqual([
            jasmine.objectContaining({
                id: 'selected-weapons', label: 'Selected', value: 4, inventorySelection: true,
                signature: '["a"]',
            }),
            { id: 'capacitor-b', label: 'Capacitor B', value: 2, replacedByFiringEntryId: 'b' },
            { id: 'engine', label: 'Engine', value: 3 },
        ]);
    });

    it('suppresses committed weapon heat when a selected weapon produces zero heat', () => {
        const effective = resolveSelectedWeaponPreviewHeatSources([
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'engine', label: 'Engine', value: 3 },
        ], {
            hasSelection: true,
            value: 0,
            entryIds: new Set(['zero']),
        });

        expect(effective).toEqual([
            jasmine.objectContaining({
                id: 'selected-weapons', label: 'Selected', value: 0, inventorySelection: true,
            }),
            { id: 'engine', label: 'Engine', value: 3 },
        ]);
    });

    it('uses a stable signature regardless of selection order', () => {
        const selection = { hasSelection: true, value: 5, entryIds: new Set(['b', 'a']) };
        expect(resolveSelectedWeaponPreviewHeatSources([], selection)[0].signature).toBe('["a","b"]');
    });

    it('adds a selected firing batch to committed weapons while replacing matching passive heat', () => {
        expect(resolveSelectedWeaponFiringHeatSources([
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'capacitor-a', label: 'Capacitor A', value: 5, replacedByFiringEntryId: 'a' },
            { id: 'capacitor-b', label: 'Capacitor B', value: 2, replacedByFiringEntryId: 'b' },
        ], {
            hasSelection: true,
            value: 4,
            entryIds: new Set(['a']),
        })).toEqual([
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'capacitor-b', label: 'Capacitor B', value: 2, replacedByFiringEntryId: 'b' },
            jasmine.objectContaining({ id: 'selected-weapons', value: 4 }),
        ]);
    });

    it('adds selected heat to summaries without replacing committed or passive sources', () => {
        expect(resolveHeatSummarySources([
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'capacitor', label: 'Capacitor', value: 5, replacedByFiringEntryId: 'laser' },
        ], {
            hasSelection: true,
            value: 3,
            entryIds: new Set(['laser']),
        })).toEqual([
            jasmine.objectContaining({ id: 'selected-weapons', label: 'Selected', value: 3 }),
            { id: 'weapons', label: 'Weapons', value: 8 },
            { id: 'capacitor', label: 'Capacitor', value: 5, replacedByFiringEntryId: 'laser' },
        ]);
    });
});

function component(baseWeaponHeat: number | null, id = 'laser'): InventoryControlHeatComponentFacts {
    return Object.freeze({ componentId: asComponentId(id), baseWeaponHeat });
}

function selectedStates(...components: InventoryControlHeatComponentFacts[]) {
    return new Map(components.map(component => [component.componentId, { selected: true }]));
}
