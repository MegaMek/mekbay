// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { compareText } from '../../utils/string.util';
import type { BaseEntity } from '../entity/base-entity';
import {
    isAeroEntity,
    isInfantryFamilyEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import { asComponentId, asLocationId, type ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedEquipment, EntityWeaponHitModifier } from '../entity/types';
import { AmmoEquipment, WeaponEquipment } from '../equipment.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { isWeaponEnhancementEquipment } from '../entity/utils/equipment-link-rules';
import { isTargetingComputerEquipment } from '../entity/utils/targeting-computer';
import type { CrewAssignment } from './crew-assignment';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import {
    nonMekComponentModes,
    effectiveNonMekComponentMode,
    type NonMekUnitRuntimeState,
} from './non-mek-unit-instance';
import {
    entityAmmoLoadout,
    entityAmmoLoadouts,
    weaponAcceptsAmmo,
    type AmmoLoadout,
} from './mek-ammo';
import {
    projectEquipmentTargets,
    projectWeaponTargetDisabledReasons,
    projectEquipmentPanelHit,
    projectEquipmentPanelWeaponDamage,
    equipmentPanelWeaponTypes,
    selectedAmmoEquipment,
    type EquipmentPanelTarget,
    EquipmentPanelAmmoLoadout,
    EquipmentPanelAmmoSource,
    EquipmentPanelComponent,
    EquipmentPanelSnapshot,
    type MekPhysicalAttackRow,
} from './equipment-panel';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import {
    gameRulesFor,
    type ComponentToHitTargetingComputerFacts,
    type ComponentToHitSubject,
    type ToHitModifierBreakdownEntry,
} from '../rules/game-rules';
import {
    projectVehicleRuntimeRules,
    type VehicleRuntimeRulesProjection,
} from '../rules/vehicle-runtime-rules';
import {
    projectProtoMekRuntimeRules,
    type ProtoMekRuntimeRulesProjection,
} from '../rules/protomek-runtime-rules';
import {
    projectInfantryRuntimeRules,
    type InfantryRuntimeRulesProjection,
} from '../rules/infantry-runtime-rules';
import {
    projectAeroRuntimeRules,
    type AeroRuntimeRulesProjection,
} from '../rules/aero-runtime-rules';
import { attackerActionSelection } from './attacker-targeting-state';
import {
    projectNonMekComponentStatuses,
    type NonMekComponentStatuses,
} from './non-mek-component-status';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import {
    AEROSPACE_RANGE_BRACKETS,
    aerospaceAttackValues,
    aerospaceRangeLimits,
    effectiveAerospaceMaximumBracket,
} from '../../utils/aerospace-range.util';
import { bombastLaserEquipmentProfile } from '../bombast-laser-mode.model';
import { isLaserInsulatorEquipment } from '../laser-insulator.model';
import { prototypeLaserMaximumExtraHeat } from '../prototype-laser-heat.model';
import { isMobileHpgEquipment } from '../aerospace-support-equipment.model';
import { mobileHpgBlocksWeaponAttacks } from './component-mobile-hpg';
import { nonMekWeaponAttackGroups } from './non-mek-weapon-attack-groups';

interface NonMekAmmoSourceCandidate {
    readonly source: EquipmentPanelAmmoSource;
    readonly loadouts: readonly AmmoLoadout[];
}

/**
 * Equipment-dialog projection for non-Mek entities. The entity supplies the
 * installed definitions; the sparse runtime supplies only mutable state.
 */
export function projectNonMekEquipmentPanel(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    ruleset: CBTRuleset,
    state: NonMekUnitRuntimeState,
    crew: CrewAssignment,
    registry: TargetRegistrySnapshot,
    forcedWithdrawal = true,
): EquipmentPanelSnapshot {
    if (entity.entityType === 'Mek') throw new Error('Meks require the Mek equipment projection');
    const targets = projectEquipmentTargets(state.attackerTargeting, registry);
    const vehicleRules = isVehicleEntity(entity)
        ? projectVehicleRuntimeRules(entity, index, state, ruleset)
        : null;
    const protoMekRules = isProtoMekEntity(entity)
        ? projectProtoMekRuntimeRules(entity, index, state, ruleset, forcedWithdrawal)
        : null;
    const infantryRules = isInfantryFamilyEntity(entity)
        ? projectInfantryRuntimeRules(entity, index, state)
        : null;
    const aeroRules = isAeroEntity(entity)
        ? projectAeroRuntimeRules(entity, index, state, ruleset)
        : null;
    const entityStatuses = projectNonMekComponentStatuses(index, state);
    const ammoSourceCandidates = projectAmmoSourceCandidates(
        entity,
        index,
        ruleset,
        state,
        vehicleRules,
        entityStatuses,
    );
    const targetingComputer = installedTargetingComputer(index, vehicleRules, entityStatuses);
    const hpgBlocksWeaponFire = mobileHpgBlocksWeaponAttacks(
        [...index.components.values()].flatMap(component => {
            const equipment = component.mount.equipment;
            if (!equipment || !isMobileHpgEquipment(equipment)) return [];
            return [Object.freeze({
                componentId: component.id,
                equipment,
                mode: state.components.get(component.id)?.mode,
                operational: !(vehicleRules?.destroyed
                    ?? protoMekRules?.destroyed
                    ?? infantryRules?.destroyed
                    ?? aeroRules?.destroyed
                    ?? state.explicitlyDestroyed)
                    && !state.conditions.has('shutdown')
                    && (vehicleRules?.componentStatuses.get(component.id)
                        ?? entityStatuses.committed.get(component.id)
                        ?? 'available') === 'available',
            })];
        }),
    );
    const projectedComponents = Object.freeze([...index.components.values()]
        .map(component => projectComponent(
            entity,
            index,
            ruleset,
            state,
            component.id,
            targets,
            vehicleRules,
            protoMekRules,
            infantryRules,
            aeroRules,
            entityStatuses,
            targetingComputer,
            hpgBlocksWeaponFire,
            ammoSourceCandidates,
        )));
    const components = projectWeaponAttackComponents(
        entity,
        index,
        state,
        projectedComponents,
    );
    const firstCrew = crew.positions[0];
    return Object.freeze({
        entityUuid: entity.uuid(),
        ruleset,
        stateRevision: state.stateRevision,
        targetRegistryRevision: registry.revision,
        displayName: entity.displayName(),
        unitType: entity.unitType(),
        tracksHeat: entity.tracksHeat(),
        heat: Object.freeze({
            current: aeroRules?.heat.current ?? 0,
            pending: aeroRules?.heat.pending ?? null,
            sinksOff: aeroRules?.heat.heatsinksOff ?? 0,
        }),
        crew: Object.freeze({
            gunnery: firstCrew?.gunnery ?? 4,
            piloting: firstCrew?.piloting ?? 5,
        }),
        components,
        physicalAttacks: vehicleRules !== null
            ? Object.freeze([projectVehicleCharge(entity, state, vehicleRules, ruleset)])
            : protoMekRules !== null
                ? Object.freeze([projectProtoMekFrenzy(entity, state, protoMekRules, ruleset)])
                : Object.freeze([]),
        ...(state.equipmentRowOrder === undefined
            ? {}
            : { equipmentRowOrder: state.equipmentRowOrder }),
        physicalAttackBlockers: Object.freeze([]),
        targets,
    });
}

function projectComponent(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    ruleset: CBTRuleset,
    state: NonMekUnitRuntimeState,
    componentId: ComponentId,
    targets: readonly EquipmentPanelTarget[],
    vehicleRules: VehicleRuntimeRulesProjection | null,
    protoMekRules: ProtoMekRuntimeRulesProjection | null,
    infantryRules: InfantryRuntimeRulesProjection | null,
    aeroRules: AeroRuntimeRulesProjection | null,
    entityStatuses: NonMekComponentStatuses,
    targetingComputer: ComponentToHitTargetingComputerFacts | null,
    hpgBlocksWeaponFire: boolean,
    ammoSourceCandidates: readonly NonMekAmmoSourceCandidate[],
): EquipmentPanelComponent {
    const component = index.components.get(componentId);
    if (!component) throw new Error(`Unknown non-Mek component ${componentId}`);
    const mount = component.mount;
    const equipment = mount.equipment;
    const componentState = state.components.get(componentId);
    const status = vehicleRules?.componentStatuses.get(componentId)
        ?? entityStatuses.committed.get(componentId)
        ?? 'available';
    const previewStatus = vehicleRules?.previewComponentStatuses.get(componentId)
        ?? entityStatuses.preview.get(componentId)
        ?? status;
    const modeDefinition = nonMekComponentModes(entity, equipment, ruleset);
    const mode = effectiveNonMekComponentMode(entity, index, state, ruleset, componentId);
    const locations = mount.getOccupiedLocations().map(code => {
        const location = [...index.locations.values()].find(candidate => candidate.code === code);
        return Object.freeze({
            locationId: location?.id ?? asLocationId(`location:${code}`),
            code: entity.componentLocationLabel(code),
            status: previewStatus,
            exposed: location?.armorFaceIds.some(faceId => {
                const face = index.armorFaces.get(faceId);
                if (!face || face.maximumPoints === 0) return false;
                const committed = state.locations.get(location.id)?.armorDamage
                    .find(row => row.faceId === faceId)?.damage ?? 0;
                const pending = state.pendingCombat.armorDamage.get(faceId) ?? 0;
                return committed + pending >= face.maximumPoints;
            }) ?? false,
        });
    });
    const loadouts = entityAmmoLoadouts(entity, mount, ruleset);
    const ammo = loadouts.length === 0
        ? undefined
        : projectAmmo(entity, mount, ruleset, state, componentId, loadouts);
    const targeting = state.attackerTargeting.components.get(componentId);
    const ammoSources = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? compatibleAmmoSources(
            ammoSourceCandidates,
            equipment,
            mode,
        )
        : Object.freeze([]);
    const selectedAmmo = selectedAmmoEquipment(ammoSources, targeting?.ammo);
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
    const aerospace = equipment instanceof WeaponEquipment
        && !mount.isPhysicalWeapon()
        && entity.unitType() === 'Aero'
        ? projectAerospaceWeapon(equipment, selectedAmmo, ruleset, mode)
        : undefined;
    const stateModifiers = Object.freeze([
        ...(aeroRules?.modifiers.ranged ?? []),
        ...(vehicleRules === null ? [] : [
            ...vehicleRules.modifiers.ranged,
            ...(vehicleRules.stabilizerAffectedComponentIds.has(componentId)
                ? [Object.freeze({
                    label: 'Stabilizer Hit',
                    modifier: vehicleRules.attackMovementModifier,
                    weakened: true,
                })]
                : []),
        ]),
    ] satisfies readonly ToHitModifierBreakdownEntry[]);
    const rules = gameRulesFor(ruleset);
    const hit = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? projectEquipmentPanelHit(rules, {
            subject: installedWeaponToHitSubject(
                componentId,
                mount.getOccupiedLocations().map(location => entity.componentLocationLabel(location)),
                equipment,
                selectedAmmo,
                targetingComputer,
            ),
            stateModifiers,
        })
        : null;
    const bombast = bombastLaserEquipmentProfile(equipment, ruleset, mode);
    const effectiveDamage = equipment instanceof WeaponEquipment
        ? bombast?.damage ?? equipment.damage
        : 0;
    const effectiveWeaponTypes = equipment instanceof WeaponEquipment
        ? Object.freeze(equipmentPanelWeaponTypes(equipment, selectedAmmo))
        : Object.freeze([]);
    const damage = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? projectEquipmentPanelWeaponDamage(
            entity.getEquipmentRegistry(),
            componentId,
            equipment,
            selectedAmmo,
            effectiveDamage,
            effectiveWeaponTypes,
        )
        : null;
    const linkedEnhancement = entity.getLinkingMount(mount);
    const linkedEnhancementId = linkedEnhancement === undefined
        ? undefined
        : asComponentId(linkedEnhancement.mountId);
    const linkedEnhancementStatus = linkedEnhancementId === undefined
        ? 'available'
        : vehicleRules?.componentStatuses.get(linkedEnhancementId)
            ?? entityStatuses.committed.get(linkedEnhancementId)
            ?? 'available';
    const linkedEnhancementEquipment = linkedEnhancement?.equipment;
    const modifiers = linkedEnhancementEquipment !== undefined
        && isWeaponEnhancementEquipment(linkedEnhancementEquipment)
        ? Object.freeze([Object.freeze({
            name: linkedEnhancementEquipment.shortName || linkedEnhancementEquipment.name,
            ...(linkedEnhancementStatus === 'available'
                ? {}
                : { status: linkedEnhancementStatus as 'destroyed' | 'disabled' }),
        })])
        : Object.freeze([]);
    const prototypeMaximumHeat = equipment instanceof WeaponEquipment
        ? prototypeLaserMaximumExtraHeat(equipment.internalName)
        : 0;
    const displayedHeat = equipment instanceof WeaponEquipment
        ? equipment.heat + (entity.unitType() === 'Aero' ? prototypeMaximumHeat : 0)
        : 0;
    const weapon = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? Object.freeze({
            heat: displayedHeat,
            firingHeat: displayedHeat,
            ...(prototypeMaximumHeat > 0 && entity.unitType() !== 'Aero'
                ? { heatSuffix: '*' as const }
                : {}),
            selectable: !(vehicleRules?.destroyed
                ?? protoMekRules?.destroyed
                ?? infantryRules?.destroyed
                ?? aeroRules?.destroyed
                ?? state.explicitlyDestroyed)
                && status === 'available'
                && componentState?.jammed !== true
                && vehicleRules?.fireBlockedComponentIds.has(componentId) !== true
                && infantryRules?.fireBlockedComponentIds.has(componentId) !== true
                && !hpgBlocksWeaponFire,
            damage: effectiveDamage,
            damageText: damage!.default,
            damageTextByRange: damage!.byRange,
            hit: hit!,
            toHitModifier: hit!.default.profile.length === 1
                ? hit!.default.profile[0]!
                : Object.freeze([...hit!.default.profile]),
            hitModifierBreakdown: Object.freeze([...hit!.default.modifierBreakdown]),
            ranges: Object.freeze([...(ammoProfile?.ranges ?? equipment.ranges)]),
            minimumRange: ammoProfile?.minimumRange ?? equipment.minimumRange,
            ...(aerospace === undefined ? {} : { aerospace }),
            ...(targeting?.selection === undefined ? {} : { selection: targeting.selection }),
            ...(targeting?.ammo === undefined ? {} : { ammoSelection: targeting.ammo }),
            ammoSources,
            underwater: false,
            attackerSubmerged: false,
            effectiveWeaponTypes,
            ...(entity.unitType() === 'Infantry' && entity.unitSubtype() !== 'Battle Armor'
                ? { attackerIsConventionalInfantry: true as const }
                : {}),
            disabledTargetReasons: projectWeaponTargetDisabledReasons(
                equipment,
                selectedAmmo,
                ruleset,
                targets,
                false,
            ),
        })
        : undefined;
    return Object.freeze({
        componentId,
        label: mount.displayName(),
        ...(equipment === undefined ? {} : { equipment }),
        locations: Object.freeze(locations),
        status,
        previewStatus,
        modes: modeDefinition.modes,
        ...(modeDefinition.defaultMode === undefined ? {} : { defaultMode: modeDefinition.defaultMode }),
        ...(mode === undefined ? {} : { mode }),
        jammed: componentState?.jammed === true,
        ...(isLaserInsulatorEquipment(linkedEnhancement?.equipment)
            ? { heatWeakened: linkedEnhancementStatus !== 'available' }
            : {}),
        ...(modifiers.length === 0 ? {} : { modifiers }),
        ...(weapon === undefined ? {} : { weapon }),
        ...(ammo === undefined ? {} : { ammo }),
    });
}

function projectAerospaceWeapon(
    equipment: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    ruleset: CBTRuleset,
    mode: string | undefined,
): NonNullable<EquipmentPanelComponent['weapon']>['aerospace'] {
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
    const maximumBracket = effectiveAerospaceMaximumBracket(equipment, ammoProfile);
    const baseValues = aerospaceAttackValues(equipment, ammoProfile);
    const bombast = ruleset === 'total-warfare'
        ? bombastLaserEquipmentProfile(equipment, ruleset, mode)
        : null;
    const attackValues = bombast === null
        ? baseValues
        : baseValues.map(value => value > 0 ? bombast.damage : 0) as [number, number, number, number];
    return Object.freeze({
        attackValues: Object.freeze([...attackValues]) as readonly [number, number, number, number],
        rangeLimits: aerospaceRangeLimits(equipment),
        maximumBracket,
        capital: equipment.capital,
    });
}

function projectWeaponAttackComponents(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    components: readonly EquipmentPanelComponent[],
): readonly EquipmentPanelComponent[] {
    const rowsById = new Map(components.map(row => [row.componentId, row] as const));
    const bayGroups = nonMekWeaponAttackGroups(entity, index, state)
        .filter(group => group.kind === 'weapon-bay');
    if (bayGroups.length === 0) return components;
    const groupByMember = new Map<ComponentId, typeof bayGroups[number]>();
    bayGroups.forEach(group => group.memberIds.forEach(componentId =>
        groupByMember.set(componentId, group)));

    const result: EquipmentPanelComponent[] = [];
    for (const row of components) {
        const group = groupByMember.get(row.componentId);
        if (!group) {
            result.push(row);
            continue;
        }
        if (row.componentId !== group.componentId) continue;
        const members = group.memberIds.flatMap(componentId => {
            const member = rowsById.get(componentId);
            return member?.weapon === undefined ? [] : [member];
        });
        if (members.length > 0) result.push(projectWeaponBayComponent(group, members));
    }
    return Object.freeze(result);
}

function projectWeaponBayComponent(
    group: ReturnType<typeof nonMekWeaponAttackGroups>[number],
    members: readonly EquipmentPanelComponent[],
): EquipmentPanelComponent {
    const representative = members.find(member => member.weapon?.selectable === true) ?? members[0];
    const representativeWeapon = representative.weapon!;
    const operational = members.filter(member => member.status === 'available' && !member.jammed);
    const operationalWeapons = operational.map(member => member.weapon!);
    const attackValues = AEROSPACE_RANGE_BRACKETS.map((_, index) => operationalWeapons.reduce(
        (sum, weapon) => sum + (weapon.aerospace?.attackValues[index] ?? 0),
        0,
    )) as [number, number, number, number];
    const aerospace = representativeWeapon.aerospace === undefined
        ? undefined
        : Object.freeze({
            attackValues: Object.freeze([...attackValues]) as readonly [number, number, number, number],
            rangeLimits: representativeWeapon.aerospace.rangeLimits,
            maximumBracket: [...AEROSPACE_RANGE_BRACKETS].reverse()
                .find(range => attackValues[AEROSPACE_RANGE_BRACKETS.indexOf(range)] > 0)
                ?? representativeWeapon.aerospace.maximumBracket,
            capital: representativeWeapon.aerospace.capital,
        });
    const damageByRange = Object.freeze(Object.fromEntries(AEROSPACE_RANGE_BRACKETS.map(
        (range, index) => [range, attackValues[index] > 0 ? String(attackValues[index]) : '—'],
    )) as NonNullable<EquipmentPanelComponent['weapon']>['damageTextByRange']);
    const selection = uniformValue(operational.map(member => member.weapon?.selection));
    const ammoSelection = uniformValue(operational.map(member => member.weapon?.ammoSelection));
    const ammoSources = mergeAmmoSources(members.flatMap(member => member.weapon?.ammoSources ?? []));
    const effectiveWeaponTypes = Object.freeze([...new Set(members.flatMap(
        member => member.weapon?.effectiveWeaponTypes ?? [],
    ))]);
    const locations = new Map(members.flatMap(member => member.locations)
        .map(location => [location.locationId, location] as const));
    const firingHeat = operationalWeapons.reduce((sum, weapon) => sum + weapon.firingHeat, 0);
    const damage = attackValues.find(value => value > 0)
        ?? operationalWeapons.reduce((sum, weapon) =>
            sum + (typeof weapon.damage === 'number' ? weapon.damage : 0), 0);
    const weapon = Object.freeze({
        ...representativeWeapon,
        heat: firingHeat,
        firingHeat,
        selectable: operationalWeapons.some(candidate => candidate.selectable),
        damage,
        damageText: AEROSPACE_RANGE_BRACKETS.map((range, index) =>
            `${range[0].toUpperCase()}:${attackValues[index] > 0 ? attackValues[index] : '—'}`).join(' '),
        damageTextByRange: damageByRange,
        ...(aerospace === undefined ? {} : { aerospace }),
        ...(selection === undefined ? { selection: undefined } : { selection }),
        ...(ammoSelection === undefined ? { ammoSelection: undefined } : { ammoSelection }),
        ammoSources,
        effectiveWeaponTypes,
        disabledTargetReasons: commonDisabledTargetReasons(members),
    });
    const source = group.source === 'synthetic-bay'
        ? 'synthetic-bay' as const
        : 'authored-bay' as const;
    return Object.freeze({
        componentId: group.componentId,
        label: weaponBayLabel(group.label, members),
        ...(representative.equipment === undefined ? {} : { equipment: representative.equipment }),
        locations: Object.freeze([...locations.values()]),
        status: aggregateStatus(members.map(member => member.status)),
        previewStatus: aggregateStatus(members.map(member => member.previewStatus)),
        modes: Object.freeze([]),
        ...(representative.mode === undefined ? {} : { mode: representative.mode }),
        jammed: members.every(member => member.jammed),
        ...(members.some(member => member.heatWeakened === true) ? { heatWeakened: true } : {}),
        weapon,
        attack: Object.freeze({
            kind: 'weapon-bay',
            source,
            members: Object.freeze(members.map(member => Object.freeze({
                componentId: member.componentId,
                selectable: member.weapon?.selectable === true,
                ...(member.weapon?.selection === undefined
                    ? {}
                    : { selection: member.weapon.selection }),
                ...(member.weapon?.ammoSelection === undefined
                    ? {}
                    : { ammoSelection: member.weapon.ammoSelection }),
                ammoSources: member.weapon?.ammoSources ?? Object.freeze([]),
            }))),
        }),
    });
}

function weaponBayLabel(label: string, members: readonly EquipmentPanelComponent[]): string {
    const counts = new Map<string, number>();
    members.forEach(member => counts.set(member.label, (counts.get(member.label) ?? 0) + 1));
    const composition = [...counts].map(([name, count]) => `${count} ${name}`).join(', ');
    return `${label}: ${composition}`;
}

function aggregateStatus(
    statuses: readonly EquipmentPanelComponent['status'][],
): EquipmentPanelComponent['status'] {
    if (statuses.includes('available')) return 'available';
    if (statuses.includes('disabled')) return 'disabled';
    return statuses[0] ?? 'available';
}

function mergeAmmoSources(
    sources: readonly EquipmentPanelAmmoSource[],
): readonly EquipmentPanelAmmoSource[] {
    const merged = new Map<ComponentId, EquipmentPanelAmmoSource>();
    for (const source of sources) {
        const existing = merged.get(source.componentId);
        if (!existing) {
            merged.set(source.componentId, source);
            continue;
        }
        const loadouts = new Map([...existing.loadouts, ...source.loadouts]
            .map(loadout => [loadout.munitionKey, loadout] as const));
        merged.set(source.componentId, Object.freeze({
            ...existing,
            loadouts: Object.freeze([...loadouts.values()]),
        }));
    }
    return Object.freeze([...merged.values()].sort((left, right) =>
        compareText(left.componentId, right.componentId)));
}

function commonDisabledTargetReasons(
    members: readonly EquipmentPanelComponent[],
): Readonly<Record<string, string>> {
    const reasons = members.map(member => member.weapon?.disabledTargetReasons ?? {});
    const first = reasons[0] ?? {};
    return Object.freeze(Object.fromEntries(Object.entries(first).filter(([targetId, reason]) =>
        reasons.every(candidate => candidate[targetId] === reason))));
}

function uniformValue<T>(values: readonly (T | undefined)[]): T | undefined {
    const first = values[0];
    return values.every(value => JSON.stringify(value) === JSON.stringify(first)) ? first : undefined;
}

function projectProtoMekFrenzy(
    entity: BaseEntity,
    state: NonMekUnitRuntimeState,
    rules: ProtoMekRuntimeRulesProjection,
    ruleset: CBTRuleset,
): MekPhysicalAttackRow {
    const action = entity.intrinsicWeapons().find(candidate => candidate.kind === 'frenzy');
    if (!action || action.damage.kind !== 'fixed') {
        throw new Error(`${entity.displayName()} has no fixed-damage non-Mek Frenzy action`);
    }
    const target = Object.freeze({ kind: 'intrinsic' as const, actionId: action.id });
    const resolution = gameRulesFor(ruleset).resolveToHit({
        subject: Object.freeze({
            kind: 'component' as const,
            componentId: asComponentId(action.id),
            source: Object.freeze({ kind: 'intrinsic' as const, actionKind: action.kind }),
            locations: action.locations,
            targetingComputerWeapon: null,
            targetingComputer: null,
        }),
    });
    const hitModifiers: EntityWeaponHitModifier[] = resolution.value === 'Vs'
        ? ['versus']
        : typeof resolution.value === 'number' ? [resolution.value] : [];
    const available = !rules.destroyed
        && !rules.computedConditions.includes('immobile');
    const selection = attackerActionSelection(state.attackerTargeting, target);
    return Object.freeze({
        target,
        label: action.name,
        locationIds: Object.freeze([]),
        locationCodes: Object.freeze([]),
        hitModifiers: Object.freeze(hitModifiers),
        hitModifierBreakdown: Object.freeze([...resolution.modifierBreakdown]),
        available,
        selectable: available,
        firingHeat: 0,
        effect: Object.freeze({
            kind: 'damage' as const,
            damage: action.damage.value,
            maximumDamage: action.damage.value,
            baseDamage: action.damage.value,
            weakened: false,
            boosted: false,
        }),
        ...(selection === undefined ? {} : { selection }),
    });
}

function projectVehicleCharge(
    entity: BaseEntity,
    state: NonMekUnitRuntimeState,
    rules: VehicleRuntimeRulesProjection,
    ruleset: CBTRuleset,
): MekPhysicalAttackRow {
    const action = entity.intrinsicWeapons().find(candidate => candidate.kind === 'charge');
    if (!action) throw new Error(`${entity.displayName()} has no non-Mek Charge action`);
    const target = Object.freeze({ kind: 'intrinsic' as const, actionId: action.id });
    const resolution = gameRulesFor(ruleset).resolveToHit({
        subject: Object.freeze({
            kind: 'component' as const,
            componentId: asComponentId(action.id),
            source: Object.freeze({ kind: 'intrinsic' as const, actionKind: action.kind }),
            locations: action.locations,
            targetingComputerWeapon: null,
            targetingComputer: null,
        }),
        stateModifiers: rules.modifiers.physical,
    });
    const hitModifiers: EntityWeaponHitModifier[] = resolution.value === 'Vs'
        ? ['versus']
        : typeof resolution.value === 'number' ? [resolution.value] : [];
    if (resolution.value === 'Vs') {
        const modifier = resolution.modifierBreakdown.reduce((sum, item) => sum + item.modifier, 0);
        if (modifier !== 0) hitModifiers.push(modifier);
    }
    const movementMode = state.turn.movement?.mode ?? null;
    const available = !rules.destroyed
        && !state.conditions.has('prone')
        && movementMode !== 'stationary'
        && movementMode !== 'jump';
    const selection = attackerActionSelection(state.attackerTargeting, target);
    return Object.freeze({
        target,
        label: action.name,
        locationIds: Object.freeze([]),
        locationCodes: Object.freeze([]),
        hitModifiers: Object.freeze(hitModifiers),
        hitModifierBreakdown: Object.freeze([...resolution.modifierBreakdown]),
        available,
        selectable: available,
        firingHeat: 0,
        effect: Object.freeze({
            kind: 'damage' as const,
            ...rules.chargeDamage,
            boosted: false,
            movementDistance: state.turn.movement?.distance ?? 0,
        }),
        ...(selection === undefined ? {} : { selection }),
    });
}

function projectAmmoSourceCandidates(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    ruleset: CBTRuleset,
    state: NonMekUnitRuntimeState,
    vehicleRules: VehicleRuntimeRulesProjection | null,
    entityStatuses: NonMekComponentStatuses,
): readonly NonMekAmmoSourceCandidate[] {
    return Object.freeze([...index.components.values()].flatMap(component => {
        const loadouts = entityAmmoLoadouts(entity, component.mount, ruleset);
        if (loadouts.length === 0) return [];
        const runtime = state.ammo.get(component.id);
        const current = entityAmmoLoadout(
            entity,
            component.mount,
            ruleset,
            runtime?.munitionOverride,
        );
        if (!current) return [];
        const committedStatus = vehicleRules?.componentStatuses.get(component.id)
            ?? entityStatuses.committed.get(component.id)
            ?? 'available';
        return [Object.freeze({
            loadouts,
            source: Object.freeze({
                componentId: component.id,
                label: current.equipment.shortName || current.equipment.name,
                location: component.mount.location,
                status: committedStatus,
                munitionKey: current.munitionKey,
                remaining: committedStatus === 'available'
                    ? Math.max(0, current.capacity - (runtime?.shotsSpent ?? 0))
                    : 0,
                capacity: current.capacity,
                loadouts: freezeLoadouts(loadouts),
            }),
        })];
    }).sort((left, right) => compareText(left.source.componentId, right.source.componentId)));
}

function compatibleAmmoSources(
    candidates: readonly NonMekAmmoSourceCandidate[],
    weapon: WeaponEquipment,
    selectedMode: string | undefined,
): readonly EquipmentPanelAmmoSource[] {
    return Object.freeze(candidates.flatMap(candidate => {
        const compatible = candidate.loadouts
            .filter(loadout => weaponAcceptsAmmo(weapon, loadout.equipment, selectedMode));
        if (compatible.length === 0) return [];
        return [Object.freeze({
            ...candidate.source,
            loadouts: freezeLoadouts(compatible),
        })];
    }));
}

function installedTargetingComputer(
    index: NonMekRuntimeIndex,
    vehicleRules: VehicleRuntimeRulesProjection | null,
    entityStatuses: NonMekComponentStatuses,
): ComponentToHitTargetingComputerFacts | null {
    for (const component of index.components.values()) {
        const equipment = component.mount.equipment;
        if (!equipment || !isTargetingComputerEquipment(equipment)) continue;
        return Object.freeze({
            label: equipment.name,
            status: vehicleRules?.componentStatuses.get(component.id)
                ?? entityStatuses.committed.get(component.id)
                ?? 'available',
        });
    }
    return null;
}

function installedWeaponToHitSubject(
    componentId: ComponentId,
    locations: readonly string[],
    equipment: WeaponEquipment,
    selectedAmmo: AmmoEquipment | null,
    targetingComputer: ComponentToHitTargetingComputerFacts | null,
): ComponentToHitSubject {
    return Object.freeze({
        kind: 'component',
        componentId,
        source: Object.freeze({
            kind: 'equipment',
            equipment,
            physical: false,
            parentEquipment: null,
        }),
        locations: Object.freeze([...locations]),
        targetingComputerWeapon: Object.freeze({
            equipment,
            effectiveWeaponTypes: Object.freeze([
                ...equipmentPanelWeaponTypes(equipment, selectedAmmo),
            ]),
        }),
        targetingComputer,
    });
}

function projectAmmo(
    entity: BaseEntity,
    component: EntityMountedEquipment,
    ruleset: CBTRuleset,
    state: NonMekUnitRuntimeState,
    componentId: ComponentId,
    loadouts: readonly AmmoLoadout[],
): NonNullable<EquipmentPanelComponent['ammo']> {
    if (!(component.equipment instanceof AmmoEquipment)) {
        throw new Error(`Non-Mek ammunition source ${componentId} is unavailable`);
    }
    const runtime = state.ammo.get(componentId);
    const current = entityAmmoLoadout(entity, component, ruleset, runtime?.munitionOverride);
    if (!current) throw new Error(`Non-Mek ammunition source ${componentId} has no valid loadout`);
    return Object.freeze({
        defaultMunitionKey: component.equipment.internalName,
        munitionKey: current.munitionKey,
        displayName: current.equipment.shortName || current.equipment.name,
        remaining: Math.max(0, current.capacity - (runtime?.shotsSpent ?? 0)),
        capacity: current.capacity,
        loadouts: freezeLoadouts(loadouts),
    });
}

function freezeLoadouts(loadouts: readonly AmmoLoadout[]): readonly EquipmentPanelAmmoLoadout[] {
    return Object.freeze(loadouts.map(loadout => Object.freeze({
        munitionKey: loadout.munitionKey,
        displayName: loadout.equipment.shortName || loadout.equipment.name,
        capacity: loadout.capacity,
        equipment: loadout.equipment,
    })));
}
