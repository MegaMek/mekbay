// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from './equipment.model';
import { MountedAmmo, MountedWeapon } from './mounted-equipment.model';
import { createCBTForceUnitTestHarness, type CBTForceUnitTestHarness } from '../testing/unit-test-helpers';
import {
    getInventoryControlAmmoProfileId,
    getInventoryControlAmmoSelectionOptions,
    getInventoryControlModeAmmoSummary,
    resolveInventoryControlSelectedAmmoOption,
} from '../utils/inventory-control.util';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE } from './rules/unit-type-rules';

describe('CBTInventoryControlRuntime ammo selection reconciliation', () => {
    it('preserves a valid profile and source and can recover the profile from the actual source ID', () => {
        const fixture = createAmmoFixture();
        const rightArmSourceId = `${fixture.standard.internalName}:RA`;

        fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
            selectedProfileId: null,
            preferredSourceOptionId: rightArmSourceId,
        });
        fixture.harness.runtime.markAmmoSourcesChanged();

        expect(fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id)).toEqual({
            selectedProfileId: getInventoryControlAmmoProfileId(fixture.standard),
            preferredSourceOptionId: rightArmSourceId,
        });
    });

    it('recovers a profile from a valid preferred source when the persisted profile is stale', () => {
        const fixture = createAmmoFixture();
        const rightArmSourceId = `${fixture.standard.internalName}:RA`;

        fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
            selectedProfileId: 'removed-profile',
            preferredSourceOptionId: rightArmSourceId,
        });
        fixture.harness.runtime.markAmmoSourcesChanged();

        expect(fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id)).toEqual({
            selectedProfileId: getInventoryControlAmmoProfileId(fixture.standard),
            preferredSourceOptionId: rightArmSourceId,
        });
    });

    it('uses current location-qualified group IDs and keeps equivalent sources as one profile', () => {
        const fixture = createAmmoFixture();

        const options = getInventoryControlAmmoSelectionOptions(
            fixture.weapon,
            fixture.harness.equipmentRegistry,
        );

        expect(options.map(option => option.id)).toEqual([
            `${fixture.standard.internalName}:RA`,
            `${fixture.standard.internalName}:LT`,
            `${fixture.precision.internalName}:RT`,
        ]);
        expect(options.slice(0, 2).map(option => option.profileId)).toEqual([
            getInventoryControlAmmoProfileId(fixture.standard),
            getInventoryControlAmmoProfileId(fixture.standard),
        ]);
    });

    it('preserves the profile and clears only the preferred source when that source moves', () => {
        const fixture = createAmmoFixture();
        const standardProfileId = getInventoryControlAmmoProfileId(fixture.standard);
        fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
            selectedProfileId: standardProfileId,
            preferredSourceOptionId: `${fixture.standard.internalName}:RA`,
        });

        fixture.harness.unit.setInventoryEntry(fixture.standardRightArm.clone({
            locations: new Set(['LT']),
        }));

        const selection = fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id);
        expect(selection).toEqual({
            selectedProfileId: standardProfileId,
            preferredSourceOptionId: null,
        });
        const summary = getInventoryControlModeAmmoSummary(
            fixture.weapon,
            fixture.harness.equipmentRegistry,
            {},
            null,
        );
        expect(resolveInventoryControlSelectedAmmoOption(
            summary.options,
            selection?.selectedProfileId,
            selection?.preferredSourceOptionId,
        )?.id).toBe(`${fixture.standard.internalName}:LT`);
    });

    it('preserves a catalog-valid profile when its last mounted source is removed', () => {
        const fixture = createAmmoFixture();
        const standardProfileId = getInventoryControlAmmoProfileId(fixture.standard);
        fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
            selectedProfileId: standardProfileId,
            preferredSourceOptionId: `${fixture.standard.internalName}:RA`,
        });

        fixture.harness.unit.setInventory(fixture.harness.components.filter(entry =>
            entry !== fixture.standardRightArm && entry !== fixture.standardLeftTorso));

        const selection = fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id);
        expect(selection).toEqual({
            selectedProfileId: standardProfileId,
            preferredSourceOptionId: null,
        });
        expect(fixture.harness.unit.getInventoryControlSelectedAmmo(fixture.weapon)).toBe(fixture.standard);
        const summary = getInventoryControlModeAmmoSummary(
            fixture.weapon,
            fixture.harness.equipmentRegistry,
            {},
            null,
        );
        expect(resolveInventoryControlSelectedAmmoOption(
            summary.options,
            selection?.selectedProfileId,
            selection?.preferredSourceOptionId,
        )).toBeUndefined();
    });

    it('falls back deterministically when the selected profile becomes incompatible', () => {
        const fixture = createAmmoFixture();
        fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
            selectedProfileId: getInventoryControlAmmoProfileId(fixture.standard),
            preferredSourceOptionId: `${fixture.standard.internalName}:RA`,
        });

        fixture.harness.setInventoryControlRules({
            matchesAmmo: (_entry, ammo) => ammo !== fixture.standard,
        });
        fixture.harness.runtime.markAmmoSourcesChanged();

        expect(fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id)).toEqual({
            selectedProfileId: getInventoryControlAmmoProfileId(fixture.precision),
            preferredSourceOptionId: null,
        });
        expect(fixture.harness.unit.getInventoryControlSelectedAmmo(fixture.weapon)).toBe(fixture.precision);
    });

    it('resolves a selected profile without querying source or parent operational status', () => {
        const fixture = createAmmoFixture();
        const operationalStatus = spyOn(fixture.harness.unit, 'isEquipmentOperational')
            .and.throwError('Pure ammo-profile resolution queried equipment status');

        expect(fixture.harness.unit.getInventoryControlSelectedAmmo(fixture.weapon)).toBe(fixture.standard);
        expect(operationalStatus).not.toHaveBeenCalled();
    });

    for (const scenario of getPreferredSourceUsabilityScenarios()) {
        it(`clears an ${scenario.name} preferred source without losing or later restoring its selection`, () => {
            const fixture = createAmmoFixture();
            const profileId = getInventoryControlAmmoProfileId(fixture.standard);
            const sourceId = `${fixture.standard.internalName}:RA`;

            scenario.makeUnusable(fixture.standardRightArm);
            fixture.harness.unit.setInventoryEntry(fixture.standardRightArm);
            fixture.harness.unit.setInventoryControlEntryAmmoSelection(fixture.weapon.id, {
                selectedProfileId: null,
                preferredSourceOptionId: sourceId,
            });
            fixture.harness.runtime.markAmmoSourcesChanged();

            expectSelectionWithoutPreferredSource(fixture, profileId);
            expect(getSourceOption(fixture, sourceId)?.usable).toBeFalse();

            scenario.restore(fixture.standardRightArm);
            fixture.harness.unit.setInventoryEntry(fixture.standardRightArm);

            expectSelectionWithoutPreferredSource(fixture, profileId);
            expect(getSourceOption(fixture, sourceId)?.usable).toBeTrue();
        });
    }
});

interface AmmoFixture {
    harness: CBTForceUnitTestHarness;
    weapon: MountedWeapon;
    standard: AmmoEquipment;
    precision: AmmoEquipment;
    standardRightArm: MountedAmmo;
    standardLeftTorso: MountedAmmo;
}

function getPreferredSourceUsabilityScenarios(): readonly {
    name: string;
    makeUnusable: (source: MountedAmmo) => void;
    restore: (source: MountedAmmo) => void;
}[] {
    return [
        {
            name: 'empty',
            makeUnusable: source => source.setAmmoState({ consumed: source.totalAmmo }),
            restore: source => source.setAmmoState({ consumed: 0 }),
        },
        {
            name: 'destroyed',
            makeUnusable: source => { source.setCommittedDestroyed(true); },
            restore: source => { source.setCommittedDestroyed(false); },
        },
        {
            name: 'disabled',
            makeUnusable: source => { source.setState(ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE); },
            restore: source => { source.deleteState(ENTRY_DISABLED_STATE_KEY); },
        },
    ];
}

function createAmmoFixture(): AmmoFixture {
    const ac5 = new WeaponEquipment({
        id: 'Runtime AC5',
        name: 'Runtime AC/5',
        type: 'weapon',
        weapon: { ammoType: 'AC', rackSize: 5, damage: 5 },
    });
    const standard = new AmmoEquipment({
        id: 'Runtime AC5 Standard Ammo',
        name: 'Runtime AC/5 Standard Ammo',
        type: 'ammo',
        ammo: { type: 'AC', rackSize: 5, shots: 20, munitionType: ['M_STANDARD'] },
    });
    const precision = new AmmoEquipment({
        id: 'Runtime AC5 Precision Ammo',
        name: 'Runtime AC/5 Precision Ammo',
        type: 'ammo',
        ammo: { type: 'AC', rackSize: 5, shots: 10, munitionType: ['M_PRECISION'] },
    });
    const harness = createCBTForceUnitTestHarness({ tracksHeat: false });
    const weapon = harness.addComponent({
        id: 'runtime-ac5',
        name: ac5.name,
        equipment: ac5,
        locations: new Set(['RT']),
    }) as MountedWeapon;
    const standardRightArm = harness.addComponent({
        id: 'runtime-standard-ra',
        name: standard.name,
        equipment: standard,
        locations: new Set(['RA']),
        totalAmmo: 20,
    }) as MountedAmmo;
    const standardLeftTorso = harness.addComponent({
        id: 'runtime-standard-lt',
        name: standard.name,
        equipment: standard,
        locations: new Set(['LT']),
        totalAmmo: 20,
    }) as MountedAmmo;
    harness.addComponent({
        id: 'runtime-precision-rt',
        name: precision.name,
        equipment: precision,
        locations: new Set(['RT']),
        totalAmmo: 10,
    });

    return {
        harness,
        weapon,
        standard,
        precision,
        standardRightArm,
        standardLeftTorso,
    };
}

function expectSelectionWithoutPreferredSource(fixture: AmmoFixture, profileId: string): void {
    expect(fixture.harness.unit.getInventoryControlEntryAmmoSelection(fixture.weapon.id)).toEqual({
        selectedProfileId: profileId,
        preferredSourceOptionId: null,
    });
    expect(fixture.harness.unit.getInventoryControlSelectedAmmo(fixture.weapon)).toBe(fixture.standard);
}

function getSourceOption(fixture: AmmoFixture, sourceId: string) {
    return getInventoryControlAmmoSelectionOptions(
        fixture.weapon,
        fixture.harness.equipmentRegistry,
    ).find(option => option.id === sourceId);
}
