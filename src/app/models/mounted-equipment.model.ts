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

import type { CBTForceUnit } from './cbt-force-unit.model';
import type { Equipment } from './equipment.model';
import type { CriticalSlot } from './force-serialization';

export interface MountedEquipmentInit {
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
    baseHitMod?: string;
    hitModVariation?: null | number;
    physical?: boolean;
    linkedWith?: null | MountedEquipment[];
    parent?: null | MountedEquipment;
    destroyed?: boolean;
    destroying?: boolean;
    critSlots?: CriticalSlot[];
    states?: Map<string, string>;
    el?: SVGElement;
    ammo?: string;
    totalAmmo?: number;
    consumed?: number;
}

export class MountedEquipment {
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
    baseHitMod?: string;
    hitModVariation?: null | number;
    physical?: boolean;
    linkedWith?: null | MountedEquipment[];
    parent?: null | MountedEquipment;
    destroyed?: boolean;
    destroying?: boolean;
    critSlots?: CriticalSlot[];
    states: Map<string, string>;
    el?: SVGElement;
    ammo?: string;
    totalAmmo?: number;
    consumed?: number;

    setState(name: string, value: string): boolean {
        if (this.states.get(name) === value) return false;
        this.states = new Map(this.states);
        this.states.set(name, value);
        return true;
    }

    deleteState(name: string): boolean {
        if (!this.states.has(name)) return false;
        this.states = new Map(this.states);
        this.states.delete(name);
        return true;
    }

    constructor(data: MountedEquipmentInit) {
        this.owner = data.owner;
        this.id = data.id;
        this.name = data.name;
        this.locations = data.locations;
        this.equipment = data.equipment;
        this.baseHitMod = data.baseHitMod;
        this.hitModVariation = data.hitModVariation;
        this.physical = data.physical;
        this.linkedWith = data.linkedWith;
        this.parent = data.parent;
        this.destroyed = data.destroyed;
        this.destroying = data.destroying;
        this.critSlots = data.critSlots;
        this.states = data.states ?? new Map<string, string>();
        this.el = data.el;
        this.ammo = data.ammo;
        this.totalAmmo = data.totalAmmo;
        this.consumed = data.consumed;
    }

    static from(entry: MountedEquipment | MountedEquipmentInit): MountedEquipment {
        return entry instanceof MountedEquipment ? entry : new MountedEquipment(entry);
    }

    clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        return new MountedEquipment({
            ...this,
            states: new Map(this.states),
            ...overrides,
        });
    }

    committedDestroyed(): boolean {
        return !!this.destroyed;
    }

    effectiveDestroyed(): boolean {
        return this.destroying ?? this.committedDestroyed();
    }

    hasPendingDestroyedChange(): boolean {
        return this.destroying !== undefined;
    }

    isDestroying(): boolean {
        return !this.committedDestroyed() && this.destroying === true;
    }

    isRepairing(): boolean {
        return this.committedDestroyed() && this.destroying === false;
    }

    setPendingDestroyed(destroyed: boolean | undefined): boolean {
        const next = destroyed === undefined || destroyed === this.committedDestroyed() ? undefined : destroyed;
        if (this.destroying === next) return false;
        this.destroying = next;
        return true;
    }

    commitPendingDestroyed(): boolean {
        if (this.destroying === undefined) return false;
        this.destroyed = this.destroying;
        this.destroying = undefined;
        return true;
    }
}