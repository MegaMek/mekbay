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
import { AmmoEquipment, MiscEquipment, WEAPON_TYPES, WeaponEquipment, type Equipment, type WeaponType } from './equipment.model';
import type { CriticalSlot } from './force-serialization';
import type { MountedEquipmentRuleState } from './rules/unit-type-rules';

export interface MountedEquipmentInit {
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
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

export interface MountedAmmoInit extends MountedEquipmentInit {
    equipment: AmmoEquipment;
}

export interface MountedWeaponInit extends MountedEquipmentInit {
    equipment: WeaponEquipment;
}

export interface MountedMiscInit extends MountedEquipmentInit {
    equipment: MiscEquipment;
}

export class MountedEquipment {
    private readonly destroyedState = signal<boolean | undefined>(undefined);
    private readonly destroyingState = signal<boolean | undefined>(undefined);

    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
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
        if (entry instanceof MountedAmmo || entry instanceof MountedWeapon || entry instanceof MountedMisc) return entry;
        return createMountedEquipment(entry instanceof MountedEquipment ? entry.cloneData() : entry);
    }

    static fromAll(entries: readonly MountedEquipment[]): MountedEquipment[] {
        const mountedEntries = entries.map(entry => MountedEquipment.from(entry));
        const replacements = new Map(entries.map((entry, index) => [entry, mountedEntries[index]]));

        for (const entry of mountedEntries) {
            entry.linkedWith = entry.linkedWith?.map(linked => replacements.get(linked) ?? linked);
            entry.parent = entry.parent ? replacements.get(entry.parent) ?? entry.parent : entry.parent;
        }

        return mountedEntries;
    }

    clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        return new MountedEquipment(this.cloneData(overrides));
    }

    protected cloneData(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipmentInit {
        return {
            owner: this.owner,
            id: this.id,
            name: this.name,
            locations: this.locations,
            equipment: this.equipment,
            hitModVariation: this.hitModVariation,
            physical: this.physical,
            linkedWith: this.linkedWith,
            parent: this.parent,
            destroyed: this.committedDestroyedState(),
            destroying: this.pendingDestroyed(),
            critSlots: this.critSlots,
            states: new Map(this.states),
            el: this.el,
            ammo: this.ammo,
            totalAmmo: this.totalAmmo,
            consumed: this.consumed,
            ...overrides,
        };
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
}

export class MountedAmmo extends MountedEquipment {
    declare equipment: AmmoEquipment;

    constructor(data: MountedAmmoInit) {
        super(data);
    }

    getMaxShots(): number {
        return this.equipment.getShots(this.owner.gameRules);
    }

    override clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        const data = this.cloneData(overrides);
        return data.equipment instanceof AmmoEquipment
            ? new MountedAmmo({ ...data, equipment: data.equipment })
            : createMountedEquipment(data);
    }
}

export class MountedWeapon extends MountedEquipment {
    declare equipment: WeaponEquipment;

    constructor(data: MountedWeaponInit) {
        super(data);
    }

    getWeaponTypes(ammo: AmmoEquipment | null = null): WeaponType[] {
        const types = new Set(this.equipment.getWeaponTypes());
        ammo?.getRemovedDamageTypes().forEach(type => types.delete(type));
        ammo?.getWeaponTypes().forEach(type => types.add(type));
        return WEAPON_TYPES.filter(type => types.has(type));
    }

    override clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        const data = this.cloneData(overrides);
        return data.equipment instanceof WeaponEquipment
            ? new MountedWeapon({ ...data, equipment: data.equipment })
            : createMountedEquipment(data);
    }
}

export class MountedMisc extends MountedEquipment {
    declare equipment: MiscEquipment;

    constructor(data: MountedMiscInit) {
        super(data);
    }

    override clone(overrides: Partial<MountedEquipmentInit> = {}): MountedEquipment {
        const data = this.cloneData(overrides);
        return data.equipment instanceof MiscEquipment
            ? new MountedMisc({ ...data, equipment: data.equipment })
            : createMountedEquipment(data);
    }
}

function createMountedEquipment(data: MountedEquipmentInit): MountedEquipment {
    if (data.equipment instanceof AmmoEquipment) return new MountedAmmo({ ...data, equipment: data.equipment });
    if (data.equipment instanceof WeaponEquipment) return new MountedWeapon({ ...data, equipment: data.equipment });
    if (data.equipment instanceof MiscEquipment) return new MountedMisc({ ...data, equipment: data.equipment });
    return new MountedEquipment(data);
}
