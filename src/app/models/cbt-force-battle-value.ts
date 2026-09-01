// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, WeaponEquipment, ammoMatchesWeapon } from './equipment.model';
import type { EquipmentRegistry } from './equipment-lookup';
import { asComponentId, type ComponentId } from './entity/entity-identifiers';
import {
    C3Role,
    C3TaxCalculator,
    projectNonMekC3Components,
    type C3Component,
    type C3UnitView,
} from './c3-network.model';
import { projectEncounterNetworksToC3Editor } from './c3-network-presentation';
import { isC3EmergencyMasterOperatingTurnsFried } from './c3-emergency-master.model';
import { gameRulesFor, type TagBattleValueFacts } from './rules/game-rules';
import type { EncounterNetwork } from './runtime/encounter-runtime';
import { isCBTNonMekUnit, isCBTMekUnit, type CBTUnit } from './runtime/cbt-unit';
import type { ScenarioRules } from './runtime/unit-state-initializer';
import { scenarioRuleset } from './runtime/unit-state-initializer';
import { adjustEntityBattleValueForSkills } from './entity/utils/battle-value/skill-facts';

export interface CBTForceBattleValueUnit {
    readonly unit: CBTUnit;
    readonly baseBattleValue: number | null;
}

export interface CBTForceBattleValueBreakdown {
    readonly base: number;
    readonly tag: number;
    readonly c3: number;
    readonly skills: number;
    readonly adjusted: number;
}

export interface CBTForceBattleValueInput {
    readonly units: readonly CBTForceBattleValueUnit[];
    readonly scenario: ScenarioRules;
    readonly networks: readonly EncounterNetwork[];
    readonly isC3EndpointIntact: (
        instanceId: string,
        componentId: ComponentId,
    ) => boolean;
}

/** Current entity + sparse-runtime BV. No force-wide state participates. */
export function currentUnitBaseBattleValue(unit: CBTUnit): number | null {
    return unit.captureRuntime().query.currentBaseBattleValue();
}

/** Immutable entity BV before runtime damage, TAG, C3, or skills. */
export function pristineUnitBattleValue(unit: CBTUnit): number {
    return unit.getUnit().battleValue();
}

/**
 * Produces every force-level BV adjustment in one pass. Base BV is supplied by
 * each member's own computed signal, so an unrelated unit's base calculator is
 * never invalidated by this cross-unit projection.
 */
export function calculateCBTForceBattleValues(
    input: CBTForceBattleValueInput,
): ReadonlyMap<string, CBTForceBattleValueBreakdown> {
    const inventories = input.units.map(row => ({
        ...row,
        inventory: tagBattleValueInventory(row.unit),
    }));
    const ruleset = scenarioRuleset(input.scenario);
    const rules = gameRulesFor(ruleset);
    const homingArtilleryLauncherCount = inventories.reduce((total, { inventory }) =>
        total + inventory.launchers.filter(launcher =>
            launcher.hasWeaponTrait('artillery')
            && inventory.ammunition.some(ammo =>
                ammo.hasMunitionType('M_HOMING') && ammoMatchesWeapon(launcher, ammo))).length, 0);
    const guidedAmmoBv = inventories.reduce((total, { inventory }) =>
        total + inventory.ammunition.reduce((ammoTotal, ammo) => {
            if (!(ammo.hasMunitionType('M_SEMIGUIDED') || ammo.hasMunitionType('M_HOMING'))
                || !inventory.launchers.some(launcher => ammoMatchesWeapon(launcher, ammo))) {
                return ammoTotal;
            }
            const bv = rules.getAmmoBV(ammo, inventory.registry);
            return ammoTotal + (typeof bv === 'number' ? bv : 0);
        }, 0), 0);
    const tagValues = new Map(inventories.map(({ unit, inventory }) => {
        const facts: TagBattleValueFacts = {
            operationalTagCount: inventory.operationalTagCount,
            homingArtilleryLauncherCount,
            guidedAmmoBv,
        };
        return [unit.instanceId, rules.calculateTagBVCost(facts)] as const;
    }));

    const views = input.units.map(row => battleValueC3View(
        row,
        tagValues.get(row.unit.instanceId) ?? 0,
        input.isC3EndpointIntact,
    ));
    const viewsById = new Map(views.map(view => [view.instanceId, view] as const));
    const editorNetworks = projectEncounterNetworksToC3Editor(input.networks, views);
    const tax = new C3TaxCalculator(
        editorNetworks,
        views,
        (unit, component) => unit.isC3EndpointOperational(component.index, component),
    );

    return new Map(input.units.flatMap(row => {
        const base = row.baseBattleValue;
        if (base === null) return [];
        const view = viewsById.get(row.unit.instanceId)!;
        const tag = tagValues.get(row.unit.instanceId) ?? 0;
        const c3 = ruleset === 'total-warfare' ? tax.totalWar(view) : tax.core2026(view);
        const preSkill = base + tag + c3;
        const primary = row.unit.getCrewAssignment().positions[0];
        const adjusted = primary === undefined
            ? preSkill
            : adjustEntityBattleValueForSkills(
                row.unit.getUnit(),
                preSkill,
                primary.gunnery,
                primary.piloting,
            );
        return [[row.unit.instanceId, Object.freeze({
            base,
            tag,
            c3,
            skills: adjusted - preSkill,
            adjusted,
        })] as const];
    }));
}

interface ReadyTagBattleValueInventory {
    readonly operationalTagCount: number;
    readonly launchers: readonly WeaponEquipment[];
    readonly ammunition: readonly AmmoEquipment[];
    readonly registry: EquipmentRegistry;
}

function tagBattleValueInventory(unit: CBTUnit): ReadyTagBattleValueInventory {
    const mounts = unit.getUnit().equipment();
    const operational = new Set<string>();
    const ammunition: AmmoEquipment[] = [];
    const query = unit.captureRuntime().query;
    for (const mount of mounts) {
        const componentId = asComponentId(mount.mountId);
        if (query.componentStatus(componentId) !== 'available') continue;
        operational.add(mount.mountId);
        if (mount.equipment instanceof AmmoEquipment && query.remainingAmmo(componentId) > 0) {
            const ammo = query.ammoEquipment(componentId);
            if (ammo) ammunition.push(ammo);
        }
    }

    const operationalMounts = mounts.filter(mount => operational.has(mount.mountId));
    return Object.freeze({
        operationalTagCount: operationalMounts.filter(mount =>
            mount.equipment?.hasWeaponTrait('tag')).length,
        launchers: Object.freeze(operationalMounts.flatMap(mount =>
            mount.equipment instanceof WeaponEquipment ? [mount.equipment] : [])),
        ammunition: Object.freeze(ammunition),
        registry: unit.getUnit().getEquipmentRegistry(),
    });
}

interface BattleValueC3View extends C3UnitView {
    readonly instanceId: string;
    readonly c3Components: readonly C3Component[];
    getBaseBv(): number;
    tagBV(): number;
}

function battleValueC3View(
    row: CBTForceBattleValueUnit,
    tag: number,
    isIntact: CBTForceBattleValueInput['isC3EndpointIntact'],
): BattleValueC3View {
    const { unit } = row;
    const entity = unit.getUnit();
    const structural = isCBTMekUnit(unit)
        ? mekC3Components(unit)
        : isCBTNonMekUnit(unit)
            ? projectNonMekC3Components(unit.getIndex())
            : Object.freeze([]);
    return Object.freeze({
        id: String(unit.instanceId),
        instanceId: unit.instanceId,
        c3Components: structural,
        getC3Specials: () => Object.freeze([]),
        getC3Presentation: () => Object.freeze({
            chassis: entity.chassis(),
            model: entity.model(),
            icon: '',
            tons: entity.tonnage(),
            walk: entity.walkMP(),
        }),
        alias: () => undefined,
        c3Position: () => null,
        isC3Jammed: () => false,
        isC3EndpointOperational: (_index: number, component: C3Component) =>
            component.componentId !== undefined
            && isIntact(unit.instanceId, component.componentId),
        getBaseBv: () => row.baseBattleValue ?? 0,
        tagBV: () => tag,
    });
}

function mekC3Components(unit: CBTUnit): readonly C3Component[] {
    if (!isCBTMekUnit(unit)) return Object.freeze([]);
    const query = unit.getInstance().query();
    const projected = query.mekC3Endpoints();
    if (projected.kind !== 'supported') return Object.freeze([]);
    return Object.freeze(projected.endpoints.map((endpoint, index) => {
        const emergencyState = endpoint.emergency
            ? query.componentC3EmergencyMaster(endpoint.componentId)
            : undefined;
        return Object.freeze({
            componentId: endpoint.componentId,
            networkType: endpoint.family,
            role: endpoint.role === 'master'
                ? C3Role.MASTER
                : endpoint.role === 'peer' ? C3Role.PEER : C3Role.SLAVE,
            boosted: endpoint.boosted,
            emergency: endpoint.emergency,
            emergencyFried: isC3EmergencyMasterOperatingTurnsFried(
                emergencyState?.operatingTurns ?? 0,
            ),
            index,
        });
    }));
}
