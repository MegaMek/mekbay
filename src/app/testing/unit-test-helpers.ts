// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { Unit } from '../models/units.model';
import { getUnitTechBaseDisplay } from '../models/tech.model';
import { CBTInventoryControlRuntime } from '../models/cbt-inventory-control-runtime.model';
import type { CBTForceUnit, EquipmentAction, EquipmentStateEdit, EquipmentStatusSource } from '../models/cbt-force-unit.model';
import type { AmmoEquipment, Equipment, EquipmentMap } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import type { InventoryControlRuntimeRangeKey, InventoryControlRuntimeTarget, InventoryControlRuntimeTargetId } from '../models/inventory-control-runtime-state.model';
import { type MountedEquipmentInit, MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import { type CriticalSlot, type HeatProfile } from '../models/force-serialization';
import { getMotiveModeLabel, type MotiveModes } from '../models/motiveModes.model';
import { ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY, CORE_2026_GAME_RULES, type CBTGameRules, type C3DegradationSource, type ToHitAdjustment, type ToHitModifierBreakdownEntry } from '../models/rules/game-rules';
import { ENTRY_DISABLED_STATE_KEY, ENTRY_DISABLED_STATE_VALUE, type UnitModifierBreakdownEntry } from '../models/rules/unit-type-rules';
import {
    combineEquipmentStatuses,
    type EquipmentStatus as MountedEquipmentStatus,
    type EquipmentStatusFacts,
} from '../models/equipment-status.model';
import type { WeaponType } from '../models/weapon-types.model';
import { resolveSelectedInventoryWeaponHeat } from '../utils/inventory-control-heat.util';
import type { InventoryControlPhysicalDamageEffect } from '../utils/inventory-control-physical-damage.util';
import { resolveInventoryControlSelectedAmmoType, type InventoryControlDisplayData, type InventoryControlRules } from '../utils/inventory-control.util';

type TestAlphaStrikeOverrides = Partial<Omit<Unit['as'], 'dmg'>> & {
    dmg?: Partial<Unit['as']['dmg']>;
};

export type TestUnitOverrides = Partial<Omit<Unit, 'as'>> & {
    as?: TestAlphaStrikeOverrides;
};

type TestInventoryControlRules = InventoryControlRules & {
    applyWeaponTypes?: (
        entry: MountedEquipment,
        types: ReadonlySet<WeaponType>,
    ) => ReadonlySet<WeaponType>;
};

function createEmptyAlphaStrikeStats(overrides: TestAlphaStrikeOverrides = {}): Unit['as'] {
    const base: Unit['as'] = {
        TP: 'BM',
        PV: 0,
        SZ: 0,
        TMM: 0,
        usesOV: false,
        OV: 0,
        MV: '0',
        MVm: {},
        MVp: '',
        usesTh: false,
        Th: 0,
        Arm: 0,
        Str: 0,
        specials: [],
        dmg: {
            dmgS: '0',
            dmgM: '0',
            dmgL: '0',
            dmgE: '0',
        },
        usesE: false,
        usesArcs: false,
    };

    return {
        ...base,
        ...overrides,
        MVm: overrides.MVm ? { ...overrides.MVm } : base.MVm,
        specials: overrides.specials ? [...overrides.specials] : base.specials,
        dmg: {
            ...base.dmg,
            ...overrides.dmg,
        },
    };
}

export function createEmptyUnit(overrides: TestUnitOverrides = {}): Unit {
    const { as: asOverrides, ...unitOverrides } = overrides;
    const unit: Unit = {
        name: 'Test Unit',
        id: -1,
        chassis: 'Test',
        model: 'TST-1',
        year: 3151,
        weightClass: 'Medium',
        tons: 50,
        loadoutTons: 50,
        offSpeedFactor: 0,
        bv: 0,
        cost: 0,
        level: 'Introductory',
        techBase: 'Inner Sphere',
        mixed: false,
        techRating: 'D',
        type: 'Mek',
        subtype: 'BattleMek',
        omni: 0,
        engine: 'Fusion',
        engineRating: 0,
        engineHS: 0,
        engineHSType: 'Heat Sink',
        source: [],
        published: [],
        canon: true,
        canAntiMech: false,
        role: '',
        armorType: '',
        structureType: '',
        armor: 0,
        armorPer: 0,
        internal: 1,
        heat: 0,
        dissipation: 0,
        moveType: 'Tracked',
        walk: 0,
        walk2: 0,
        run: 0,
        run2: 0,
        jump: 0,
        jump2: 0,
        umu: 0,
        c3: '',
        dpt: 0,
        comp: [],
        su: 0,
        crewSize: 1,
        quirks: [],
        features: [],
        icon: '',
        sheets: [],
        as: createEmptyAlphaStrikeStats(asOverrides),
        _searchKey: '',
        _displayType: '',
        _techBaseDisplay: 'Inner Sphere',
        _maxRange: 0,
        _weightedMaxRange: 0,
        _dissipationEfficiency: 0,
        _mdSumNoPhysical: 0,
        _mdSumNoPhysicalNoOneshots: 0,
        _nameTags: [],
        _chassisTags: [],
        ...unitOverrides,
    };

    unit._techBaseDisplay = getUnitTechBaseDisplay(unit);

    unit.source = unitOverrides.source ? [...unitOverrides.source] : [];
    unit.published = unitOverrides.published ? [...unitOverrides.published] : [];
    unit.comp = unitOverrides.comp ? [...unitOverrides.comp] : [];
    unit.quirks = unitOverrides.quirks ? [...unitOverrides.quirks] : [];
    unit.features = unitOverrides.features ? [...unitOverrides.features] : [];
    unit.sheets = unitOverrides.sheets ? [...unitOverrides.sheets] : [];
    unit._nameTags = unitOverrides._nameTags ? [...unitOverrides._nameTags] : [];
    unit._chassisTags = unitOverrides._chassisTags ? [...unitOverrides._chassisTags] : [];

    return unit;
}

export interface CBTForceUnitTestHarnessOptions {
    id?: string;
    unit?: TestUnitOverrides;
    conditions?: readonly string[];
    gameRules?: CBTGameRules;
    components?: readonly MountedEquipment[];
    criticalSlots?: readonly CriticalSlot[];
    equipment?: EquipmentMap;
    equipmentStatuses?: ReadonlyMap<MountedEquipment, MountedEquipmentStatus>;
    equipmentStatusesAtLocation?: ReadonlyMap<MountedEquipment, ReadonlyMap<string, MountedEquipmentStatus>>;
    equipmentToHitModifiers?: ReadonlyMap<MountedEquipment, readonly ToHitModifierBreakdownEntry[]>;
    heat?: Partial<HeatProfile>;
    tracksHeat?: boolean;
    heatDissipation?: number;
    heatDissipationConsumed?: number;
    heatSources?: number;
    gunnerySkill?: number;
    pilotingSkill?: number;
    moveMode?: MotiveModes | null;
    attackModifierBreakdown?: UnitModifierBreakdownEntry[];
    attackMovementCanAffectTargetNumbers?: boolean;
    hasLinkedC3Network?: boolean;
    c3DegradationSource?: C3DegradationSource;
    allowExtremeRange?: boolean;
    readOnly?: boolean;
    hasDirectInventory?: boolean;
    resolveEquipmentStatus?: (source: EquipmentStatusSource) => MountedEquipmentStatus;
    resolveEquipmentStatusAtLocation?: (entry: MountedEquipment, location: string) => MountedEquipmentStatus;
    resolveEquipmentActionPermission?: (entry: MountedEquipment, action: EquipmentAction) => boolean;
    getEquipmentToHitModifiers?: (entry: MountedEquipment) => readonly ToHitModifierBreakdownEntry[];
    applyInventoryControlDisplayEffects?: (entry: MountedEquipment, display: InventoryControlDisplayData) => InventoryControlDisplayData;
}

export interface CBTForceUnitTestTurnState {
    moveMode(): MotiveModes | null;
    airborne(): boolean;
    getAttackMovementModifier(): number;
    getAttackModifierBreakdown(): UnitModifierBreakdownEntry[];
    missingAttackMovementModifier(): boolean;
    getSpottingModifier(): number;
    heatSources(): Array<{ id: string; label: string; value: number }>;
    heatDissipationBalance(): number;
    effectiveHeatDissipation(): number;
    addFiredHeat(amount: number): void;
}

export class CBTForceUnitTestHarness {
    readonly components: MountedEquipment[] = [];
    readonly criticalSlots: CriticalSlot[] = [];
    readonly equipment: EquipmentMap;
    equipmentRegistry: EquipmentRegistry;
    readonly equipmentStatuses: Map<MountedEquipment, MountedEquipmentStatus>;
    readonly equipmentStatusesAtLocation: Map<MountedEquipment, Map<string, MountedEquipmentStatus>>;
    readonly equipmentToHitModifiers: Map<MountedEquipment, readonly ToHitModifierBreakdownEntry[]>;
    readonly heat: HeatProfile;
    readonly turnState: CBTForceUnitTestTurnState;
    readonly unit: CBTForceUnit;
    readonly runtime: CBTInventoryControlRuntime;

    private inventoryControlRules: TestInventoryControlRules = {};
    private toHitAdjustments: (
        entry: MountedEquipment,
        selectedAmmo?: AmmoEquipment | null
    ) => readonly ToHitAdjustment[] = () => [];

    constructor(readonly options: CBTForceUnitTestHarnessOptions = {}) {
        this.equipment = { ...options.equipment };
        this.equipmentRegistry = new EquipmentRegistry(this.equipment);
        this.equipmentStatuses = new Map(options.equipmentStatuses);
        this.equipmentStatusesAtLocation = new Map(
            Array.from(
                options.equipmentStatusesAtLocation ?? [],
                ([entry, statuses]) => [entry, new Map(statuses)] as const,
            ),
        );
        this.equipmentToHitModifiers = new Map(options.equipmentToHitModifiers);
        this.heat = {
            current: options.heat?.current ?? 2,
            previous: options.heat?.previous ?? 1,
            next: options.heat?.next,
            heatsinksOff: options.heat?.heatsinksOff,
        };
        const conditions = new Map((options.conditions ?? []).map(condition => [condition, undefined] as const));
        let firedHeat = 0;

        const baseUnit = createEmptyUnit({ id: -1, name: options.id ?? 'Test Unit', ...options.unit });
        const attackMovementModifier = (): number => {
            switch (options.moveMode ?? null) {
                case 'walk': return 1;
                case 'run': return 2;
                case 'jump': return 3;
                default: return 0;
            }
        };
        const heatDissipationBalance = (): number => (
            (options.tracksHeat === false ? 0 : options.heatDissipation ?? 0)
            - (options.heatDissipationConsumed ?? 0)
        );
        this.turnState = {
            moveMode: () => options.moveMode ?? null,
            airborne: () => false,
            getAttackMovementModifier: attackMovementModifier,
            getAttackModifierBreakdown: () => options.attackModifierBreakdown ?? (attackMovementModifier() !== 0
                ? [{ label: getMotiveModeLabel(options.moveMode!, baseUnit, false), modifier: attackMovementModifier(), priority: ATTACK_MOVEMENT_MODIFIER_BREAKDOWN_PRIORITY }]
                : []),
            missingAttackMovementModifier: () => (options.moveMode ?? null) === null && (options.attackMovementCanAffectTargetNumbers ?? true),
            getSpottingModifier: () => 0,
            heatSources: () => [
                ...(options.heatSources ? [{ id: 'test-source', label: 'Test Source', value: options.heatSources }] : []),
                ...(firedHeat > 0 ? [{ id: 'weapons', label: 'Weapons', value: firedHeat }] : []),
                ...(heatDissipationBalance() < 0 ? [{
                    id: 'heat-dissipation-deficit',
                    label: 'Dissipation',
                    value: -heatDissipationBalance(),
                }] : []),
            ],
            heatDissipationBalance,
            effectiveHeatDissipation: () => Math.max(0, heatDissipationBalance()),
            addFiredHeat: (amount: number) => {
                if (Number.isFinite(amount) && amount > 0) firedHeat += amount;
            }
        };

        const findCurrentCriticalSlot = (snapshot: CriticalSlot): CriticalSlot | null => {
            const matches = this.criticalSlots.filter(candidate => {
                if (snapshot.loc && snapshot.slot !== undefined) {
                    return candidate.loc === snapshot.loc && candidate.slot === snapshot.slot;
                }
                return !!snapshot.id && candidate.id === snapshot.id;
            });
            if (matches.length > 1) {
                throw new Error(`Duplicate critical-slot identity: ${snapshot.loc ?? snapshot.id}:${snapshot.slot ?? ''}`);
            }
            return matches[0] ?? null;
        };
        const currentCriticalSlots = (entry: MountedEquipment): CriticalSlot[] => (
            entry.critSlots?.flatMap(snapshot => findCurrentCriticalSlot(snapshot) ?? []) ?? []
        );
        const mountedCriticalStatusContribution = (
            destroyedCriticalCount: number,
            equipmentFlags: EquipmentStatusFacts['equipmentFlags'],
        ): MountedEquipmentStatus => {
            const threshold = baseUnit.type === 'Mek' && equipmentFlags.has('F_AC') ? 2 : 1;
            return destroyedCriticalCount >= threshold ? 'destroyed' : 'available';
        };
        const mountedCriticalStatus = (
            entry: MountedEquipment,
            criticalSlots: readonly CriticalSlot[],
        ): MountedEquipmentStatus => mountedCriticalStatusContribution(
            criticalSlots.filter(slot => !!slot.destroyed).length,
            entry.equipment?.flags ?? new Set(),
        );
        const resolveEquipmentStatus = (source: EquipmentStatusSource): MountedEquipmentStatus => {
            if (options.resolveEquipmentStatus) return options.resolveEquipmentStatus(source);
            if (!(source instanceof MountedEquipment)) {
                return findCurrentCriticalSlot(source)?.destroyed ? 'destroyed' : 'available';
            }
            const entryStatus = this.equipmentStatuses.get(source) ?? defaultEquipmentStatus(source);
            const criticalStatus = mountedCriticalStatus(source, currentCriticalSlots(source));
            return combineEquipmentStatuses([
                entryStatus,
                criticalStatus,
                ...(this.equipmentStatusesAtLocation.get(source)?.values() ?? []),
            ]);
        };
        const resolveEquipmentStatusAtLocation = (
            entry: MountedEquipment,
            location: string,
        ): MountedEquipmentStatus => {
            if (options.resolveEquipmentStatusAtLocation) {
                return options.resolveEquipmentStatusAtLocation(entry, location);
            }
            const entryStatus = this.equipmentStatuses.get(entry) ?? defaultEquipmentStatus(entry);
            const locationStatus = this.equipmentStatusesAtLocation.get(entry)?.get(location) ?? 'available';
            const criticalStatus = mountedCriticalStatus(
                entry,
                currentCriticalSlots(entry).filter(slot => slot.loc === location),
            );
            return combineEquipmentStatuses([entryStatus, locationStatus, criticalStatus]);
        };
        const resolveEquipmentInstallationLocationStatus = (entry: MountedEquipment): MountedEquipmentStatus => {
            const locations = new Set([
                ...(entry.locations ?? []),
                ...currentCriticalSlots(entry).flatMap(slot => slot.loc ? [slot.loc] : []),
            ]);
            return combineEquipmentStatuses(Array.from(
                locations,
                location => resolveEquipmentStatusAtLocation(entry, location),
            ));
        };
        const getEquipmentToHitModifiers = (entry: MountedEquipment) => options.getEquipmentToHitModifiers?.(entry)
            ?? this.equipmentToHitModifiers.get(entry)
            ?? [];
        const rules = {
            getEquipmentStatusContribution: () => 'available' as const,
            getMountedCriticalStatusContribution: (facts: EquipmentStatusFacts) => mountedCriticalStatusContribution(
                facts.criticals.filter(critical => critical.status === 'destroyed').length,
                facts.equipmentFlags,
            ),
            getEquipmentStatusContributionAtLocation: () => 'available' as const,
            getCriticalSlotStatusContribution: () => 'available' as const,
            getUnitSystemStatusFacts: () => ({ engineHit: false }),
            getEquipmentToHitModifiers,
            heatDissipation: () => options.tracksHeat === false ? null : {
                totalPips: 10,
                healthyPips: 10,
                damagedCount: 0,
                heatsinksOff: options.heat?.heatsinksOff ?? 0,
                totalDissipation: options.heatDissipation ?? 0
            },
            getAttackMovementModifier: (moveMode: MotiveModes | null | undefined) => {
                switch (moveMode) {
                    case 'walk': return 1;
                    case 'run': return 2;
                    case 'jump': return 3;
                    default: return 0;
                }
            },
            getBaseGunnerySkill: () => options.gunnerySkill ?? 4,
            getBasePilotingSkill: () => options.pilotingSkill ?? 5,
            canPerformEquipmentAction: (entry: MountedEquipment, action: EquipmentAction) =>
                options.resolveEquipmentActionPermission?.(entry, action) ?? action !== 'configure-network',
            applyInventoryControlDisplayEffects: (entry: MountedEquipment, display: InventoryControlDisplayData) =>
                options.applyInventoryControlDisplayEffects?.(entry, display) ?? display
        };

        this.unit = {
            id: options.id,
            gameRules: options.gameRules ?? CORE_2026_GAME_RULES,
            getInventory: () => this.components,
            getCritSlots: () => this.criticalSlots,
            getEquipmentRegistry: () => this.equipmentRegistry,
            findEquipment: (name: string) => this.equipmentRegistry.findEquipment(name) ?? undefined,
            getUnit: () => baseUnit,
            getCondition: (condition: string) => conditions.has(condition),
            getConditions: () => conditions,
            getHeat: () => this.heat,
            setHeat: (value: number) => this.heat.next = value,
            gunnerySkill: () => options.gunnerySkill ?? 4,
            pilotingSkill: () => options.pilotingSkill ?? 5,
            turnState: () => this.turnState,
            svgService: {},
            hasLinkedC3Network: () => options.hasLinkedC3Network ?? false,
            c3DegradationSource: () => options.c3DegradationSource ?? 'none',
            allowsExtremeRangeAttacks: () => options.allowExtremeRange ?? false,
            resolveC3Targeting: (target: InventoryControlRuntimeTarget) => {
                if (!options.hasLinkedC3Network) {
                    return {
                        target: target.c3Distance === undefined ? target : { ...target, c3Distance: undefined },
                        degradationSource: 'none' as const
                    };
                }
                return (options.gameRules ?? CORE_2026_GAME_RULES).resolveC3Targeting(
                    target,
                    options.c3DegradationSource ?? 'none'
                );
            },
            readOnly: () => options.readOnly ?? false,
            hasDirectInventory: () => options.hasDirectInventory ?? true,
            setInventory: (inventory: MountedEquipment[]) => {
                const nextInventory = [...inventory];
                this.components.splice(0, this.components.length);
                nextInventory.forEach(entry => this.addComponent(entry));
                this.runtime.markAmmoSourcesChanged();
            },
            setInventoryEntry: (entry: MountedEquipment) => {
                this.addComponent(entry);
                this.runtime.markAmmoSourcesChanged();
            },
            setCritSlot: (slot: CriticalSlot) => {
                this.addCriticalSlot(slot);
                this.runtime.markAmmoSourcesChanged();
            },
            findCurrentCriticalSlot,
            getEquipmentStatus: (source: EquipmentStatusSource) => resolveEquipmentStatus(source),
            getEquipmentStatusAtLocation: (entry: MountedEquipment, location: string) =>
                resolveEquipmentStatusAtLocation(entry, location),
            getEquipmentInstallationLocationStatus: resolveEquipmentInstallationLocationStatus,
            isEquipmentOperational: (source: EquipmentStatusSource) => resolveEquipmentStatus(source) === 'available',
            isEquipmentOperationalAtLocation: (entry: MountedEquipment, location: string) =>
                resolveEquipmentStatusAtLocation(entry, location) === 'available',
            isEquipmentResolvedDestroyed: (entry: MountedEquipment) =>
                this.unit.getEquipmentInstallationLocationStatus(entry) === 'destroyed'
                || (!entry.isRepairing() && (entry.isDestroying() || resolveEquipmentStatus(entry) === 'destroyed')),
            isEquipmentResolvedCommittedDestroyed: (entry: MountedEquipment) =>
                this.unit.getEquipmentInstallationLocationStatus(entry) === 'destroyed'
                || (!entry.isRepairing() && resolveEquipmentStatus(entry) === 'destroyed'),
            canPerformEquipmentAction: (entry: MountedEquipment, action: EquipmentAction) => {
                if (action !== 'configure-network'
                    && (resolveEquipmentStatus(entry) !== 'available' || conditions.has('shutdown'))) return false;
                return rules.canPerformEquipmentAction(entry, action);
            },
            canEditEquipmentState: (entry: MountedEquipment, edit: EquipmentStateEdit) => {
                if (options.readOnly) return false;
                const status = resolveEquipmentStatus(entry);
                if (edit === 'enable') return status === 'disabled';
                if (edit === 'disable') return status === 'available';
                if (edit === 'repair') {
                    return this.unit.getEquipmentInstallationLocationStatus(entry) !== 'destroyed'
                        && (entry.isDestroying() || (entry.committedDestroyed() && !entry.isRepairing()));
                }
                return !this.unit.isEquipmentResolvedDestroyed(entry);
            },
            applyEquipmentDamage: (entry: MountedEquipment) => {
                if (!this.unit.canEditEquipmentState(entry, 'apply-damage')) return false;
                if (!entry.setPendingDestroyed(true)) return false;
                this.unit.setInventoryEntry(entry);
                return true;
            },
            repairEquipment: (entry: MountedEquipment) => {
                if (!this.unit.canEditEquipmentState(entry, 'repair')) return false;
                if (!entry.setPendingDestroyed(false)) return false;
                this.unit.setInventoryEntry(entry);
                return true;
            },
            matchesInventoryControlAmmo: (entry: MountedEquipment, ammo: AmmoEquipment, mode: string | null) =>
                this.inventoryControlRules.matchesAmmo?.(entry, ammo, mode) ?? null,
            getInventoryControlRules: () => this.inventoryControlRules,
            rules
        } as unknown as CBTForceUnit;

        this.runtime = installInventoryControlRuntime(this.unit);
        Object.assign(this.unit, {
            getInventoryControlSelectedAmmo: (entry: MountedEquipment, mode?: string | null) => resolveInventoryControlSelectedAmmoType(
                entry,
                this.equipmentRegistry,
                (weapon, ammo, selectedMode) => this.unit.matchesInventoryControlAmmo(weapon, ammo, selectedMode),
                this.runtime.getEntryAmmoSelection(entry.id),
                mode,
            ),
            getEffectiveWeaponTypes: (entry: MountedWeapon) => {
                const baseTypes = new Set(entry.getWeaponTypes(this.unit.getInventoryControlSelectedAmmo(entry)));
                return this.inventoryControlRules.applyWeaponTypes?.(entry, baseTypes) ?? baseTypes;
            },
            getEffectivePhysicalDamageEffect: (
                entry: MountedEquipment,
                effect: InventoryControlPhysicalDamageEffect,
            ) => this.inventoryControlRules.applyPhysicalDamageEffects?.(entry, effect) ?? effect,
            selectedInventoryWeaponHeat: () => resolveSelectedInventoryWeaponHeat(
                this.components,
                this.runtime.entryStates(),
                this.inventoryControlRules
            )
        });
        options.components?.forEach(component => this.addComponent(component));
        options.criticalSlots?.forEach(slot => this.addCriticalSlot(slot));
    }

    addComponent(component: MountedEquipment | Omit<MountedEquipmentInit, 'owner'>): MountedEquipment {
        const mounted = component instanceof MountedEquipment
            ? component
            : MountedEquipment.from({ ...component, owner: this.unit });
        // Test fixtures may be created before their harness; production ownership remains immutable.
        (mounted as { owner: CBTForceUnit }).owner = this.unit;
        const existingIndex = this.components.findIndex(candidate => candidate.id === mounted.id);
        if (existingIndex === -1) {
            this.components.push(mounted);
        } else {
            this.components[existingIndex] = mounted;
        }
        if (mounted.equipment) this.addEquipment(mounted.equipment);
        return mounted;
    }

    addCriticalSlot(slot: CriticalSlot): CriticalSlot {
        const existingIndex = this.criticalSlots.findIndex(candidate => candidate === slot
            || (candidate.loc === slot.loc && candidate.slot === slot.slot));
        if (existingIndex === -1) {
            this.criticalSlots.push(slot);
        } else {
            this.criticalSlots[existingIndex] = slot;
        }
        if (slot.eq) this.addEquipment(slot.eq);
        return slot;
    }

    addEquipment(equipment: Equipment): Equipment {
        this.equipment[equipment.internalName] = equipment;
        this.equipmentRegistry = new EquipmentRegistry(this.equipment);
        return equipment;
    }

    setEquipmentStatus(entry: MountedEquipment, status: MountedEquipmentStatus): this {
        this.equipmentStatuses.set(entry, status);
        return this;
    }

    setEquipmentStatusAtLocation(
        entry: MountedEquipment,
        location: string,
        status: MountedEquipmentStatus,
    ): this {
        const statuses = this.equipmentStatusesAtLocation.get(entry) ?? new Map<string, MountedEquipmentStatus>();
        statuses.set(location, status);
        this.equipmentStatusesAtLocation.set(entry, statuses);
        return this;
    }

    setEquipmentToHitModifiers(entry: MountedEquipment, modifiers: readonly ToHitModifierBreakdownEntry[]): this {
        this.equipmentToHitModifiers.set(entry, modifiers);
        return this;
    }

    setInventoryControlRules(rules: TestInventoryControlRules): this {
        this.inventoryControlRules = rules;
        return this;
    }

    setToHitAdjustments(
        resolver: (entry: MountedEquipment, selectedAmmo?: AmmoEquipment | null) => readonly ToHitAdjustment[]
    ): this {
        this.toHitAdjustments = resolver;
        this.inventoryControlRules = {
            ...this.inventoryControlRules,
            resolveToHitAdjustments: (entry, selectedAmmo) => this.toHitAdjustments(entry, selectedAmmo)
        };
        return this;
    }
}

export function createCBTForceUnitTestHarness(options: CBTForceUnitTestHarnessOptions = {}): CBTForceUnitTestHarness {
    return new CBTForceUnitTestHarness(options);
}

function defaultEquipmentStatus(entry: MountedEquipment): MountedEquipmentStatus {
    return entry.committedDestroyed()
        ? 'destroyed'
        : entry.states.get(ENTRY_DISABLED_STATE_KEY) === ENTRY_DISABLED_STATE_VALUE
            ? 'disabled'
            : 'available';
}

function installInventoryControlRuntime(unit: CBTForceUnit): CBTInventoryControlRuntime {
    const runtime = new CBTInventoryControlRuntime(unit);
    Object.assign(unit, {
        inventoryControl: runtime,
        getInventoryControlSnapshot: () => runtime.getSnapshot(),
        getInventoryControlTargets: () => runtime.getTargets(),
        getInventoryControlTargetsMap: () => runtime.targetsMap(),
        getInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.getTarget(targetId),
        getInventoryControlEntryTargetId: (entryId: string) => runtime.getEntryTargetId(entryId),
        isInventoryControlEntrySelected: (entryId: string) => runtime.isEntrySelected(entryId),
        getInventoryControlEntryRange: (entryId: string) => runtime.getEntryRange(entryId),
        getInventoryControlEntryAmmoSelection: (entryId: string) => runtime.getEntryAmmoSelection(entryId),
        setInventoryControlEntrySelected: (entry: MountedEquipment, selected: boolean) => runtime.setEntrySelected(entry, selected),
        setInventoryControlEntryRange: (entry: MountedEquipment, range: InventoryControlRuntimeRangeKey | null) => runtime.setEntryRange(entry, range),
        toggleInventoryControlEntryRange: (entry: MountedEquipment, range: InventoryControlRuntimeRangeKey, forceSelected = false) => runtime.toggleEntryRange(entry, range, forceSelected),
        setInventoryControlEntryAmmoSelection: (entryId: string, selection: Parameters<typeof runtime.setEntryAmmoSelection>[1]) => runtime.setEntryAmmoSelection(entryId, selection),
        setInventoryControlEntryTarget: (entry: MountedEquipment, targetId: InventoryControlRuntimeTargetId | null) => runtime.setEntryTarget(entry, targetId),
        createInventoryControlTarget: () => runtime.createTarget(),
        updateInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId, patch: Partial<Omit<InventoryControlRuntimeTarget, 'id' | 'letter'>>) => runtime.updateTarget(targetId, patch),
        deleteInventoryControlTarget: (targetId: InventoryControlRuntimeTargetId) => runtime.deleteTarget(targetId),
        resetInventoryControlTargets: () => runtime.resetTargets(),
        clearInventoryControlSelection: () => runtime.clearSelection(),
        syncInventoryControlSelectionSvg: () => runtime.syncSelectionSvg()
    });
    return runtime;
}
