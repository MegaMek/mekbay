// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    InventoryControlRuntimeState,
    type InventoryControlRuntimeEntryRef,
} from './inventory-control-runtime-state.model';

describe('InventoryControlRuntimeState stable entry identity', () => {
    it('owns selection, range, and target state using plain ID references', () => {
        const alpha = Object.freeze({ id: 'component:alpha' });
        const beta = Object.freeze({ id: 'component:beta' });
        let inventory: readonly InventoryControlRuntimeEntryRef[] = [alpha, beta];
        const forceTargetIds = new Set(['force-target:A']);
        const state = new InventoryControlRuntimeState(
            () => inventory,
            targetId => forceTargetIds.has(targetId),
        );

        state.setEntryRange(alpha, 'medium');
        expect(state.getEntryState(alpha.id)).toEqual({ selected: true, range: 'medium' });

        state.setEntryTarget(beta, 'force-target:A');
        expect(state.getEntryState(beta.id)).toEqual({ selected: true, targetId: 'force-target:A' });

        inventory = [beta];
        state.reconcile();
        expect(state.getEntryState(alpha.id)).toBeUndefined();
        expect(state.getEntryState(beta.id)).toEqual({ selected: true, targetId: 'force-target:A' });
    });

    it('passes only the stable entry reference to ammo reconciliation', () => {
        const entry = Object.freeze({ id: 'component:ammo-source' });
        const reconcile = jasmine.createSpy('reconcile').and.callFake((entryRef: InventoryControlRuntimeEntryRef) => ({
            selectedProfileId: `profile:${entryRef.id}`,
            preferredSourceOptionId: null,
        }));
        const state = new InventoryControlRuntimeState(() => [entry], undefined, reconcile);

        state.setEntryAmmoSelection(entry.id, {
            selectedProfileId: 'stale',
            preferredSourceOptionId: null,
        });
        state.reconcileAmmoSelections();

        expect(reconcile).toHaveBeenCalledOnceWith(entry, {
            selectedProfileId: 'stale',
            preferredSourceOptionId: null,
        });
        expect(state.getEntryAmmoSelection(entry.id)).toEqual({
            selectedProfileId: `profile:${entry.id}`,
            preferredSourceOptionId: null,
        });
    });

});
