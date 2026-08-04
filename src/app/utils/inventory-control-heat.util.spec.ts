import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import {
    formatInventoryControlHeat,
    resolveHeatSummarySources,
    resolveInventoryControlHeat,
    resolveInventoryControlHeatEffect,
    resolveSelectedInventoryWeaponHeat,
    resolveSelectedWeaponFiringHeatSources,
    resolveSelectedWeaponPreviewHeatSources,
} from './inventory-control-heat.util';

describe('inventory-control heat resolution', () => {
    it('resolves model heat and applies typed effects once', () => {
        const entry = weapon(3);
        const applyHeatEffects = jasmine.createSpy('applyHeatEffects').and.returnValue({ value: 5, weakened: true });

        expect(resolveInventoryControlHeat(entry, { applyHeatEffects })).toBe(5);
        expect(resolveInventoryControlHeatEffect(entry, { applyHeatEffects })).toEqual({ value: 5, weakened: true });
        expect(applyHeatEffects).toHaveBeenCalledWith(entry, { value: 3, weakened: false });
    });

    it('clamps negative effects and rejects non-finite effects', () => {
        expect(resolveInventoryControlHeat(weapon(3), { applyHeatEffects: () => ({ value: -1, weakened: false }) })).toBe(0);
        expect(resolveInventoryControlHeat(weapon(3), { applyHeatEffects: () => ({ value: Number.NaN, weakened: false }) })).toBeNull();
    });

    it('returns null for non-weapon equipment', () => {
        const entry = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'misc',
            name: 'Misc',
            equipment: new MiscEquipment({ id: 'misc', name: 'Misc', type: 'misc' })
        });

        expect(resolveInventoryControlHeat(entry)).toBeNull();
    });

    it('returns null when mounted equipment data is missing', () => {
        const entry = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'missing',
            name: 'Missing'
        });

        expect(resolveInventoryControlHeat(entry)).toBeNull();
    });

    it('accepts zero heat from equipment data', () => {
        expect(resolveInventoryControlHeat(weapon(0))).toBe(0);
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
        const first = weapon(3, 'first');
        const second = weapon(2, 'second');
        const selection = resolveSelectedInventoryWeaponHeat(
            [first, second],
            selectedStates(first, second),
            { applyHeatEffects: (entry, effect) => ({ ...effect, value: entry.id === 'first' ? 1 : 4 }) }
        );

        expect(selection.hasSelection).toBeTrue();
        expect(selection.value).toBe(5);
        expect([...selection.entryIds]).toEqual(['first', 'second']);
    });

    it('ignores selected non-weapons and physical weapons without a typed heat effect', () => {
        const misc = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'misc',
            name: 'Misc',
            equipment: new MiscEquipment({ id: 'misc', name: 'Misc', type: 'misc' })
        });
        const physical = weapon(3, 'physical');
        spyOn(physical, 'isPhysicalWeapon').and.returnValue(true);

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
        const physical = new MountedEquipment({
            owner: {} as CBTForceUnit,
            id: 'vibroblade',
            name: 'Vibroblade',
            equipment: new MiscEquipment({ id: 'vibroblade', name: 'Vibroblade', type: 'misc', flags: ['F_CLUB'] })
        });

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

function weapon(heat: number, id = 'laser'): MountedEquipment {
    const equipment = new WeaponEquipment({
        id,
        name: 'Laser',
        type: 'weapon',
        weapon: { heat }
    });
    return new MountedEquipment({
        owner: {} as CBTForceUnit,
        id: equipment.id,
        name: equipment.name,
        equipment
    });
}

function selectedStates(...entries: MountedEquipment[]) {
    return new Map(entries.map(entry => [entry.id, { selected: true }]));
}