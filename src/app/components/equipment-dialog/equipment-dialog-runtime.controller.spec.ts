// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Subject } from 'rxjs';

import type { CBTForceMember, CBTMekForceMember } from '../../models/force-member.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import type { AmmoEquipment, Equipment } from '../../models/equipment.model';
import type { EquipmentPanelComponent } from '../../models/runtime/equipment-panel';
import type { EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import type { MekPhysicalAttackRow } from '../../models/runtime/equipment-panel';
import type { OptionsService } from '../../services/options.service';
import type { ToastService } from '../../services/toast.service';
import { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';

function snapshot(displayName: string): EquipmentPanelSnapshot {
    return {
        published: {},
        stateRevision: 0,
        targetRegistryRevision: 0,
        displayName,
        heat: { current: 0, pending: null, sinksOff: 0 },
        crew: { gunnery: 4, piloting: 5 },
        components: [],
        physicalAttacks: [],
        physicalAttackBlockers: [],
        targets: [],
    } as unknown as EquipmentPanelSnapshot;
}

describe('EquipmentDialogRuntimeController', () => {
    it('captures the admitted member before reading its initial snapshot and follows force changes', () => {
        const changed = new Subject<void>();
        const first = snapshot('Crab CRB-20');
        const second = snapshot('Crab CRB-20 updated');
        const getSnapshot = jasmine.createSpy('getEquipmentPanelSnapshot').and.returnValues(first, second);
        const force = {
            changed,
            getEquipmentPanelSnapshot: getSnapshot,
            getMekEquipmentInteractions: () => [],
        };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        expect(controller.member).toBe(member);
        expect(controller.snapshot()).toBe(first);
        expect(controller.weapons()).toEqual([]);

        changed.next();

        expect(controller.snapshot()).toBe(second);
        expect(getSnapshot).toHaveBeenCalledTimes(2);

        controller.dispose();
        changed.next();
        expect(getSnapshot).toHaveBeenCalledTimes(2);
    });

    it('lists mounted inventory equipment but not entity systems or heat-sink bookkeeping mounts', () => {
        const changed = new Subject<void>();
        const row = (
            componentId: string,
            heatSink?: boolean,
        ): EquipmentPanelComponent => ({
            componentId: componentId as ComponentId,
            label: componentId,
            ...(heatSink === undefined ? {} : {
                equipment: {
                    hasAnyFlag: () => heatSink,
                } as unknown as Equipment,
            }),
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: ['Standard', 'Rapid'],
            defaultMode: 'Standard',
            mode: 'Standard',
            jammed: false,
        });
        const panel = {
            ...snapshot('Inventory filtering'),
            components: [
                row('system:engine'),
                row('mount:heat-sink', true),
                row('mount:ecm', false),
            ],
        } as EquipmentPanelSnapshot;
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: () => [],
        };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        expect(controller.equipment().map(candidate => candidate.componentId))
            .toEqual(['mount:ecm' as ComponentId]);
        const charge = {
            effect: {
                kind: 'damage', damage: 16, maximumDamage: 56, baseDamage: 14,
                weakened: false, boosted: false, displayFormula: '13.5×(TMM+1)+2',
            },
        } as MekPhysicalAttackRow;

        expect(controller.physicalDamage(charge)).toBe('13.5×(TMM+1)+2');
        if (charge.effect.kind !== 'damage') throw new Error('Charge damage fixture is missing');
        expect(controller.physicalDamage({
            ...charge,
            effect: {
                ...charge.effect,
                displayFormula: undefined,
                damage: 14,
                maximumDamage: 14,
                alternateDamage: 7,
            },
        })).toBe('14 [7]');
    });

    it('dispatches pending status and ammunition edits through the non-Mek Entity owner', async () => {
        const changed = new Subject<void>();
        const component = {
            componentId: 'mount:ammo-1' as ComponentId,
            label: 'AC/10 Ammo',
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: ['Standard', 'Rapid'],
            defaultMode: 'Standard',
            mode: 'Standard',
            jammed: false,
            ammo: {
                defaultMunitionKey: 'Ammo_AC_10',
                munitionKey: 'Ammo_AC_10',
                displayName: 'AC/10 Ammo',
                remaining: 10,
                capacity: 10,
                loadouts: [{
                    munitionKey: 'Ammo_AC_10',
                    displayName: 'AC/10 Ammo',
                    capacity: 10,
                    equipment: {} as AmmoEquipment,
                }],
            },
        } satisfies EquipmentPanelComponent;
        const panel = {
            ...snapshot('Vedette Medium Tank'),
            components: [component],
        } as EquipmentPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            state: {},
        });
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            dispatchNonMekUnitCommand: dispatch,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            summary: { entityType: 'Tank' },
        } as unknown as CBTForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            {
                options: () => ({
                    trackPhaseAndTurn: true,
                    CBTOptionalRules: { extremeRange: false },
                }),
            } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        await controller.changeStatus(component);
        expect(dispatch).toHaveBeenCalledWith('tank-1', jasmine.objectContaining({
            kind: 'set-component-status',
            componentId: component.componentId,
            status: 'destroyed',
            target: 'pending',
            expectedRevision: panel.stateRevision,
        }));

        await controller.configureAmmo(component, 'Ammo_AC_10', 7);
        expect(dispatch).toHaveBeenCalledWith('tank-1', jasmine.objectContaining({
            kind: 'configure-ammo-source',
            componentId: component.componentId,
            munitionKey: 'Ammo_AC_10',
            remaining: 7,
            expectedRevision: panel.stateRevision,
        }));

        await controller.changeMode(component, 'Rapid');
        expect(dispatch).toHaveBeenCalledWith('tank-1', jasmine.objectContaining({
            kind: 'set-component-mode',
            componentId: component.componentId,
            mode: 'Rapid',
            expectedRevision: panel.stateRevision,
        }));
        expect(force.getMekEquipmentInteractions).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('uses the shared targeting lane for non-Mek weapon selection, ammo preference, and reset', async () => {
        const changed = new Subject<void>();
        const weaponId = 'mount:ac-10' as ComponentId;
        const ammoId = 'mount:ac-10-ammo' as ComponentId;
        const weapon = {
            componentId: weaponId,
            label: 'AC/10',
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: [],
            jammed: false,
            weapon: {
                heat: 3,
                firingHeat: 3,
                selectable: true,
                damage: 10,
                damageText: '10',
                damageTextByRange: { short: '10', medium: '10', long: '10', extreme: '10' },
                hit: {
                    default: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    byRange: {
                        short: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        medium: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        long: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        extreme: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    },
                    indirectByRange: {
                        short: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        medium: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        long: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                        extreme: { profile: [0], value: 0, changed: false, weakened: false, modifierBreakdown: [] },
                    },
                },
                toHitModifier: 0,
                hitModifierBreakdown: [],
                ranges: [5, 10, 15, 20],
                minimumRange: 0,
                selection: { kind: 'target', targetId: 'target:a' as never },
                ammoSelection: { munitionKey: 'Ammo_AC_10', preferredSourceId: ammoId },
                ammoSources: [],
                underwater: false,
                attackerSubmerged: false,
                disabledTargetReasons: {},
            },
        } satisfies EquipmentPanelComponent;
        const panel = {
            ...snapshot('Vedette Medium Tank'),
            components: [weapon],
        } as EquipmentPanelSnapshot;
        const dispatchTargeting = jasmine.createSpy('dispatchAttackerTargeting').and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: 1,
        });
        const fire = jasmine.createSpy('fireSelectedWeapons').and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: 1,
        });
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            getAttackerTargeting: () => ({ stateRevision: 0, registryRevision: 0, state: {} }),
            dispatchAttackerTargeting: dispatchTargeting,
            fireSelectedWeapons: fire,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            summary: { entityType: 'Tank' },
        } as unknown as CBTForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        expect(controller.supportsTargetingTools()).toBeTrue();
        expect(controller.supportsMekTurnTools()).toBeFalse();
        expect(controller.canFireSelectedWeapons()).toBeTrue();
        await controller.selectTarget(weapon, 'target:b');
        await controller.selectWeaponAmmo(weapon, `${ammoId}\u0000Ammo_AC_10`);
        await controller.resetSelections();
        await controller.fire();

        expect(dispatchTargeting.calls.allArgs().map(args => args[1].edit)).toEqual([
            {
                kind: 'set-component-selection',
                componentId: weaponId,
                selection: { kind: 'target', targetId: 'target:b' },
            },
            {
                kind: 'set-component-ammo',
                componentId: weaponId,
                ammo: { preferredSourceId: ammoId, munitionKey: 'Ammo_AC_10' },
            },
            {
                kind: 'set-component-selection',
                componentId: weaponId,
                selection: null,
            },
        ]);
        expect(fire).toHaveBeenCalledOnceWith('tank-1', jasmine.objectContaining({
            type: 'fire-selected-weapons',
            expectedRevision: panel.stateRevision,
            expectedRegistryRevision: panel.targetRegistryRevision,
        }));
        controller.dispose();
    });

    it('dispatches presentation row order outside gameplay commands', async () => {
        const changed = new Subject<void>();
        const panel = snapshot('Crab CRB-20');
        const dispatchEquipmentRowOrder = jasmine.createSpy('dispatchEquipmentRowOrder').and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: 1,
        });
        const dispatchMekUnitCommand = jasmine.createSpy('dispatchMekUnitCommand');
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: () => [],
            dispatchEquipmentRowOrder,
            dispatchMekUnitCommand,
        };
        const member = { id: 'mek-1', force } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        await controller.reorderEquipmentRows('ranged', [2, 0, 1]);

        expect(dispatchEquipmentRowOrder).toHaveBeenCalledOnceWith('mek-1', {
            expectedRevision: panel.stateRevision,
            group: 'ranged',
            permutation: [2, 0, 1],
        });
        expect(dispatchMekUnitCommand).not.toHaveBeenCalled();
        controller.dispose();
    });
});
