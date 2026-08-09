// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedEquipment } from '../models/mounted-equipment.model';
import { WeaponEquipment, type AmmoType, type Equipment } from '../models/equipment.model';
import { EMPTY_EQUIPMENT_REGISTRY } from '../models/equipment-lookup';
import type { EquipmentStatus } from '../models/equipment-status.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import { createHandlerCommandContext, createHandlerQueryContext } from '../services/equipment-interaction-registry.service';
import type { DialogsService } from '../services/dialogs.service';
import type { ToastService } from '../services/toast.service';
import { APOLLO_MODE_STATE, APOLLO_SATURATION_MODE, APOLLO_STANDARD_MODE, ApolloHandler } from './apollo.handler';
import { INVENTORY_CONTROL_MODE_STATE } from '../utils/inventory-control.util';
import { EquipmentFlag } from '../models/equipment-flags.type';

const queryContext = createHandlerQueryContext(EMPTY_EQUIPMENT_REGISTRY);
const commandContext = createHandlerCommandContext(
    EMPTY_EQUIPMENT_REGISTRY,
    jasmine.createSpyObj<ToastService>('ToastService', ['showToast']),
    jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']),
);

function owner(gameRules: CBTGameRules = CORE_2026_GAME_RULES) {
    const getEquipmentStatus = (candidate: MountedEquipment): EquipmentStatus => candidate.committedDestroyed()
        ? 'destroyed'
        : 'available';
    return {
        gameRules,
        getEquipmentStatus,
        isEquipmentOperational: (candidate: MountedEquipment) => getEquipmentStatus(candidate) === 'available',
        setInventoryEntry: jasmine.createSpy('setInventoryEntry')
    } as never;
}

function entry(
    flags: EquipmentFlag[] = [],
    options: { destroyed?: boolean; status?: EquipmentStatus; gameRules?: CBTGameRules } = {}
): MountedEquipment {
    const getEquipmentStatus = (candidate: MountedEquipment): EquipmentStatus => candidate.committedDestroyed()
        ? 'destroyed'
        : options.status ?? 'available';
    return new MountedEquipment({
        owner: {
            gameRules: options.gameRules ?? CORE_2026_GAME_RULES,
            getEquipmentStatus,
            isEquipmentOperational: (candidate: MountedEquipment) => getEquipmentStatus(candidate) === 'available',
            setInventoryEntry: jasmine.createSpy('setInventoryEntry')
        } as never,
        id: flags.join('-') || 'entry',
        name: 'Entry',
        equipment: { flags: new Set(flags) } as Equipment,
        destroyed: options.destroyed
    });
}

function weapon(
    ammoType: Extract<AmmoType, 'LRM' | 'MML' | 'MRM'>,
    gameRules: CBTGameRules = CORE_2026_GAME_RULES,
    flags: EquipmentFlag[] = ammoType === 'MRM' ? ['F_MRM'] : []
): MountedEquipment {
    return new MountedEquipment({
        owner: owner(gameRules),
        id: ammoType.toLowerCase(),
        name: ammoType,
        equipment: new WeaponEquipment({ id: ammoType, name: ammoType, type: 'weapon', flags, weapon: { ammoType } })
    });
}

describe('ApolloHandler', () => {
    const handler = new ApolloHandler();

    it('applies the TW Apollo bonus to an intact linked MRM', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { gameRules: TW_GAME_RULES });

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry', modifier: -1, weakened: false
        }]);
    });

    it('presents a destroyed TW Apollo separately from its neutral modifier', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { destroyed: true, gameRules: TW_GAME_RULES });

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry Destroyed', modifier: 0, weakened: true
        }]);
    });

    it('presents a disabled TW Apollo separately from a destroyed one', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { status: 'disabled', gameRules: TW_GAME_RULES });

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry Disabled', modifier: 0, weakened: true
        }]);
    });

    it('keeps the Core 2026 Apollo modifier neutral for MRMs', () => {
        expect(handler.getToHitAdjustments(
            entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']),
            { parent: weapon('MRM') },
            queryContext
        )).toEqual([]);
    });

    it('does not apply the TW Apollo bonus to incompatible launchers', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { gameRules: TW_GAME_RULES });

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('LRM', TW_GAME_RULES) }, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MML', TW_GAME_RULES) }, queryContext)).toEqual([]);
    });

    it('identifies MRMs by F_MRM rather than their ammo type', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { gameRules: TW_GAME_RULES });

        expect(handler.getToHitAdjustments(apollo, { parent: weapon('MRM', TW_GAME_RULES, []) }, queryContext)).toEqual([]);
        expect(handler.getToHitAdjustments(apollo, { parent: weapon('LRM', TW_GAME_RULES, ['F_MRM']) }, queryContext)).toEqual([{
            kind: 'add', label: 'Entry', modifier: -1, weakened: false
        }]);
    });

    it('adds AE to Core 2026 MRM damage in saturation mode', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo]
        });
        launcher.setState('inventory_control_mode', APOLLO_SATURATION_MODE);

        const types = handler.applyLinkedWeaponTypes?.(
            apollo,
            launcher,
            new Set(['C', 'M']),
            queryContext
        );

        expect(Array.from(types ?? [])).toEqual(['C', 'M', 'AE']);
    });

    it('uses the canonical query context for pure Apollo projections without mutating inputs', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        apollo.owner.getEquipmentStatus = () => { throw new Error('owner status must not be queried'); };
        apollo.owner.isEquipmentOperational = () => { throw new Error('owner operational state must not be queried'); };
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm-context',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo],
            states: new Map([[APOLLO_MODE_STATE, APOLLO_SATURATION_MODE]])
        });
        const context = { ...queryContext, getStatus: () => 'available' as EquipmentStatus };
        const baseTypes = new Set(['C', 'M'] as const);
        const initialStates = new Map(launcher.states);

        const types = handler.applyLinkedWeaponTypes(apollo, launcher, baseTypes, context);

        expect(Array.from(types)).toEqual(['C', 'M', 'AE']);
        expect(Array.from(baseTypes)).toEqual(['C', 'M']);
        expect(launcher.states).toEqual(initialStates);
    });

    it('uses standard mode when the linked Apollo is disabled', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO'], { status: 'disabled' });
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo],
            states: new Map([[APOLLO_MODE_STATE, APOLLO_SATURATION_MODE]])
        });

        const types = handler.applyLinkedWeaponTypes?.(
            apollo,
            launcher,
            new Set(['C', 'M']),
            queryContext
        );

        expect(handler.getChoices(launcher, queryContext)?.[0].value).toBe(APOLLO_STANDARD_MODE);
        expect(Array.from(types ?? [])).toEqual(['C', 'M']);
    });

    it('keeps Apollo saturation independent from the launcher SVG mode', () => {
        const apollo = entry(['F_WEAPON_ENHANCEMENT', 'F_APOLLO']);
        const launcher = new MountedEquipment({
            owner: owner(),
            id: 'mrm',
            name: 'MRM 10',
            equipment: new WeaponEquipment({ id: 'MRM10', name: 'MRM 10', type: 'weapon', flags: ['F_MRM'], weapon: { ammoType: 'MRM' } }),
            linkedWith: [apollo],
            states: new Map([[INVENTORY_CONTROL_MODE_STATE, 'Extended Range']])
        });

        handler.handleSelection(launcher, { value: APOLLO_SATURATION_MODE } as never, commandContext);

        expect(launcher.states.get(APOLLO_MODE_STATE)).toBe(APOLLO_SATURATION_MODE);
        expect(launcher.states.get(INVENTORY_CONTROL_MODE_STATE)).toBe('Extended Range');
        expect(handler.getChoices(launcher, queryContext)?.[0].value).toBe(APOLLO_SATURATION_MODE);
    });
});
