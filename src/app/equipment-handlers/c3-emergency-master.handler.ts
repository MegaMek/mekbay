/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { PickerChoice } from '../components/picker/picker.interface';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import {
    C3EM_MAX_OPERATING_TURNS,
    C3EM_FRIED_SEQUENCE_VALUE,
    C3EM_MODE_STATE_KEY,
    C3EM_OPERATING_TURNS_STATE_KEY,
    C3EmergencyMasterActivationTracker,
    getC3EmergencyMasterOperatingTurns,
    isC3EmergencyMaster,
    isC3EmergencyMasterFried,
    type C3EmergencyMasterStatus,
} from '../models/c3-emergency-master.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { Force } from '../models/force.model';
import { EquipmentInteractionHandler, type HandlerContext } from '../services/equipment-interaction-registry.service';

export const C3_EMERGENCY_MASTER_HANDLER_ID = 'c3-emergency-master-handler';
export const C3EM_TOGGLE_CHOICE_VALUE = 'c3em-emergency';
const TRACK_LABELS = ['1', '2', '3', '4', '5', '6', '!!'] as const;
const TRACK_COLORS = {
    selected: 'var(--bt-yellow)',
    selectedText: '#000',
    mutedSelected: 'var(--bt-yellow-background)',
    mutedSelectedText: '#888',
    disabledText: '#888',
};
const FRIED_COLORS = { ...TRACK_COLORS, selected: '#f00', selectedText: '#fff', mutedSelected: '#800' };
const EMERGENCY_COLORS = {
    selected: '#d96b00',
    selectedText: 'var(--bt-yellow)',
    mutedSelected: '#d96b00',
    mutedSelectedText: 'var(--bt-yellow)',
};

export class C3EmergencyMasterHandler extends EquipmentInteractionHandler {
    readonly id = C3_EMERGENCY_MASTER_HANDLER_ID;
    override readonly flags: EquipmentFlag[] = ['F_C3EM'];
    override readonly priority = 11;
    private readonly activationTrackers = new WeakMap<Force, C3EmergencyMasterActivationTracker>();

    static operatingTurns(equipment: MountedEquipment): number {
        return getC3EmergencyMasterOperatingTurns(equipment);
    }

    static status(equipment: MountedEquipment): C3EmergencyMasterStatus {
        return equipment.owner.force.c3Network().emergencyMasterStatus(equipment);
    }

    getChoices(equipment: MountedEquipment, _context: HandlerContext): PickerChoice[] {
        const turns = C3EmergencyMasterHandler.operatingTurns(equipment);
        const status = C3EmergencyMasterHandler.status(equipment);
        const unavailable = equipment.owner.readOnly() || equipment.isUnavailable();
        const track = TRACK_LABELS.map((label, index): PickerChoice => {
            const sequenceValue = index + 1;
            const friedChoice = sequenceValue === C3EM_FRIED_SEQUENCE_VALUE;
            const current = sequenceValue === turns;
            return {
                label,
                shortLabel: label,
                value: sequenceValue,
                displayType: 'toggle',
                disabled: unavailable,
                active: friedChoice ? current : !isC3EmergencyMasterFried(equipment) && sequenceValue <= turns,
                selectionTone: current && (friedChoice || status === 'active') ? 'selected' : 'muted',
                colors: friedChoice ? FRIED_COLORS : TRACK_COLORS,
                keepOpen: true,
            };
        });
        return [...track, {
            label: 'EMERGENCY',
            shortLabel: 'EMERGENCY',
            value: C3EM_TOGGLE_CHOICE_VALUE,
            displayType: 'toggle',
            disabled: unavailable || isC3EmergencyMasterFried(equipment),
            active: status === 'active' || status === 'standby',
            selectionTone: 'selected',
            colors: EMERGENCY_COLORS,
            keepOpen: true,
        }];
    }

    handleSelection(equipment: MountedEquipment, choice: PickerChoice, context: HandlerContext): boolean {
        if (equipment.owner.readOnly() || equipment.isUnavailable()) return true;
        if (choice.value === C3EM_TOGGLE_CHOICE_VALUE && isC3EmergencyMasterFried(equipment)) return true;
        const status = C3EmergencyMasterHandler.status(equipment);
        let changed: boolean;
        if (choice.value === C3EM_TOGGLE_CHOICE_VALUE) {
            const turningOn = status !== 'active' && status !== 'standby';
            changed = equipment.setState(C3EM_MODE_STATE_KEY, turningOn ? 'on' : 'off');
            if (turningOn && C3EmergencyMasterHandler.operatingTurns(equipment) === 0) {
                changed = this.setOperatingTurns(equipment, 1) || changed;
            }
        } else {
            const sequenceValue = Number(choice.value);
            if (!Number.isInteger(sequenceValue)
                || sequenceValue < 1
                || sequenceValue > C3EM_FRIED_SEQUENCE_VALUE) return true;
            changed = this.setOperatingTurns(equipment, sequenceValue);
            if (sequenceValue === C3EM_FRIED_SEQUENCE_VALUE) {
                changed = equipment.setState(C3EM_MODE_STATE_KEY, 'off') || changed;
            }
        }
        if (!changed) return true;
        equipment.owner.setInventoryEntry(equipment);
        if (choice.value === C3EM_TOGGLE_CHOICE_VALUE) return true;
        context.toastService.showToast(
            `${equipment.equipment?.name || equipment.name}: ${this.statusLabel(equipment)}`,
            C3EmergencyMasterHandler.status(equipment) === 'fried' ? 'error' : 'info'
        );
        return true;
    }

    override onEndTurn(equipment: MountedEquipment, context: HandlerContext): void {
        if (C3EmergencyMasterHandler.status(equipment) !== 'active') return;
        const nextTurns = C3EmergencyMasterHandler.operatingTurns(equipment) + 1;
        if (!this.setOperatingTurns(equipment, nextTurns)) return;
        if (nextTurns === C3EM_FRIED_SEQUENCE_VALUE) {
            equipment.setState(C3EM_MODE_STATE_KEY, 'off');
        }
        equipment.owner.setInventoryEntry(equipment);
        context.toastService.showToast(
            `${equipment.owner.getNotificationDisplayName()}: ${equipment.equipment?.name || equipment.name} ${this.statusLabel(equipment)}`,
            nextTurns === C3EM_FRIED_SEQUENCE_VALUE ? 'error' : 'info'
        );
    }

    override onForceRuntimeChanged(force: Force, context: HandlerContext): void {
        const network = force.c3Network();
        const equipmentByKey = new Map<string, MountedEquipment>();
        const statuses = force.units().flatMap(unit => {
            const inventory = (unit as typeof unit & { getInventory?: () => readonly MountedEquipment[] }).getInventory?.() ?? [];
            return inventory.flatMap(equipment => {
                if (!isC3EmergencyMaster(equipment)) return [];
                const key = `${unit.id}\0${equipment.id}`;
                equipmentByKey.set(key, equipment);
                return [{ key, status: network.emergencyMasterStatus(equipment) }];
            });
        });

        let tracker = this.activationTrackers.get(force);
        if (!tracker) {
            tracker = new C3EmergencyMasterActivationTracker();
            this.activationTrackers.set(force, tracker);
        }
        const activatedKeys = new Set(tracker.update(statuses));
        for (const { key, status } of statuses) {
            const equipment = equipmentByKey.get(key);
            if (!equipment) continue;
            if (status === 'active' && C3EmergencyMasterHandler.operatingTurns(equipment) === 0) {
                this.setOperatingTurns(equipment, 1);
                equipment.owner.setInventoryEntry(equipment);
            }
            if (!activatedKeys.has(key)) continue;
            context.toastService.showToast(
                `${equipment.owner.getNotificationDisplayName()}: ${equipment.equipment?.name || equipment.name} EMERGENCY active`,
                'info',
                `c3em-activation-${force.instanceId() ?? force.name}-${key}`
            );
        }
    }

    private setOperatingTurns(equipment: MountedEquipment, turns: number): boolean {
        const normalized = Math.max(0, Math.min(C3EM_FRIED_SEQUENCE_VALUE, Math.trunc(turns)));
        return normalized === 0
            ? equipment.deleteState(C3EM_OPERATING_TURNS_STATE_KEY)
            : equipment.setState(C3EM_OPERATING_TURNS_STATE_KEY, String(normalized));
    }

    private statusLabel(equipment: MountedEquipment): string {
        const status = C3EmergencyMasterHandler.status(equipment);
        if (status === 'fried') return 'fried after 6 operating turns';
        const turns = C3EmergencyMasterHandler.operatingTurns(equipment);
        return `${status}, ${turns}/${C3EM_MAX_OPERATING_TURNS} operating turns`;
    }
}
