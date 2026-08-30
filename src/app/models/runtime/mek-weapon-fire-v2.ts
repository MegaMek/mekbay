// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ImmutableIndex } from '../entity/immutable-collections';
import type { ComponentId } from '../entity/entity-identifiers';
import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    bombastLaserProfile,
    isBombastLaserEquipment,
} from '../bombast-laser-mode.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import {
    createAmmoCompatibilityMatch,
    matchesAmmoCompatibility,
} from '../ammo-compatibility-matcher.model';
import {
    canPerformMekAction,
    type MekActionRuntimePort,
} from './mek-action-availability';
import { resolveComponentBayRuntime } from './component-bay-runtime';
import {
    BOMBAST_LASER_CHARGING_STATE,
    isBombastLaserComponent,
} from './component-bombast-laser';
import {
    ppcCapacitorFireTransition,
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_CHARGING_STATE,
    PPC_CAPACITOR_HEAT_BONUS,
} from './component-ppc-capacitor';
import {
    canonicalizeMekTurnStateV2,
    MAX_MEK_TURN_NUMBER,
    type MekTurnStateV2,
} from './mek-turn-state-v2';
import { mekHeatSourceSignatureV2 } from './mek-heat-state-v2';
import type {
    AmmoRuntimeState,
    BombastLaserRuntimeState,
    MekUnitRuntimeState,
    ComponentRuntimeState,
    PpcCapacitorRuntimeState,
} from './runtime-state';
import type { MekRuntimeIndex } from './mek-runtime-index';
import { equipmentForComponent } from './mek-runtime-index';
import {
    mekAmmoLoadout,
    mekIntrinsicMagazine,
} from './mek-ammo';
import { rapidFireAutocannonShotCount } from './component-rapid-fire-autocannon';
import {
    mekRiscLaserPulseActive,
} from './component-risc-laser-pulse';
import { RISC_LASER_PULSE_HEAT_BONUS } from '../risc-laser-mode.model';
import {
    prototypeLaserHeatForRoll,
    prototypeLaserHeatRollMap,
    prototypeLaserMaximumExtraHeat,
    type PrototypeLaserHeatResult,
    type PrototypeLaserHeatRoll,
} from '../prototype-laser-heat.model';

export const MAX_MEK_WEAPON_FIRE_SELECTIONS = 256;

/**
 * One exact action-time weapon/source choice. It is a command operand, not a
 * second persisted selection store. Ammunition choices pin the selected
 * munition so a reconfiguration race cannot silently fire something else.
 */
export interface MekWeaponFireSelectionV2 {
    readonly weaponId: ComponentId;
    readonly ammoSourceId?: ComponentId;
    readonly expectedMunitionKey?: string;
}

export type MekWeaponFireRuntimeViewV2 = MekActionRuntimePort & {
    turnState(): MekTurnStateV2;
    componentMode(componentId: ComponentId): string | undefined;
    componentJammed(componentId: ComponentId): boolean;
    componentPpcCapacitor(componentId: ComponentId): PpcCapacitorRuntimeState | undefined;
    componentBombastLaser(componentId: ComponentId): BombastLaserRuntimeState | undefined;
    ammoLoadout(componentId: ComponentId): {
        readonly munitionKey: string;
        readonly capacity: number;
    };
    remainingAmmo(componentId: ComponentId): number;
};

export type MekWeaponFirePlanRejectionCode =
    | 'EMPTY_SELECTION'
    | 'TOO_MANY_SELECTIONS'
    | 'DUPLICATE_WEAPON'
    | 'INVALID_WEAPON'
    | 'UNAVAILABLE_WEAPON'
    | 'UNSUPPORTED_INTERACTION'
    | 'INVALID_AMMO_SOURCE'
    | 'MUNITION_CHANGED'
    | 'INCOMPATIBLE_AMMO'
    | 'INSUFFICIENT_AMMO'
    | 'INVALID_HEAT_ROLL'
    | 'HEAT_LIMIT_EXCEEDED';

export interface MekWeaponFireAmmoSpendV2 {
    readonly sourceId: ComponentId;
    readonly amount: number;
    readonly munitionKey: string;
}

export interface MekWeaponFirePpcTransitionV2 {
    readonly capacitorId: ComponentId;
    readonly weaponId: ComponentId;
}

export interface MekWeaponFireBombastTransitionV2 {
    readonly weaponId: ComponentId;
}

export interface MekWeaponFirePlanV2 {
    readonly selections: readonly MekWeaponFireSelectionV2[];
    readonly heat: number;
    readonly ammoSpends: readonly MekWeaponFireAmmoSpendV2[];
    readonly ppcTransitions: readonly MekWeaponFirePpcTransitionV2[];
    readonly bombastTransitions: readonly MekWeaponFireBombastTransitionV2[];
    readonly prototypeHeat: readonly PrototypeLaserHeatResult[];
}

interface EffectiveMekWeaponFireSelectionV2 {
    /** The physical weapon whose heat, ammo, lifecycle, and status are consumed. */
    readonly weaponId: ComponentId;
    /** The action target used for bay-aware permission checks. */
    readonly actionComponentId: ComponentId;
    /** The immutable caller operand retained for its exact ammo-source choice. */
    readonly source: MekWeaponFireSelectionV2;
}

export type MekWeaponFirePlanResultV2 =
    | { readonly accepted: true; readonly plan: MekWeaponFirePlanV2 }
    | { readonly accepted: false; readonly code: MekWeaponFirePlanRejectionCode };

/**
 * Pure, fail-closed planner. Every fact is reread from the canonical entity
 * and current sparse runtime; callers cannot supply heat,
 * capacity, status, lifecycle, or compatibility decisions.
 */
export function planMekWeaponFireV2(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekWeaponFireRuntimeViewV2,
    selections: readonly MekWeaponFireSelectionV2[],
    prototypeHeatRolls: readonly PrototypeLaserHeatRoll[] = [],
): MekWeaponFirePlanResultV2 {
    if (!Array.isArray(selections) || selections.length === 0) return rejected('EMPTY_SELECTION');
    if (selections.length > MAX_MEK_WEAPON_FIRE_SELECTIONS) return rejected('TOO_MANY_SELECTIONS');
    const heatRollEvidence = prototypeLaserHeatRollMap(prototypeHeatRolls);
    if (!heatRollEvidence.accepted) return rejected('INVALID_HEAT_ROLL');

    const seenActions = new Set<ComponentId>();
    const effectiveSelections: EffectiveMekWeaponFireSelectionV2[] = [];
    for (const raw of selections) {
        if (!raw || typeof raw !== 'object' || typeof raw.weaponId !== 'string') {
            return rejected('INVALID_WEAPON');
        }
        if (seenActions.has(raw.weaponId)) return rejected('DUPLICATE_WEAPON');
        seenActions.add(raw.weaponId);
        const expanded = expandMekBayFireSelection(index, runtime, raw);
        if (!expanded.accepted) return rejected(expanded.code);
        effectiveSelections.push(...expanded.selections);
        if (effectiveSelections.length > MAX_MEK_WEAPON_FIRE_SELECTIONS) {
            return rejected('TOO_MANY_SELECTIONS');
        }
    }

    const seenWeapons = new Set<ComponentId>();
    const ammoSpends = new Map<ComponentId, MekWeaponFireAmmoSpendV2>();
    const ppcTransitions: MekWeaponFirePpcTransitionV2[] = [];
    const bombastTransitions: MekWeaponFireBombastTransitionV2[] = [];
    const prototypeHeat: PrototypeLaserHeatResult[] = [];
    let heat = 0;

    for (const effective of effectiveSelections) {
        const weaponId = effective.weaponId;
        const raw = effective.source;
        if (seenWeapons.has(weaponId)) return rejected('DUPLICATE_WEAPON');
        seenWeapons.add(weaponId);

        const weapon = equipmentForComponent(index, weaponId);
        const mount = index.components.get(weaponId);
        if (!(weapon instanceof WeaponEquipment)
            || mount?.kind !== 'equipment'
            || mount.mount.isPhysicalWeapon()) {
            return rejected('INVALID_WEAPON');
        }
        if (!canPerformMekAction(
            entity,
            index,
            runtime,
            { kind: 'component', componentId: effective.actionComponentId },
            'fire',
            ruleset,
        ) || runtime.componentStatus(weaponId, 'committed') !== 'available'
            || runtime.componentJammed(weaponId)) {
            return rejected('UNAVAILABLE_WEAPON');
        }

        const ppc = ppcCapacitorFireTransition(entity, index, weaponId);
        if (ppc === false) return rejected('UNSUPPORTED_INTERACTION');
        if (ppc) {
            const lifecycle = runtime.componentPpcCapacitor(ppc.capacitorId);
            if (runtime.componentStatus(ppc.capacitorId, 'committed') === 'available') {
                if (lifecycle?.chargeState === PPC_CAPACITOR_CHARGING_STATE) {
                    return rejected('UNAVAILABLE_WEAPON');
                }
                if (lifecycle?.chargeState === PPC_CAPACITOR_CHARGED_STATE) {
                    // A charged capacitor is also a passive +5 heat source. An exact durable
                    // acknowledgement proves that +5 was already consolidated; firing replaces
                    // that settled source and adds only the weapon's base heat, even if policy
                    // changed after settlement.
                    if (!isAcknowledgedChargedPpcSource(runtime, weaponId)) {
                        heat += PPC_CAPACITOR_HEAT_BONUS;
                    }
                }
            }
            ppcTransitions.push(ppc);
        }

        const bombast = bombastTransition(index, ruleset, runtime, weaponId, weapon);
        if (bombast === false) return rejected('UNSUPPORTED_INTERACTION');
        if (bombast === 'unavailable') return rejected('UNAVAILABLE_WEAPON');
        if (bombast !== null && bombast.transition !== undefined) {
            bombastTransitions.push(bombast.transition);
        }

        const shotCount = rapidFireAutocannonShotCount(weapon, runtime.componentMode(weaponId));
        const riscLaserPulseHeat = mekRiscLaserPulseActive(index, runtime, weaponId)
            ? RISC_LASER_PULSE_HEAT_BONUS
            : 0;
        heat += ((bombast === null ? weapon.heat : bombast.heat) + riscLaserPulseHeat)
            * shotCount;
        if (prototypeLaserMaximumExtraHeat(weapon.internalName) > 0) {
            const rolled = prototypeLaserHeatForRoll(
                weapon.internalName,
                weaponId,
                heatRollEvidence.rolls.get(weaponId) ?? 0,
            );
            if (rolled === null) return rejected('INVALID_HEAT_ROLL');
            const result = shotCount === 1
                ? rolled
                : Object.freeze({
                    ...rolled,
                    additionalHeat: rolled.additionalHeat * shotCount,
                    detail: `${rolled.detail} × ${shotCount}`,
                });
            prototypeHeat.push(result);
            heat += result.additionalHeat;
        }
        if (!Number.isFinite(heat) || heat < 0 || heat > MAX_MEK_TURN_NUMBER) {
            return rejected('HEAT_LIMIT_EXCEEDED');
        }

        const ammoResult = selectedAmmoSpend(entity, index, ruleset, runtime, weaponId, weapon, raw);
        if (!ammoResult.accepted) return ammoResult;
        if (ammoResult.spend) {
            const current = ammoSpends.get(ammoResult.spend.sourceId);
            ammoSpends.set(ammoResult.spend.sourceId, Object.freeze({
                ...ammoResult.spend,
                amount: (current?.amount ?? 0) + ammoResult.spend.amount,
            }));
        }
    }

    for (const spend of ammoSpends.values()) {
        if (runtime.remainingAmmo(spend.sourceId) < spend.amount) {
            return rejected('INSUFFICIENT_AMMO');
        }
    }
    const existingHeat = runtime.turnState().weaponsHeat;
    if (!Number.isFinite(existingHeat) || existingHeat < 0 || existingHeat + heat > MAX_MEK_TURN_NUMBER) {
        return rejected('HEAT_LIMIT_EXCEEDED');
    }

    return Object.freeze({
        accepted: true,
        plan: Object.freeze({
            selections: Object.freeze(selections.map(selection => Object.freeze({ ...selection }))),
            heat,
            ammoSpends: Object.freeze([...ammoSpends.values()].sort((left, right) =>
                left.sourceId.localeCompare(right.sourceId))),
            ppcTransitions: Object.freeze(ppcTransitions.sort((left, right) =>
                left.capacitorId.localeCompare(right.capacitorId))),
            bombastTransitions: Object.freeze(bombastTransitions.sort((left, right) =>
                left.weaponId.localeCompare(right.weaponId))),
            prototypeHeat: Object.freeze(prototypeHeat.sort((left, right) =>
                left.weaponId.localeCompare(right.weaponId))),
        }),
    });
}

function isAcknowledgedChargedPpcSource(
    runtime: MekWeaponFireRuntimeViewV2,
    weaponId: ComponentId,
): boolean {
    const sourceId = `ppc-capacitor:${weaponId}`;
    return runtime.turnState().acknowledgedHeatSources.get(sourceId) === mekHeatSourceSignatureV2({
        id: sourceId,
        label: 'PPC Capacitor',
        value: PPC_CAPACITOR_HEAT_BONUS,
        replacedByFiringEntryId: weaponId,
    });
}

/** Applies a previously validated plan to one detached snapshot; no revision is assigned here. */
export function applyMekWeaponFirePlanV2(
    state: MekUnitRuntimeState,
    plan: MekWeaponFirePlanV2,
): MekUnitRuntimeState {
    const ammo = new Map<ComponentId, AmmoRuntimeState>(state.ammo);
    for (const spend of plan.ammoSpends) {
        const current = ammo.get(spend.sourceId);
        ammo.set(spend.sourceId, Object.freeze({
            shotsSpent: (current?.shotsSpent ?? 0) + spend.amount,
            ...(current?.munitionOverride === undefined
                ? {}
                : { munitionOverride: current.munitionOverride }),
        }));
    }

    const components = new Map<ComponentId, ComponentRuntimeState>(state.components);
    for (const transition of plan.ppcTransitions) {
        const current = components.get(transition.capacitorId);
        components.set(transition.capacitorId, Object.freeze({
            ...current,
            ppcCapacitor: Object.freeze({
                weaponId: transition.weaponId,
                firedThisTurn: true,
            }),
        }));
    }
    for (const transition of plan.bombastTransitions) {
        const current = components.get(transition.weaponId) ?? {};
        const { bombastLaser: _removed, ...remaining } = current;
        components.set(transition.weaponId, Object.freeze({
            ...remaining,
            bombastLaser: Object.freeze({ firedThisTurn: true as const }),
        }));
    }

    const acknowledgedHeatSources = new Map(state.turn.acknowledgedHeatSources);
    if (plan.heat > 0) acknowledgedHeatSources.delete('weapons');
    for (const transition of plan.ppcTransitions) {
        acknowledgedHeatSources.delete(`ppc-capacitor:${transition.weaponId}`);
    }
    const turn = canonicalizeMekTurnStateV2({
        ...state.turn,
        weaponsHeat: state.turn.weaponsHeat + plan.heat,
        acknowledgedHeatSources,
    });
    return {
        ...state,
        ammo: new ImmutableIndex(ammo),
        components: new ImmutableIndex(components),
        turn,
    };
}

function expandMekBayFireSelection(
    index: MekRuntimeIndex,
    runtime: MekWeaponFireRuntimeViewV2,
    source: MekWeaponFireSelectionV2,
):
    | { readonly accepted: true; readonly selections: readonly EffectiveMekWeaponFireSelectionV2[] }
    | { readonly accepted: false; readonly code: MekWeaponFirePlanRejectionCode } {
    const resolved = resolveComponentBayRuntime(index, runtime, source.weaponId);
    if (resolved.kind === 'unrelated') {
        return Object.freeze({
            accepted: true,
            selections: Object.freeze([Object.freeze({
                weaponId: source.weaponId,
                actionComponentId: source.weaponId,
                source,
            })]),
        });
    }
    if (resolved.kind === 'denied') {
        return rejected('UNSUPPORTED_INTERACTION');
    }
    const facts = resolved.facts;
    if (!facts.canFire) return rejected('UNAVAILABLE_WEAPON');
    if (facts.role === 'member') {
        return Object.freeze({
            accepted: true,
            selections: Object.freeze([Object.freeze({
                weaponId: source.weaponId,
                actionComponentId: source.weaponId,
                source,
            })]),
        });
    }
    if (facts.relation.kind !== 'machine-gun-array') {
        return rejected('UNSUPPORTED_INTERACTION');
    }
    return Object.freeze({
        accepted: true,
        selections: Object.freeze(facts.operationalMemberIds.map(weaponId => Object.freeze({
            weaponId,
            actionComponentId: source.weaponId,
            source,
        }))),
    });
}

function bombastTransition(
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekWeaponFireRuntimeViewV2,
    weaponId: ComponentId,
    weapon: WeaponEquipment,
): {
    readonly transition?: MekWeaponFireBombastTransitionV2;
    readonly heat: number;
} | null | false | 'unavailable' {
    if (!isBombastLaserEquipment(weapon)) return null;
    if (!isBombastLaserComponent(index, weaponId)) return false;
    const mode = runtime.componentMode(weaponId);
    const profile = bombastLaserProfile(ruleset, mode);
    if (profile === null) return false;
    if (ruleset === 'total-warfare') {
        return Object.freeze({ heat: profile.heat });
    }
    const lifecycle = runtime.componentBombastLaser(weaponId);
    if (lifecycle !== undefined && !validBombastLifecycle(lifecycle)) return false;
    if (lifecycle?.chargeState === BOMBAST_LASER_CHARGING_STATE) return 'unavailable';
    return Object.freeze({
        transition: Object.freeze({ weaponId }),
        heat: profile.heat,
    });
}

function validBombastLifecycle(state: BombastLaserRuntimeState): boolean {
    const charge = state.chargeState;
    const fired = state.firedThisTurn;
    return (charge === undefined || charge === 'charging' || charge === 'charged')
        && (fired === undefined || fired === true)
        && !(charge !== undefined && fired !== undefined)
        && !(charge === undefined && fired === undefined);
}

function selectedAmmoSpend(
    entity: MekEntity,
    index: MekRuntimeIndex,
    ruleset: CBTRuleset,
    runtime: MekWeaponFireRuntimeViewV2,
    weaponId: ComponentId,
    weapon: WeaponEquipment,
    selection: MekWeaponFireSelectionV2,
):
    | { readonly accepted: true; readonly spend?: MekWeaponFireAmmoSpendV2 }
    | { readonly accepted: false; readonly code: MekWeaponFirePlanRejectionCode } {
    const tracksAmmo = weapon.ammoType !== 'NA';
    if (!tracksAmmo) {
        return selection.ammoSourceId === undefined && selection.expectedMunitionKey === undefined
            ? Object.freeze({ accepted: true })
            : rejected('INVALID_AMMO_SOURCE');
    }
    if (typeof selection.ammoSourceId !== 'string'
        || typeof selection.expectedMunitionKey !== 'string'
        || !selection.expectedMunitionKey.trim()
        || selection.expectedMunitionKey.length > 512
        || selection.expectedMunitionKey.includes('\0')) {
        return rejected('INVALID_AMMO_SOURCE');
    }
    const sourceId = selection.ammoSourceId;
    const source = index.components.get(sourceId);
    const sourceEquipment = equipmentForComponent(index, sourceId);
    const intrinsicMagazine = mekIntrinsicMagazine(entity, index, sourceId, ruleset);
    if (source?.kind !== 'equipment'
        || (!(sourceEquipment instanceof AmmoEquipment) && intrinsicMagazine?.ownerComponentId !== weaponId)
        || runtime.componentStatus(sourceId, 'committed') !== 'available') {
        return rejected('INVALID_AMMO_SOURCE');
    }
    let loadout: ReturnType<MekWeaponFireRuntimeViewV2['ammoLoadout']>;
    try {
        loadout = runtime.ammoLoadout(sourceId);
    } catch {
        return rejected('INVALID_AMMO_SOURCE');
    }
    if (loadout.munitionKey !== selection.expectedMunitionKey) return rejected('MUNITION_CHANGED');
    const selected = mekAmmoLoadout(entity, index, sourceId, ruleset, loadout.munitionKey);
    if (!selected || !mekWeaponAmmoMatches(weapon, selected.equipment, runtime.componentMode(weaponId))) {
        return rejected('INCOMPATIBLE_AMMO');
    }
    if (intrinsicMagazine && sourceId !== weaponId) return rejected('INVALID_AMMO_SOURCE');
    return Object.freeze({
        accepted: true,
        spend: Object.freeze({
            sourceId,
            amount: rapidFireAutocannonShotCount(weapon, runtime.componentMode(weaponId)),
            munitionKey: loadout.munitionKey,
        }),
    });
}

/** One compatibility rule shared by fire planning and attacker selection. */
export function mekWeaponAmmoMatches(
    weapon: WeaponEquipment,
    ammo: AmmoEquipment,
    selectedMode: string | undefined,
): boolean {
    const special = matchesAmmoCompatibility(createAmmoCompatibilityMatch({
        weapon,
        ammo,
        selectedMode,
    }));
    if (special !== null) return special;
    return ammo.ammoType === weapon.ammoType
        && (weapon.rackSize <= 0 || ammo.rackSize === weapon.rackSize);
}

function rejected(code: MekWeaponFirePlanRejectionCode): Extract<MekWeaponFirePlanResultV2, { accepted: false }> {
    return Object.freeze({ accepted: false, code });
}
