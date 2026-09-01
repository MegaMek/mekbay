// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Subject } from 'rxjs';

import type { CBTForceMember, CBTMekForceMember } from '../../models/force-member.model';
import type { MekEquipmentInteraction } from '../../models/cbt-force.model';
import type { ComponentId } from '../../models/entity/entity-identifiers';
import { TestBipedMekEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { MiscEquipment, WeaponEquipment, type AmmoEquipment, type Equipment } from '../../models/equipment.model';
import type { EquipmentPanelComponent } from '../../models/runtime/equipment-panel';
import type { EquipmentPanelSnapshot } from '../../models/runtime/equipment-panel';
import type { MekPhysicalAttackRow } from '../../models/runtime/equipment-panel';
import type { OptionsService } from '../../services/options.service';
import type { ToastService } from '../../services/toast.service';
import { EquipmentDialogRuntimeController } from './equipment-dialog-runtime.controller';
import {
    BOOBY_TRAP_ARMED_MODE,
    BOOBY_TRAP_DETONATED_MODE,
} from '../../models/runtime/component-booby-trap';
import { buildNonMekRuntimeIndex, componentIdForMount } from '../../models/runtime/non-mek-runtime-index';
import { createPristineNonMekUnitState } from '../../models/runtime/non-mek-unit-instance';

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
        const member = {
            kind: 'cbt', id: 'mek-1', force, entity: new TestBipedMekEntity(),
        } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            {
                options: () => ({}),
                cbtAutomationMode: () => 'no',
            } as unknown as OptionsService,
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

    it('lists only handler-backed passive equipment', () => {
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
        const interactions = [{
            instanceId: 'mek-1',
            unitLabel: 'Inventory filtering',
            componentId: 'mount:ecm' as ComponentId,
            componentLabel: 'mount:ecm',
            stateRevision: 0,
            choices: [],
        }] as unknown as readonly MekEquipmentInteraction[];
        const getInteractions = jasmine.createSpy('getMekEquipmentInteractions')
            .and.returnValue(interactions);
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: getInteractions,
        };
        const member = {
            kind: 'cbt', id: 'mek-1', force, entity: new TestBipedMekEntity(),
        } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        expect(controller.equipment().map(candidate => candidate.componentId))
            .toEqual(['mount:ecm' as ComponentId]);
        expect(getInteractions).toHaveBeenCalledWith('inventory');
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
            getUnitSnapshot: () => null,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            dispatchNonMekUnitCommand: dispatch,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            entity: new TestTankEntity(),
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
        }));

        await controller.configureAmmo(component, 'Ammo_AC_10', 7);
        expect(dispatch).toHaveBeenCalledWith('tank-1', jasmine.objectContaining({
            kind: 'configure-ammo-source',
            componentId: component.componentId,
            munitionKey: 'Ammo_AC_10',
            remaining: 7,
        }));

        await controller.changeMode(component, 'Rapid');
        expect(dispatch).toHaveBeenCalledWith('tank-1', jasmine.objectContaining({
            kind: 'set-component-mode',
            componentId: component.componentId,
            mode: 'Rapid',
        }));
        expect(force.getMekEquipmentInteractions).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('projects and dispatches non-Mek escalating-equipment controls through Entity runtime', async () => {
        const changed = new Subject<void>();
        const entity = new TestTankEntity();
        const mount = addTestEquipmentWithFlags(
            entity,
            ['F_MASC', 'S_SUPERCHARGER'],
            { location: entity.locationOrder[0] },
        );
        const componentId = componentIdForMount(mount);
        const state = createPristineNonMekUnitState(entity);
        const unitSnapshot = {
            instanceId: 'tank-1',
            entity,
            index: buildNonMekRuntimeIndex(entity),
            state,
            ruleset: 'core-2026',
            sourceRef: {},
        };
        const panel = {
            ...snapshot('Test Supercharger Tank'),
            components: [{
                componentId,
                label: 'Test F_MASC:S_SUPERCHARGER',
                equipment: mount.equipment,
                locations: [],
                status: 'available',
                previewStatus: 'available',
                modes: [],
                mode: undefined,
                jammed: false,
            }],
        } as EquipmentPanelSnapshot;
        const dispatch = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            state,
        });
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getUnitSnapshot: () => unitSnapshot,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            dispatchNonMekUnitCommand: dispatch,
        };
        const controller = new EquipmentDialogRuntimeController(
            { kind: 'cbt', id: 'tank-1', force, entity } as unknown as CBTForceMember,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        const interaction = controller.interactions()[0]!;
        expect(interaction.componentLabel).toBe('Test F_MASC:S_SUPERCHARGER');
        expect(interaction.choices.map(choice => choice.shortLabel)).toEqual([
            '3+', '5+', '7+', '10+', '11+', 'Operational',
        ]);
        await controller.chooseInteraction(interaction, interaction.choices[0]!.token);

        expect(dispatch).toHaveBeenCalledOnceWith('tank-1', {
            kind: 'edit-escalating-failure',
            componentId,
            edit: { kind: 'select-sequence', index: 0 },
        });
        expect(force.getMekEquipmentInteractions).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('confirms non-Mek Booby Trap detonation before dispatching its atomic command', async () => {
        const changed = new Subject<void>();
        const equipment = new MiscEquipment({
            id: 'test-booby-trap',
            name: 'Booby Trap',
            type: 'misc',
            flags: ['F_BOOBY_TRAP'],
        });
        const component = {
            componentId: 'mount:booby-trap' as ComponentId,
            label: 'Booby Trap',
            equipment,
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: [BOOBY_TRAP_ARMED_MODE, BOOBY_TRAP_DETONATED_MODE],
            defaultMode: BOOBY_TRAP_ARMED_MODE,
            mode: BOOBY_TRAP_ARMED_MODE,
            jammed: false,
        } satisfies EquipmentPanelComponent;
        const panel = {
            ...snapshot('Vedette Booby Trap'),
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
            getUnitSnapshot: () => null,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            dispatchNonMekUnitCommand: dispatch,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            entity: new TestTankEntity(),
        } as unknown as CBTForceMember;
        const dialogs = {
            requestConfirmation: jasmine.createSpy('requestConfirmation').and.resolveTo(false),
            showNoticeHtml: jasmine.createSpy('showNoticeHtml').and.resolveTo(),
        };
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
            dialogs,
        );

        await controller.changeMode(component, BOOBY_TRAP_DETONATED_MODE);
        expect(dispatch).not.toHaveBeenCalled();
        expect(dialogs.showNoticeHtml).not.toHaveBeenCalled();

        dialogs.requestConfirmation.and.resolveTo(true);
        await controller.changeMode(component, BOOBY_TRAP_DETONATED_MODE);
        expect(dispatch).toHaveBeenCalledOnceWith('tank-1', jasmine.objectContaining({
            kind: 'detonate-booby-trap',
            componentId: component.componentId,
        }));
        expect(dialogs.showNoticeHtml).toHaveBeenCalledOnceWith(
            jasmine.stringContaining('Resolve the Booby Trap blast'),
            'Booby Trap Detonated',
        );
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
            getUnitSnapshot: () => null,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            getAttackerTargeting: () => ({ stateRevision: 0, registryRevision: 0, state: {} }),
            dispatchAttackerTargeting: dispatchTargeting,
            fireSelectedWeapons: fire,
        };
        const member = {
            kind: 'cbt',
            id: 'tank-1',
            force,
            entity: new TestTankEntity(),
        } as unknown as CBTForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            {
                options: () => ({}),
                cbtAutomationMode: () => 'no',
            } as unknown as OptionsService,
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
        }));
        controller.dispose();
    });

    it('dispatches a weapon bay target and status as atomic member batches', async () => {
        const changed = new Subject<void>();
        const firstId = 'mount:bay-weapon-1' as ComponentId;
        const secondId = 'mount:bay-weapon-2' as ComponentId;
        const attack = {
            kind: 'weapon-bay' as const,
            source: 'authored-bay' as const,
            members: [firstId, secondId].map(componentId => ({
                componentId,
                selectable: true,
                ammoSources: [],
            })),
        };
        const row = {
            componentId: firstId,
            label: 'AC/10 Bay',
            locations: [],
            status: 'available',
            previewStatus: 'available',
            modes: [],
            jammed: false,
            attack,
            weapon: {
                selectable: true,
                selection: undefined,
                ammoSelection: undefined,
                ammoSources: [],
            },
        } as unknown as EquipmentPanelComponent;
        const panel = {
            ...snapshot('Bay fixture'),
            components: [row],
        } as EquipmentPanelSnapshot;
        const dispatchTargeting = jasmine.createSpy('dispatchAttackerTargeting').and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: 1,
        });
        const dispatchUnit = jasmine.createSpy('dispatchNonMekUnitCommand').and.resolveTo({
            accepted: true,
            changed: true,
            state: {},
        });
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getUnitSnapshot: () => null,
            getMekEquipmentInteractions: jasmine.createSpy('getMekEquipmentInteractions'),
            getAttackerTargeting: () => ({ stateRevision: 0, registryRevision: 0, state: {} }),
            dispatchAttackerTargeting: dispatchTargeting,
            dispatchNonMekUnitCommand: dispatchUnit,
        };
        const controller = new EquipmentDialogRuntimeController(
            {
                kind: 'cbt', id: 'dropship-1', force, entity: new TestTankEntity(),
            } as unknown as CBTForceMember,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        await controller.selectTarget(row, 'range:long');
        await controller.changeStatus(row);

        expect(dispatchTargeting).toHaveBeenCalledOnceWith('dropship-1', jasmine.objectContaining({
            edit: {
                kind: 'set-component-selections',
                componentIds: [firstId, secondId],
                selection: { kind: 'manual-range', range: 'long' },
            },
        }));
        expect(dispatchUnit).toHaveBeenCalledOnceWith('dropship-1', jasmine.objectContaining({
            kind: 'set-component-statuses',
            componentIds: [firstId, secondId],
            status: 'destroyed',
            target: 'committed',
        }));
        controller.dispose();
    });

    it('submits and reports the exact prototype-laser heat roll', async () => {
        const changed = new Subject<void>();
        const weaponId = 'mount:prototype-medium-pulse' as ComponentId;
        const equipment = new WeaponEquipment({
            id: 'ISMediumPulseLaserPrototype',
            name: 'Prototype Medium Pulse Laser',
            type: 'weapon',
            weapon: { damage: 6, heat: 4, ranges: [2, 4, 6, 8] },
        });
        const panel = {
            ...snapshot('Prototype laser fixture'),
            unitType: 'Mek',
            tracksHeat: true,
            components: [{
                componentId: weaponId,
                label: equipment.name,
                equipment,
                weapon: { selection: { kind: 'selected' } },
            } as unknown as EquipmentPanelComponent],
        } as EquipmentPanelSnapshot;
        const fire = jasmine.createSpy('fireSelectedWeapons').and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: 1,
            prototypeHeat: [{
                weaponId,
                roll: 6,
                additionalHeat: 6,
                detail: '1D6 roll: 6',
            }],
        });
        const toast = jasmine.createSpyObj<ToastService>('ToastService', ['showToast']);
        const force = {
            changed,
            getEquipmentPanelSnapshot: () => panel,
            getMekEquipmentInteractions: () => [],
            fireSelectedWeapons: fire,
        };
        const member = {
            kind: 'cbt', id: 'mek-1', force, entity: new TestBipedMekEntity(),
        } as unknown as CBTMekForceMember;
        spyOn(Math, 'random').and.returnValue(5 / 6);
        const controller = new EquipmentDialogRuntimeController(
            member,
            { cbtAutomationMode: () => 'no' } as unknown as OptionsService,
            toast,
        );

        await controller.fire();

        expect(fire).toHaveBeenCalledOnceWith('mek-1', jasmine.objectContaining({
            heatPolicy: 'manual',
            prototypeHeatRolls: [{ weaponId, roll: 6 }],
        }));
        expect(toast.showToast).toHaveBeenCalledOnceWith(
            'Prototype Medium Pulse Laser: +6 heat (1D6 roll: 6)',
            'info',
        );
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
        const member = {
            kind: 'cbt', id: 'mek-1', force, entity: new TestBipedMekEntity(),
        } as unknown as CBTMekForceMember;
        const controller = new EquipmentDialogRuntimeController(
            member,
            { options: () => ({}) } as unknown as OptionsService,
            { showToast: jasmine.createSpy('showToast') } as unknown as ToastService,
        );

        await controller.reorderEquipmentRows('ranged', [2, 0, 1]);

        expect(dispatchEquipmentRowOrder).toHaveBeenCalledOnceWith('mek-1', {
            group: 'ranged',
            permutation: [2, 0, 1],
        });
        expect(dispatchMekUnitCommand).not.toHaveBeenCalled();
        controller.dispose();
    });
});
