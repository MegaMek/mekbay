// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal, type WritableSignal } from '@angular/core';

import type { CBTForceUnit } from './cbt-force-unit.model';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from './equipment.model';
import { WEAPON_TYPES, type WeaponType } from './weapon-types.model';
import type { CriticalSlot } from './force-serialization';
import { isPhysicalWeaponEquipment } from './entity/utils/physical-weapon';

export interface MountedEquipmentInit {
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
    intrinsicPhysicalAttack?: boolean;
    linkedWith?: null | MountedEquipment[];
    parent?: null | MountedEquipment;
    destroyed?: boolean;
    destroying?: boolean;
    critSlots?: CriticalSlot[];
    states?: Map<string, string>;
    el?: SVGElement;
    ammo?: string;
    totalAmmo?: number;
    originalTotalAmmo?: number;
    consumed?: number;
    intrinsicOneShotAmmo?: boolean;
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
    private readonly destroyedState: WritableSignal<boolean | undefined>;
    private readonly destroyingState: WritableSignal<boolean | undefined>;
    private intrinsicPhysicalAttack: boolean;
    private linkedEquipment?: null | MountedEquipment[];
    private parentEquipment?: null | MountedEquipment;
    owner: CBTForceUnit;
    id: string;
    name: string;
    locations?: Set<string>;
    equipment?: Equipment;
    critSlots?: CriticalSlot[];
    states: Map<string, string>;
    el?: SVGElement;
    ammo?: string;
    totalAmmo?: number;
    readonly originalTotalAmmo?: number;
    consumed?: number;
    intrinsicOneShotAmmo?: boolean;

    get linkedWith(): readonly MountedEquipment[] | null | undefined {
        return this.linkedEquipment;
    }

    set linkedWith(entries: readonly MountedEquipment[] | null | undefined) {
        if (entries == null) {
            this.setLinkedEquipment([]);
            this.linkedEquipment = entries;
            return;
        }
        this.setLinkedEquipment(entries);
    }

    get parent(): MountedEquipment | null | undefined {
        return this.parentEquipment;
    }

    set parent(parent: MountedEquipment | null | undefined) {
        if (!parent) {
            this.detachFromParent();
            this.parentEquipment = parent;
            return;
        }
        parent.setLinkedEquipment([...(parent.linkedEquipment ?? []), this]);
    }

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

    replaceStates(states: ReadonlyMap<string, string>): void {
        this.states = new Map(states);
    }

    clearStateValues(): void {
        this.states = new Map([...this.states.keys()].map(name => [name, '']));
    }

    setLinkedEquipment(entries: readonly MountedEquipment[]): void {
        const uniqueEntries = [...new Set(entries)];
        for (const entry of uniqueEntries) this.assertCanLink(entry);

        for (const previous of this.linkedEquipment ?? []) {
            if (!uniqueEntries.includes(previous) && previous.parentEquipment === this) {
                previous.parentEquipment = null;
            }
        }

        for (const entry of uniqueEntries) {
            entry.detachFromParent();
            entry.parentEquipment = this;
        }
        this.linkedEquipment = uniqueEntries;
    }

    clearEquipmentLinks(): void {
        this.setLinkedEquipment([]);
        this.linkedEquipment = null;
        this.detachFromParent();
    }

    detachFromParent(): void {
        const parent = this.parentEquipment;
        if (!parent) {
            this.parentEquipment = null;
            return;
        }
        parent.linkedEquipment = parent.linkedEquipment?.filter(entry => entry !== this) ?? parent.linkedEquipment;
        this.parentEquipment = null;
    }

    private assertCanLink(entry: MountedEquipment): void {
        if (entry === this) throw new Error('Equipment cannot link to itself');
        for (let ancestor: MountedEquipment | null | undefined = this; ancestor; ancestor = ancestor.parentEquipment) {
            if (ancestor === entry) throw new Error('Equipment links cannot contain cycles');
        }
    }

    attachRuntimeContext(element: SVGElement, critSlots: readonly CriticalSlot[] = []): void {
        this.el = element;
        this.critSlots = [...critSlots];
    }

    detachRuntimeContext(): void {
        this.el = undefined;
        this.critSlots = [];
    }

    setAmmoState(state: { ammo?: string; totalAmmo?: number; consumed?: number }): void {
        if ('ammo' in state) this.ammo = state.ammo;
        if ('totalAmmo' in state) this.totalAmmo = state.totalAmmo;
        if ('consumed' in state) this.consumed = state.consumed;
    }

    isIntrinsicPhysicalAttack(): boolean {
        return this.intrinsicPhysicalAttack;
    }

    setIntrinsicPhysicalAttack(physical: boolean): void {
        this.intrinsicPhysicalAttack = physical;
    }

    isPhysicalWeapon(): boolean {
        return this.isIntrinsicPhysicalAttack() || isPhysicalWeaponEquipment(this.equipment);
    }

    constructor(data: MountedEquipmentInit) {
        // A mount may be constructed from an Angular computed context.
        // Initialize the signals with their values; calling `.set()` here would
        // constitute an illegal signal write from that computed.
        this.destroyedState = signal(data.destroyed);
        this.destroyingState = signal(data.destroying);
        this.owner = data.owner;
        this.id = data.id;
        this.name = data.name;
        this.locations = data.locations ? new Set(data.locations) : undefined;
        this.equipment = data.equipment;
        this.intrinsicPhysicalAttack = data.intrinsicPhysicalAttack === true;
        this.linkedEquipment = data.linkedWith ? [...data.linkedWith] : data.linkedWith;
        this.parentEquipment = data.parent;
        this.critSlots = data.critSlots ? [...data.critSlots] : undefined;
        this.states = new Map(data.states);
        this.el = data.el;
        this.ammo = data.ammo;
        this.totalAmmo = data.totalAmmo;
        this.originalTotalAmmo = data.originalTotalAmmo ?? data.totalAmmo;
        this.consumed = data.consumed;
        this.intrinsicOneShotAmmo = data.intrinsicOneShotAmmo;
    }

    static from(entry: MountedEquipment | MountedEquipmentInit): MountedEquipment {
        if (entry instanceof MountedAmmo) return entry;
        if (entry instanceof MountedWeapon && !entry.isPhysicalWeapon()) return entry;
        if (entry instanceof MountedMisc && !entry.isPhysicalWeapon()) return entry;
        return createMountedEquipment(entry instanceof MountedEquipment ? entry.cloneData() : entry);
    }

    static fromAll(entries: readonly MountedEquipment[]): MountedEquipment[] {
        const mountedEntries = entries.map(entry => MountedEquipment.from(entry));
        const replacements = new Map(entries.map((entry, index) => [entry, mountedEntries[index]]));

        for (const entry of mountedEntries) {
            entry.linkedEquipment = entry.linkedEquipment?.map(linked => replacements.get(linked) ?? linked);
            entry.parentEquipment = entry.parentEquipment
                ? replacements.get(entry.parentEquipment) ?? entry.parentEquipment
                : entry.parentEquipment;
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
            locations: this.locations ? new Set(this.locations) : undefined,
            equipment: this.equipment,
            intrinsicPhysicalAttack: this.intrinsicPhysicalAttack,
            linkedWith: this.linkedEquipment ? [...this.linkedEquipment] : this.linkedEquipment,
            parent: this.parentEquipment,
            destroyed: this.committedDestroyedState(),
            destroying: this.pendingDestroyed(),
            critSlots: this.critSlots ? [...this.critSlots] : undefined,
            states: new Map(this.states),
            el: this.el,
            ammo: this.ammo,
            totalAmmo: this.totalAmmo,
            originalTotalAmmo: this.originalTotalAmmo,
            consumed: this.consumed,
            intrinsicOneShotAmmo: this.intrinsicOneShotAmmo,
            ...overrides,
        };
    }

    isDestroyed(): boolean {
        return this.owner.rules.getEquipmentStatus(this) === 'destroyed';
    }

    isDisabled(): boolean {
        return this.owner.rules.getEquipmentStatus(this) === 'disabled';
    }

    isUnavailable(): boolean {
        return this.owner.rules.getEquipmentStatus(this) !== 'available';
    }

    /** Whether this mount is structurally unavailable or temporarily unable to act. */
    isActionUnavailable(): boolean {
        return this.isUnavailable() || this.owner.isEquipmentActionUnavailable(this);
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
        if (!this.equipment) return 0;
        if (!this.equipment.hasFixedBV()) return -1;
        return this.equipment.bv;
    }
}

/** Returns clamped consumed rounds for a mounted one-shot weapon. */
export function getMountedOneShotConsumed(entry: MountedEquipment): number {
    const capacity = entry.equipment instanceof WeaponEquipment ? entry.equipment.oneShotCount ?? 0 : 0;
    if (capacity === 0) return 0;
    const consumed = entry.critSlots?.[0]?.consumed ?? entry.consumed ?? 0;
    return Math.max(0, Math.min(capacity, consumed));
}

export class MountedAmmo extends MountedEquipment {
    declare equipment: AmmoEquipment;

    constructor(data: MountedAmmoInit) {
        super(data);
    }

    getMaxShots(): number {
        return this.equipment.getShots(this.owner.gameRules, this.owner.getEquipmentRegistry());
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
    if (data.intrinsicPhysicalAttack || isPhysicalWeaponEquipment(data.equipment)) {
        return new MountedEquipment(data);
    }
    if (data.equipment instanceof AmmoEquipment) return new MountedAmmo({ ...data, equipment: data.equipment });
    if (data.equipment instanceof WeaponEquipment) return new MountedWeapon({ ...data, equipment: data.equipment });
    if (data.equipment instanceof MiscEquipment) return new MountedMisc({ ...data, equipment: data.equipment });
    return new MountedEquipment(data);
}
