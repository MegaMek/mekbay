// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { crewSkillsForUnit } from '../unit-crew-policy';
import {
AEROSPACE_RANGE_BRACKETS,
aerospaceAttackValues,
aerospaceRangeLimits,
effectiveAerospaceMaximumBracket,
} from '../../utils/aerospace-range.util';
import { compareText } from '../../utils/string.util';
import { resolveAmmoWeaponProfile } from '../ammo-weapon-profile.model';
import { activeArtemisKind, artemisVToHitAdjustment, type ArtemisKind } from '../artemis-equipment.model';
import { apolloToHitAdjustment } from '../apollo-mode.model';
import { bombastLaserEquipmentProfile } from '../bombast-laser-mode.model';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { BaseEntity } from '../entity/base-entity';
import { asComponentId,asLocationId,type ComponentId } from '../entity/entity-identifiers';
import type { EntityMountedEquipment,EntityWeaponHitModifier } from '../entity/types';
import { effectiveEntityPilotingSkill } from '../entity/utils/battle-value/skill-facts';
import {
    isBattleArmorEntity,
    isInfantryEntity,
    isInfantryFamilyEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import {
    antiMekTrooperModifier,
    battleArmorSwarmDamage,
    battleArmorVibroClaws,
    LEG_ATTACK_DAMAGE,
    PLATOON_SWARM_DAMAGE_GROUP,
    SWARM_MAGNETIC_CLAW_MODIFIER,
} from '../rules/anti-mek-attack-rules';
import { isMagnetClawEquipment } from '../battle-armor-equipment.model';
import {
    disposableWeaponAttack,
    isAntiPersonnelWeaponMount,
    isDisposableWeaponMount,
    platoonAttack,
    platoonAttackLabel,
    trooperWeaponAttack,
    type PlatoonAttackFacts,
} from '../rules/conventional-infantry-combat-rules';
import { INFERNO_LABEL, platoonInfernoMissiles } from '../rules/inferno-rules';
import { physicalAttackMeetsBuildingCover, physicalAttackMeetsWaterCover } from '../rules/physical-attack-rules';
import { isRiscLaserPulseModule, RISC_LASER_PULSE_MODE, RISC_LASER_PULSE_HEAT_BONUS, riscLaserPulseToHitAdjustment } from '../risc-laser-mode.model';
import { isTargetingComputerEquipment } from '../entity/utils/targeting-computer';
import { AmmoEquipment,WeaponEquipment,ammoMatchesWeapon } from '../equipment.model';
import { applyFlamerWeaponTypes, flamerDisplayLabel } from '../flamer-mode.model';
import type { OptionalRules } from '../options.model';
import type { WeaponType } from '../weapon-types.model';
import { laserInsulatorWeakened, laserInsulatorAdjustedHeat } from '../laser-insulator.model';
import { prototypeLaserMaximumExtraHeat } from '../prototype-laser-heat.model';
import {
gameRulesFor,
type ComponentToHitSubject,
type ComponentToHitTargetingComputerFacts,
type ToHitModifierBreakdownEntry,
} from '../rules/game-rules';
import { protoMekCriticalModifiers, type ProtoMekRuntimeRulesProjection } from '../rules/protomek-runtime-rules';
import {
vehicleHasChargeAttack,
type VehicleRuntimeRulesProjection,
} from '../rules/vehicle-runtime-rules';
import { isUnitWaterDepth } from '../unit-cover.model';
import { attackerActionSelection } from './attacker-targeting-state';
import { componentAutocannonHit } from './component-state-change';
import { mobileHpgBlocksWeaponAttacks } from './component-mobile-hpg';
import { halvedUnderwater } from './mek-physical-attack-v2';
import type { TargetRegistrySnapshot } from './encounter-runtime';
import {
EquipmentPanelAmmoLoadout,
EquipmentPanelAmmoSource,
EquipmentPanelComponent,
EquipmentPanelSnapshot,
equipmentPanelWeaponTypes,
equipmentPanelAttachments,
projectEquipmentPanelHit,
projectEquipmentPanelWeaponDamage,
projectEquipmentTargets,
selectedAmmoIsHotLoaded,
type EquipmentPanelTarget,
type MekPhysicalAttackRow,
} from './equipment-panel';
import {
ammoSourceFeedsWeapon,
entityAmmoDefaultMunitionKey,
entityAmmoLoadout,
entityAmmoLoadouts,
entityAmmoSelectionCompatibilityFacts,
entityWeaponTechBasesForAmmo,
weaponAcceptsAmmo,
type AmmoLoadout,
} from './mek-ammo';
import { canSpotWithoutTag } from './non-mek-airborne-state';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import {
effectiveNonMekComponentMode,
nonMekAmmoSourceLoads,
nonMekComponentModes,
nonMekHeatOrDamageWeapon,
nonMekMobileHpgFacts,
nonMekWeaponTargetSubject,
type NonMekAmmoSourceLoads,
type NonMekUnitQueryPort,
type NonMekUnitRuntimeState,
} from './non-mek-unit-instance';
import { aerospaceRapidFireShots } from './component-rapid-fire-autocannon';
import { nonMekWeaponAttackGroups, usesAerospaceFiringRates } from './non-mek-weapon-attack-groups';
import { weaponTargetDisabledReasons } from './weapon-target-policy';

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
    query: NonMekUnitQueryPort,
    registry: TargetRegistrySnapshot,
    optionalRules: OptionalRules,
): EquipmentPanelSnapshot {
    if (entity.entityType === 'Mek') throw new Error('Meks require the Mek equipment projection');
    if (state.stateRevision !== query.stateRevision) {
        throw new Error('Equipment-panel state and query revisions do not match');
    }
    const targets = projectEquipmentTargets(state.attackerTargeting, registry);
    const projection = query.projection();
    const { vehicle: vehicleRules, protoMek: protoMekRules, aero: aeroRules } = projection;
    const ammoSourceLoads = nonMekAmmoSourceLoads(entity, index, ruleset, state);
    const ammoSourceCandidates = projectAmmoSourceCandidates(index, ammoSourceLoads, query);
    const targetingComputer = installedTargetingComputer(index, query);
    const swarming = effectiveSwarming(state, targets);
    // A swarming unit attacks only the unit it clings to, with its swarm damage (TW p. 220).
    const hpgBlocksWeaponFire = swarming !== null
        || mobileHpgBlocksWeaponAttacks(nonMekMobileHpgFacts(index, state, projection));
    // A platoon fires its weapons as one attack: the primary weapon's row carries it, and a disposable weapon has its
    // own row. The secondary weapon has no attack of its own.
    const platoon = platoonAttackRows(entity, index, query);
    const projectedComponents = Object.freeze([...index.components.values()]
        .filter(component => component.mount.platoonWeapon !== 'secondary')
        .map(component => {
            const attack = platoon.get(component.id);
            const row = projectComponent(
                entity,
                index,
                ruleset,
                optionalRules,
                state,
                query,
                component.id,
                attack?.label ?? component.mount.displayName(),
                targets,
                targetingComputer,
                hpgBlocksWeaponFire,
                ammoSourceLoads,
                ammoSourceCandidates,
            );
            return attack ? withPlatoonAttack(row, attack.facts) : row;
        }));
    const components = projectWeaponAttackComponents(
        entity,
        index,
        state,
        projectedComponents,
    );
    const firstCrew = query.crewAssignment().positions[0];
    const skills = crewSkillsForUnit(firstCrew, entity.unitType(), entity.unitSubtype());
    const bombCapacity = entity.bombCapacity();
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
            gunnery: skills.gunnery,
            piloting: effectiveEntityPilotingSkill(entity, skills.piloting),
        }),
        components,
        physicalAttacks: vehicleRules !== null && isVehicleEntity(entity) && vehicleHasChargeAttack(entity)
            ? Object.freeze([projectVehicleCharge(entity, state, vehicleRules, ruleset)])
            : protoMekRules !== null
                ? Object.freeze([projectProtoMekFrenzy(entity, state, protoMekRules, ruleset)])
                : projectAntiMekAttacks(entity, index, state, query, swarming, skills.gunnery),
        ...(state.equipmentRowOrder === undefined
            ? {}
            : { equipmentRowOrder: state.equipmentRowOrder }),
        physicalAttackBlockers: Object.freeze([]),
        targets,
        ...(bombCapacity.external + bombCapacity.internal > 0
            ? { bombs: Object.freeze({ capacity: bombCapacity, loads: state.bombs ?? [] }) }
            : {}),
    });
}

/**
 * The target a unit still swarms: the one it took hold of, unless that unit is open here and no longer shows as
 * swarmed (its owner shook the infantry off, or has not yet accepted the swarm).
 */
export function effectiveSwarming(
    state: Pick<NonMekUnitRuntimeState, 'swarming'>,
    targets: readonly EquipmentPanelTarget[],
): string | null {
    if (state.swarming === undefined) return null;
    const target = targets.find(candidate => candidate.targetId === state.swarming);
    return target?.readOnly === true && target.calculator?.swarmed !== true ? null : state.swarming;
}

function spottingModifiers(entity: BaseEntity, state: NonMekUnitRuntimeState): readonly ToHitModifierBreakdownEntry[] {
    return state.turn.spotting === true && canSpotWithoutTag(entity, state.turn.airborne)
        ? [{ label: 'Spotting', modifier: 1 }] : [];
}

/** Troopers still fighting: a platoon's strength, or the battle armor suits not destroyed. */
function activeTroopers(entity: BaseEntity, index: NonMekRuntimeIndex, query: NonMekUnitQueryPort): number {
    const locations = [...index.locations.values()];
    if (isBattleArmorEntity(entity)) {
        return locations.filter(location => location.code.startsWith('Trooper ')
            && query.remainingInternal(location.id, 'committed') > 0).length;
    }
    const platoon = locations.find(location => location.code === 'Infantry');
    return platoon === undefined ? 0 : query.remainingInternal(platoon.id, 'committed');
}

/**
 * Infantry anti-'Mech attacks (TW pp. 220-223), declared like physical attacks and resolved in the Weapon Attack
 * Phase: a leg attack and a swarm, or for a unit already swarming its swarm damage and the end of the swarm.
 */
function projectAntiMekAttacks(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    query: NonMekUnitQueryPort,
    swarming: string | null,
    gunnery: number,
): readonly MekPhysicalAttackRow[] {
    if (!isInfantryFamilyEntity(entity)) return Object.freeze([]);
    const battleArmor = isBattleArmorEntity(entity);
    const troopers = activeTroopers(entity, index, query);
    const active = !query.destroyed() && troopers > 0;
    const claws = battleArmor ? battleArmorVibroClaws(entity) : 0;
    const row = (
        kind: 'leg-attack' | 'swarm' | 'end-swarm' | 'vibro-claw',
        facts: Pick<MekPhysicalAttackRow, 'kind' | 'reach'> & Partial<Pick<MekPhysicalAttackRow,
            'hitTable' | 'onlyTarget' | 'damageGroupSize' | 'critical' | 'firingSuits' | 'gunnerySkill'>> & Readonly<{
                label?: string;
                modifiers?: readonly Readonly<{ label: string; modifier: number }>[] | null;
                damage?: number;
            }>,
    ): MekPhysicalAttackRow | null => {
        const action = entity.intrinsicWeapons().find(candidate => candidate.kind === kind);
        if (!action) return null;
        const target = Object.freeze({ kind: 'intrinsic' as const, actionId: action.id });
        const modifiers = facts.modifiers ?? [];
        const available = active && facts.modifiers !== null;
        const selection = attackerActionSelection(state.attackerTargeting, target);
        const { label, modifiers: _modifiers, damage, ...rowFacts } = facts;
        return Object.freeze({
            target,
            label: label ?? action.name,
            locationIds: Object.freeze([]),
            locationCodes: Object.freeze([]),
            hitModifiers: Object.freeze([modifiers.reduce((total, item) => total + item.modifier, 0)]),
            hitModifierBreakdown: Object.freeze(modifiers.filter(item => item.modifier !== 0)),
            available,
            selectable: available,
            firingHeat: 0,
            meetsWaterCover: true,
            effect: damage === undefined ? Object.freeze({ kind: 'none' as const }) : Object.freeze({
                kind: 'damage' as const, damage, maximumDamage: damage, baseDamage: damage, weakened: false, boosted: false,
            }),
            ...rowFacts,
            ...(selection === undefined ? {} : { selection }),
        });
    };
    const burdened = isBattleArmorEntity(entity) && [...index.components.values()].some(component =>
        entity.carriesBodyMissileLauncher(component.mount) && state.components.get(component.id)?.mode !== 'Jettisoned');
    const trooperModifiers = (attack: 'leg-attack' | 'swarm') => {
        if (burdened) return null;
        const modifier = antiMekTrooperModifier(attack, battleArmor, troopers);
        return modifier === null ? null : [
            Object.freeze({ label: 'Troopers', modifier }),
            ...spottingModifiers(entity, state),
            ...(attack === 'swarm' && entity.equipment().some(mount => isMagnetClawEquipment(mount.equipment))
                ? [Object.freeze({ label: 'Magnetic Claws', modifier: SWARM_MAGNETIC_CLAW_MODIFIER })] : []),
        ];
    };
    const rows = swarming === null ? [
        ...(claws > 0 ? [row('vibro-claw', { kind: 'vibro-claw', reach: 'infantry-in-hex',
            damage: claws, damageGroupSize: claws, firingSuits: troopers, gunnerySkill: gunnery })] : []),
        row('leg-attack', {
            kind: 'leg-attack', reach: 'legs-in-hex', hitTable: 'kick', critical: true,
            modifiers: trooperModifiers('leg-attack'), damage: LEG_ATTACK_DAMAGE + claws,
        }),
        row('swarm', { kind: 'swarm', reach: 'swarmable-in-hex', modifiers: trooperModifiers('swarm') }),
    ] : [
        // Swarm damage always hits: battle armor's on one location, a platoon's in 2-point groupings (TW p. 223).
        row('swarm', {
            kind: 'swarm-damage', reach: 'swarmed-in-hex', onlyTarget: swarming, hitTable: 'swarm', label: 'Swarm Damage',
            ...(isBattleArmorEntity(entity)
                ? { damage: battleArmorSwarmDamage(entity, troopers), critical: true as const }
                : {
                    damage: isInfantryEntity(entity) ? platoonAttack(entity, troopers).damageByTroopers[troopers] ?? 0 : 0,
                    damageGroupSize: PLATOON_SWARM_DAMAGE_GROUP,
                }),
        }),
        row('end-swarm', { kind: 'end-swarm', reach: 'swarmed-in-hex', onlyTarget: swarming }),
    ];
    return Object.freeze(rows.filter((candidate): candidate is MekPhysicalAttackRow => candidate !== null));
}

/**
 * The attacks resolved by troopers, with the troopers fighting now, by component: a platoon's attack on its primary
 * weapon, a platoon's or battle armor squad's disposable weapon, and battle armor's anti-personnel weapons.
 */
function platoonAttackRows(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    query: NonMekUnitQueryPort,
): ReadonlyMap<ComponentId, Readonly<{ facts: PlatoonAttackFacts; label: string }>> {
    const rows = new Map<ComponentId, Readonly<{ facts: PlatoonAttackFacts; label: string }>>();
    if (!isInfantryFamilyEntity(entity)) return rows;
    const troopers = activeTroopers(entity, index, query);
    for (const component of index.components.values()) {
        const mount = component.mount;
        const equipment = mount.equipment;
        if (isInfantryEntity(entity) && mount.platoonWeapon === 'primary' && entity.primaryWeapon() !== null) {
            rows.set(component.id, Object.freeze({
                facts: platoonAttack(entity, troopers), label: platoonAttackLabel(entity),
            }));
        } else if (!(equipment instanceof WeaponEquipment) || !equipment.isInfantryWeapon()) {
            continue;
        } else if (isDisposableWeaponMount(entity, mount)) {
            rows.set(component.id, Object.freeze({
                facts: disposableWeaponAttack(equipment, troopers), label: equipment.name,
            }));
        } else if (isAntiPersonnelWeaponMount(entity, mount)) {
            // A weapon mounted on one trooper is fired by that trooper alone.
            const trooper = [...index.locations.values()].find(location => location.code === mount.location);
            const carrying = mount.location === 'Squad' ? troopers
                : trooper !== undefined && query.remainingInternal(trooper.id, 'committed') > 0 ? 1 : 0;
            rows.set(component.id, Object.freeze({
                facts: trooperWeaponAttack(equipment, carrying), label: mount.displayName(),
            }));
        }
    }
    return rows;
}

/** A platoon weapon row resolved by troopers: one damage value at every range, ranges read hex by hex. */
function withPlatoonAttack(
    row: EquipmentPanelComponent,
    attack: PlatoonAttackFacts,
): EquipmentPanelComponent {
    const weapon = row.weapon;
    if (!weapon) return row;
    const damage = attack.damageByTroopers[attack.troopers] ?? 0;
    const text = attack.inferno ? `${platoonInfernoMissiles(damage)} ${INFERNO_LABEL}` : `${damage}`;
    const value = Object.freeze({ values: Object.freeze([damage]), maximum: damage });
    // Each infantry range band spans a third of the farthest hex the weapon reaches.
    const farthest = attack.rangeModifiers.reduce<number>((last, modifier, hex) => modifier === null ? last : hex, 0);
    const band = farthest / 3;
    return Object.freeze({
        ...row,
        weapon: Object.freeze({
            ...weapon,
            selectable: weapon.selectable && attack.troopers > 0,
            damageText: text,
            damageTextByRange: Object.freeze({ short: text, medium: text, long: text, extreme: text }),
            damageByRange: Object.freeze({ short: value, medium: value, long: value, extreme: null }),
            ranges: Object.freeze([band, 2 * band, 3 * band]),
            minimumRange: 0,
            ammoSources: Object.freeze([]),
            platoon: attack,
        }),
    });
}

function projectComponent(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    ruleset: CBTRuleset,
    optionalRules: OptionalRules,
    state: NonMekUnitRuntimeState,
    query: NonMekUnitQueryPort,
    componentId: ComponentId,
    baseLabel: string,
    targets: readonly EquipmentPanelTarget[],
    targetingComputer: ComponentToHitTargetingComputerFacts | null,
    hpgBlocksWeaponFire: boolean,
    ammoSourceLoads: readonly NonMekAmmoSourceLoads[],
    ammoSourceCandidates: readonly NonMekAmmoSourceCandidate[],
): EquipmentPanelComponent {
    const component = index.components.get(componentId);
    if (!component) throw new Error(`Unknown non-Mek component ${componentId}`);
    const mount = component.mount;
    const equipment = mount.equipment;
    const componentState = state.components.get(componentId);
    const { vehicle: vehicleRules, infantry: infantryRules, protoMek: protoMekRules, aero: aeroRules } = query.projection();
    const status = query.componentStatus(componentId, 'committed');
    const previewStatus = query.componentStatus(componentId, 'preview');
    const modeDefinition = nonMekComponentModes(entity, mount, ruleset);
    const aerospaceShots = equipment instanceof WeaponEquipment && usesAerospaceFiringRates(entity, state)
        ? aerospaceRapidFireShots(equipment) : 1;
    const mode = aerospaceShots > 1 ? modeDefinition.modes.at(-1) : effectiveNonMekComponentMode(entity, index, state, ruleset, componentId);
    const heatOrDamageWeapon = nonMekHeatOrDamageWeapon(entity, equipment);
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
        : projectAmmo(entity, mount, ruleset, state, query, componentId, loadouts);
    const targeting = state.attackerTargeting.components.get(componentId);
    const feedingSources = equipment instanceof WeaponEquipment ? ammoSourceCandidates.filter(candidate => ammoSourceFeedsWeapon(
        candidate.source.componentId, index.components.get(candidate.source.componentId)?.mount, componentId, equipment)) : [];
    const ammoSources = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? compatibleAmmoSources(
            feedingSources,
            equipment,
            mode,
        )
        : Object.freeze([]);
    const targetSubject = nonMekWeaponTargetSubject(
        entity,
        index,
        ruleset,
        state,
        ammoSourceLoads,
        componentId,
        targeting?.ammo,
    );
    const selectedAmmo = targetSubject?.selectedAmmo ?? null;
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
    const stateModifiers = Object.freeze([
        ...spottingModifiers(entity, state),
        ...(aeroRules?.modifiers.ranged ?? []),
        ...(protoMekRules === null ? [] : protoMekCriticalModifiers(protoMekRules.criticalHits, mount.getOccupiedLocations())),
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
    const attachments = entity.getLinkingMounts(mount);
    const statusOf = (source: EntityMountedEquipment) => query.componentStatus(asComponentId(source.mountId), 'committed');
    const { modifiers, fireControl, fireControlStatus } = equipmentPanelAttachments(attachments, statusOf);
    const insulationWeakened = laserInsulatorWeakened(attachments, source => statusOf(source) === 'available');
    const pulseModule = attachments.find(source => isRiscLaserPulseModule(source.equipment));
    const pulsed = !!pulseModule && statusOf(pulseModule) === 'available'
        && status === 'available' && mode === RISC_LASER_PULSE_MODE;
    const artemis = activeArtemisKind(fireControl, fireControlStatus, selectedAmmo, query.hasCondition('jammed'));
    const artemisVToHit = artemisVToHitAdjustment(
        fireControl, equipment, fireControlStatus,
        selectedAmmo, query.hasCondition('jammed'), false,
    );
    const aerospace = equipment instanceof WeaponEquipment
        && !mount.isPhysicalWeapon()
        && entity.unitType() === 'Aero'
        ? projectAerospaceWeapon(equipment, selectedAmmo, ruleset, mode, artemis)
        : undefined;
    const apolloToHit = apolloToHitAdjustment(fireControl, equipment, fireControlStatus, ruleset);
    const bombast = bombastLaserEquipmentProfile(equipment, ruleset, mode);
    const indirectAdjustments = [
        ...(bombast === null ? [] : [{
            kind: 'replace-base' as const,
            value: bombast.toHitModifier,
            label: 'Bombast Laser',
        }]),
        ...(apolloToHit === null ? [] : [apolloToHit]),
        ...(pulseModule ? [riscLaserPulseToHitAdjustment(pulseModule.displayName(), pulsed)] : []),
    ];
    const adjustments = artemisVToHit === null ? indirectAdjustments : [...indirectAdjustments, artemisVToHit];
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
            adjustments,
        }, indirectAdjustments)
        : null;
    const effectiveDamage = equipment instanceof WeaponEquipment
        ? bombast?.damage ?? equipment.damage
        : 0;
    const weaponTypes = equipment instanceof WeaponEquipment
        ? new Set(equipmentPanelWeaponTypes(equipment, selectedAmmo))
        : new Set<WeaponType>();
    if (pulsed) weaponTypes.add('P');
    const effectiveWeaponTypes = equipment instanceof WeaponEquipment
        ? Object.freeze([...new Set([
            ...(heatOrDamageWeapon
                ? applyFlamerWeaponTypes(heatOrDamageWeapon, mode, weaponTypes, ruleset, optionalRules)
                : weaponTypes),
            ...(feedingSources.some(candidate => candidate.source.hotLoaded
                && candidate.source.status !== 'destroyed'
                && candidate.source.capacity - (state.ammo.get(candidate.source.componentId)?.shotsSpent ?? 0) > 0
                && ammoMatchesWeapon(equipment, candidate.loadouts.find(loadout =>
                    loadout.munitionKey === candidate.source.munitionKey)!.equipment)) ? ['X' as const] : []),
        ])])
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
    const prototypeMaximumHeat = equipment instanceof WeaponEquipment
        ? prototypeLaserMaximumExtraHeat(equipment.internalName)
        : 0;
    const displayedHeat = equipment instanceof WeaponEquipment
        ? laserInsulatorAdjustedHeat(
            (bombast?.heat ?? equipment.heat) + (pulsed ? RISC_LASER_PULSE_HEAT_BONUS : 0),
            insulationWeakened === false,
        ) * aerospaceShots + (entity.unitType() === 'Aero' ? prototypeMaximumHeat : 0)
        : 0;
    const weapon = equipment instanceof WeaponEquipment && !mount.isPhysicalWeapon()
        ? Object.freeze({
            heat: displayedHeat,
            firingHeat: displayedHeat,
            ...(prototypeMaximumHeat > 0 && entity.unitType() !== 'Aero'
                ? { heatSuffix: '*' as const }
                : {}),
            ...(state.turn.firedWeapons?.includes(componentId) ? { firedThisTurn: true as const } : {}),
            selectable: !query.destroyed()
                && status === 'available'
                // A weapon fires once a turn.
                && state.turn.firedWeapons?.includes(componentId) !== true
                && componentState?.jammed !== true
                && vehicleRules?.fireBlockedComponentIds.has(componentId) !== true
                && infantryRules?.fireBlockedComponentIds.has(componentId) !== true
                && aeroRules?.fireControlDestroyed !== true
                && protoMekRules?.fireBlockedComponentIds.has(componentId) !== true
                && !hpgBlocksWeaponFire,
            damage: effectiveDamage,
            damageText: damage!.default,
            damageTextByRange: damage!.byRange,
            damageByRange: damage!.valuesByRange,
            hit: hit!,
            toHitModifier: hit!.default.profile.length === 1
                ? hit!.default.profile[0]!
                : Object.freeze([...hit!.default.profile]),
            hitModifierBreakdown: Object.freeze([...hit!.default.modifierBreakdown]),
            ...(artemis === null ? {} : { artemis }),
            ...(artemisVToHit === null ? {} : { artemisVModifier: artemisVToHit.modifier }),
            ...(targetSubject?.maximumRange === undefined ? {} : { mediumRangeLimit: true as const }),
            ranges: Object.freeze([...(ammoProfile?.ranges ?? equipment.ranges)]),
            minimumRange: selectedAmmoIsHotLoaded(ammoSources, targeting?.ammo)
                ? 0 : ammoProfile?.minimumRange ?? equipment.minimumRange,
            ...(aerospace === undefined ? {} : { aerospace }),
            ...(targeting?.selection === undefined ? {} : { selection: targeting.selection }),
            ...(targeting?.ammo === undefined ? {} : { ammoSelection: targeting.ammo }),
            ammoSources,
            underwater: targetSubject!.underwater,
            attackerSubmerged: false,
            effectiveWeaponTypes,
            ...(isBattleArmorEntity(entity) ? {
                attackerIsBattleArmor: true as const,
                ...(mount.location === 'Squad' ? { firingSuits: activeTroopers(entity, index, query) } : {}),
            } : {}),
            ...(entity.unitType() === 'Infantry' && entity.unitSubtype() !== 'Battle Armor'
                ? { attackerIsConventionalInfantry: true as const }
                : {}),
            disabledTargetReasons: weaponTargetDisabledReasons(targetSubject!, ruleset, targets),
        })
        : undefined;
    return Object.freeze({
        componentId,
        label: heatOrDamageWeapon
            ? flamerDisplayLabel(baseLabel, heatOrDamageWeapon, mode, ruleset, optionalRules)
            : baseLabel,
        ...(equipment === undefined ? {} : { equipment }),
        locations: Object.freeze(locations),
        status,
        previewStatus,
        ...(previewStatus !== 'destroyed' && componentAutocannonHit(state, componentId, 'preview') ? { autocannonHit: true as const } : {}),
        modes: aerospaceShots > 1 ? [] : mode === 'Jettisoned' ? [mode] : modeDefinition.modes,
        ...(modeDefinition.defaultMode === undefined ? {} : { defaultMode: modeDefinition.defaultMode }),
        ...(mode === undefined ? {} : { mode }),
        jammed: componentState?.jammed === true,
        ...(insulationWeakened === undefined ? {} : { heatWeakened: insulationWeakened }),
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
    artemis: ArtemisKind | null,
): NonNullable<EquipmentPanelComponent['weapon']>['aerospace'] {
    const ammoProfile = resolveAmmoWeaponProfile(selectedAmmo);
    const maximumBracket = effectiveAerospaceMaximumBracket(equipment, ammoProfile);
    const baseValues = aerospaceAttackValues(equipment, ammoProfile, artemis);
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
    const operational = members.filter(member => member.weapon?.selectable === true);
    const operationalWeapons = operational.map(member => member.weapon!);
    const capital = representative.equipment instanceof WeaponEquipment
        && (representative.equipment.capital || representative.equipment.subCapital);
    const attackValues = AEROSPACE_RANGE_BRACKETS.map((_, index) => {
        const total = operational.reduce((sum, member) => sum + (capital && member.equipment instanceof WeaponEquipment
            ? member.equipment.weapon.av[index] ?? 0
            : member.weapon?.aerospace?.attackValues[index] ?? 0), 0);
        // SO:AA p.88: three NL55s have AV17; round the combined bay, not each laser.
        return capital ? Math.round(total) : total;
    }) as [number, number, number, number];
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
        damageByRange: undefined,
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
        ...(members.some(member => member.autocannonHit) ? { autocannonHit: true as const } : {}),
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
                ...(member.equipment instanceof WeaponEquipment ? { equipment: member.equipment } : {}),
                ...(member.mode === undefined ? {} : { mode: member.mode }),
                ...(member.weapon?.aerospace ? { attackValues: member.weapon.aerospace.attackValues } : {}),
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
        stateModifiers: spottingModifiers(entity, state),
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
        // Non-'Mek physical attacks read the standard table, which water cover always meets.
        meetsWaterCover: true,
        // A ProtoMek is underwater from Depth 1; only a standing 'Mech needs Depth 2 (TW p. 56).
        effect: halvedUnderwater(ruleset, Object.freeze({
            kind: 'damage' as const,
            damage: action.damage.value,
            maximumDamage: action.damage.value,
            baseDamage: action.damage.value,
            weakened: false,
            boosted: false,
        }), isUnitWaterDepth(state.turn.cover)),
        ...(selection === undefined ? {} : { selection }),
    });
}

const NOT_IN_WATER = Object.freeze({ partiallyUnderwater: false, submerged: false });

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
        stateModifiers: [...rules.modifiers.physical, ...spottingModifiers(entity, state)],
    });
    const hitModifiers: EntityWeaponHitModifier[] = resolution.value === 'Vs'
        ? ['versus']
        : typeof resolution.value === 'number' ? [resolution.value] : [];
    if (resolution.value === 'Vs') {
        const modifier = resolution.modifierBreakdown.reduce((sum, item) => sum + item.modifier, 0);
        if (modifier !== 0) hitModifiers.push(modifier);
    }
    const movementMode = state.turn.movement?.mode ?? null;
    const available = !rules.destroyed && !rules.systems.crewStunned
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
        // A charge reads the standard table; Core charges ignore partial cover (p. 66).
        meetsWaterCover: physicalAttackMeetsWaterCover(ruleset, 'charge', 'standard', NOT_IN_WATER),
        meetsBuildingCover: physicalAttackMeetsBuildingCover(ruleset, 'charge', 'standard'),
        kind: 'charge',
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
    index: NonMekRuntimeIndex,
    sourceLoads: readonly NonMekAmmoSourceLoads[],
    query: NonMekUnitQueryPort,
): readonly NonMekAmmoSourceCandidate[] {
    return Object.freeze(sourceLoads.map(({ componentId, current, loadouts }) => {
        const committedStatus = query.componentStatus(componentId, 'committed');
        return Object.freeze({
            loadouts,
            source: Object.freeze({
                componentId,
                label: current.equipment.shortName || current.equipment.name,
                location: index.components.get(componentId)!.mount.location,
                status: committedStatus,
                munitionKey: current.munitionKey,
                remaining: committedStatus === 'available' ? query.remainingAmmo(componentId) : 0,
                capacity: current.capacity,
                hotLoaded: query.ammoHotLoaded(componentId),
                loadouts: freezeLoadouts(loadouts),
            }),
        });
    }));
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
    query: NonMekUnitQueryPort,
): ComponentToHitTargetingComputerFacts | null {
    for (const component of index.components.values()) {
        const equipment = component.mount.equipment;
        if (!equipment || !isTargetingComputerEquipment(equipment)) continue;
        return Object.freeze({
            label: equipment.name,
            status: query.componentStatus(component.id, 'committed'),
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
    query: NonMekUnitQueryPort,
    componentId: ComponentId,
    loadouts: readonly AmmoLoadout[],
): NonNullable<EquipmentPanelComponent['ammo']> {
    const defaultMunitionKey = entityAmmoDefaultMunitionKey(entity, component);
    const current = entityAmmoLoadout(entity, component, ruleset, state.ammo.get(componentId)?.munitionOverride);
    if (defaultMunitionKey === null || !current) {
        throw new Error(`Non-Mek ammunition source ${componentId} has no valid loadout`);
    }
    return Object.freeze({
        defaultMunitionKey,
        munitionKey: current.munitionKey,
        displayName: current.equipment.shortName || current.equipment.name,
        remaining: query.remainingAmmo(componentId),
        capacity: current.capacity,
        hotLoaded: query.ammoHotLoaded(componentId),
        loadouts: freezeLoadouts(loadouts),
        weaponTechBases: entityWeaponTechBasesForAmmo(entity, current.equipment),
        compatibilityFacts: entityAmmoSelectionCompatibilityFacts(entity, loadouts.map(loadout => loadout.equipment)),
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
