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

import { computed, signal, type Signal } from '@angular/core';

import type { CBTForceUnit } from './cbt-force-unit.model';
import type { Equipment } from './equipment.model';
import type { CriticalSlot } from './force-serialization';
import type { MountedEquipmentRuleState } from './rules/unit-type-rules';

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
    private readonly destroyedState = signal<boolean | undefined>(undefined);
    private readonly destroyingState = signal<boolean | undefined>(undefined);

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
    critSlots?: CriticalSlot[];
    states: Map<string, string>;
    el?: SVGElement;
    ammo?: string;
    totalAmmo?: number;
    consumed?: number;
    readonly ruleState: Signal<MountedEquipmentRuleState>;

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
        this.destroyedState.set(data.destroyed);
        this.destroyingState.set(data.destroying);
        this.critSlots = data.critSlots;
        this.states = data.states ?? new Map<string, string>();
        this.el = data.el;
        this.ammo = data.ammo;
        this.totalAmmo = data.totalAmmo;
        this.consumed = data.consumed;
        this.ruleState = computed(() => this.owner.rules.computeEntryState(this));
    }

    static from(entry: MountedEquipment | MountedEquipmentInit): MountedEquipment {
        return entry instanceof MountedEquipment ? entry : new MountedEquipment(entry);
    }

    clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        return new MountedEquipment({
            ...this,
            destroyed: this.committedDestroyedState(),
            destroying: this.pendingDestroyed(),
            states: new Map(this.states),
            ...overrides,
        });
    }

    isDestroyed(): boolean {
        return this.ruleState().isDamaged;
    }

    isDisabled(): boolean {
        return this.ruleState().isDisabled;
    }

    isUnavailable(): boolean {
        const state = this.ruleState();
        return state.isDamaged || state.isDisabled;
    }

    resolvedDestroyed(ruleDamaged: boolean = this.isDestroyed()): boolean {
        if (this.isRepairing()) return false;
        return this.isDestroying() || ruleDamaged;
    }

    resolvedCommittedDestroyed(ruleDamaged: boolean = this.isDestroyed()): boolean {
        return !this.isRepairing() && ruleDamaged;
    }

    committedDestroyedState(): boolean | undefined {
        return this.destroyedState();
    }

    pendingDestroyed(): boolean | undefined {
        return this.destroyingState();
    }

    committedDestroyed(): boolean {
        return !!this.committedDestroyedState();
    }

    effectiveDestroyed(): boolean {
        return this.pendingDestroyed() ?? this.committedDestroyed();
    }

    hasPendingDestroyedChange(): boolean {
        return this.pendingDestroyed() !== undefined;
    }

    isDestroying(): boolean {
        return !this.committedDestroyed() && this.pendingDestroyed() === true;
    }

    isRepairing(): boolean {
        return this.committedDestroyed() && this.pendingDestroyed() === false;
    }

    setPendingDestroyed(destroyed: boolean | undefined): boolean {
        const next = destroyed === undefined || destroyed === this.committedDestroyed() ? undefined : destroyed;
        if (this.pendingDestroyed() === next) return false;
        this.destroyingState.set(next);
        return true;
    }

    setCommittedDestroyed(destroyed: boolean | undefined): boolean {
        if (this.committedDestroyedState() === destroyed) return false;
        this.destroyedState.set(destroyed);
        return true;
    }

    commitPendingDestroyed(): boolean {
        const pendingDestroyed = this.pendingDestroyed();
        if (pendingDestroyed === undefined) return false;
        this.destroyedState.set(pendingDestroyed);
        this.destroyingState.set(undefined);
        return true;
    }

    getBV(): number {
        const baseBV = this.equipment?.bv;
        if (!baseBV) return 0;
        if (baseBV === "variable") {
            return -1;
        }
        return baseBV;
    }
}