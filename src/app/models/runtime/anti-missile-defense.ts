// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import type { ComponentId } from '../entity/entity-identifiers';
import { ammoMatchesWeapon, AmmoEquipment, WeaponEquipment } from '../equipment.model';
import type { TnAttackDirection } from '../target-number-calculator.model';
import type { AttackWeaponReport } from '../../services/game-events.service';
import { type CBTUnitRuntimeState, type CBTUnitRuntimeIndex, type CBTUnitQueryPort } from './cbt-unit-runtime';
import { withAmmoShotsSpent } from './component-state-change';

export interface MissileDefenseSystem {
    readonly id: ComponentId;
    readonly label: string;
    readonly heat: number;
    readonly remaining: number;
    readonly bin?: ComponentId;
}

/** Which installed systems can engage this direction (TW pp. 129–130, Core p. 206). */
export function missileDefenseSystems(entity: BaseEntity, index: CBTUnitRuntimeIndex, state: CBTUnitRuntimeState,
    query: CBTUnitQueryPort, rules: CBTRuleset, arc: TnAttackDirection, reservedAmmo?: ReadonlyMap<ComponentId, number>): MissileDefenseSystem[] {
    if (query.destroyed() || query.hasCondition('shutdown') || ![...index.crewPositions.keys()].some(id =>
        query.crewState(id).effectiveState() === 'healthy')) return [];
    return [...index.components.values()].flatMap(component => {
        const mount = component.mount;
        const system = mount?.equipment;
        if (!mount || !(system instanceof WeaponEquipment) || !system.hasFlag('F_AMS') || system.ammoType === 'APDS'
            || query.componentStatus(component.id, 'committed') !== 'available' || query.componentJammed(component.id)
            || query.componentMode(component.id)?.toLowerCase() === 'off') return [];
        const loc = mount.location.toUpperCase();
        // The defender confirms actual turret bearing or torso twist on the map when selecting the mount.
        const movable = mount.turretMounted || !!mount.turretType || loc.includes('TURRET');
        if (!movable) {
            const arcs: readonly string[] = mount.rearMounted || loc === 'REAR' || loc === 'AFT' ? ['rear', 'rear-left', 'rear-right']
                : loc === 'LA' || loc === 'LW' || loc === 'LEFT ARM' || loc === 'LEFT WING' ? ['front', 'front-left', 'left']
                : loc === 'RA' || loc === 'RW' || loc === 'RIGHT ARM' || loc === 'RIGHT WING' ? ['front', 'front-right', 'right']
                : loc === 'LEFT' || loc === 'LS' ? ['left', 'front-left', 'rear-left']
                : loc === 'RIGHT' || loc === 'RS' ? ['right', 'front-right', 'rear-right'] : ['front', 'front-left', 'front-right'];
            if (!arcs.includes(arc)) return [];
        }
        const count = state.turn.amsEngagements?.filter(id => id === component.id).length ?? 0;
        const remaining = (rules === 'core-2026' && entity.entityType === 'Mek' ? 2 : 1) - count;
        if (remaining <= 0) return [];
        const laser = system.hasFlag('F_ENERGY');
        const bin = laser ? undefined : [...index.components.keys()].find(id => index.components.get(id)?.mount?.equipment instanceof AmmoEquipment && query.componentStatus(id) === 'available'
            && query.remainingAmmo(id) > (reservedAmmo?.get(id) ?? 0) && ammoMatchesWeapon(system, query.ammoEquipment(id)));
        if (!laser && !bin) return [];
        return [{ id: component.id, label: system.shortName + ' (' + mount.location + ')', heat: system.heat, remaining, bin }];
    });
}

/** Consumes a selected defense and records its use and heat together. */
export function fireMissileDefense<S extends CBTUnitRuntimeState>(state: S, system: MissileDefenseSystem, tracksHeat: boolean): S {
    const spent = system.bin ? withAmmoShotsSpent(state, [[system.bin, 1]]) : state;
    const amsEngagements = Object.freeze([...spent.turn.amsEngagements ?? [], system.id].sort());
    return { ...spent, turn: { ...spent.turn, amsEngagements,
        weaponsHeat: spent.turn.weaponsHeat + (tracksHeat ? system.heat : 0), phaseStateChanged: true } };
}

export function interceptedReport(weapon: AttackWeaponReport): AttackWeaponReport {
    const result = weapon.ams;
    if (!result) return weapon;
    return { ...weapon, heat: result.heat || undefined,
        ...(weapon.cluster ? { cluster: { ...weapon.cluster, hits: result.hits } } : {}),
        groups: result.damage.map((damage, i) => ({ ...weapon.groups[i], damage })) };
}
