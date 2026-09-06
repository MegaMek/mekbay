// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    readLegacyUnitStateV1,
    type LegacyUnitSourceV1,
    type JsonObject,
    type JsonValue,
} from '../persisted-unit-state';
import { isUnitConditionKey } from '../unit-condition.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import { INTRINSIC_ONE_SHOT_AMMO_STATE } from '../ammo-weapon-profile.model';
import type {
    ArmorFaceId,
    ComponentId,
    CriticalSlotId,
    LocationId,
} from '../entity/entity-identifiers';
import { ImmutableIndex, ImmutableSet } from '../entity/immutable-collections';
import {
    freezeRuntimeState,
    type AmmoRuntimeState,
    type BombastLaserRuntimeState,
    type C3EmergencyMasterRuntimeState,
    type MekUnitRuntimeState,
    type ComponentRuntimeState,
    type EscalatingFailureRuntimeState,
    type InstanceBaselineRef,
    type LocationRuntimeState,
    type MekLocationConditionKey,
    type MekShieldDamageRuntimeState,
    type PendingCombatOverlay,
    type PpcCapacitorRuntimeState,
    isMekLocationConditionKey,
    MAX_MEK_LOCATION_CONDITION_VALUE,
} from './runtime-state';
import {
    GAUSS_POWERED_UP,
    isMekGaussPowerState,
} from './mek-gauss-power';
import { isGaussEquipment } from '../gauss-equipment.model';
import {
    isModularArmorEquipment,
    MODULAR_ARMOR_POINTS_PER_MOUNT,
} from '../modular-armor.model';
import { isMekLocationPhysicallyDestroyed } from './mek-location-state-kernel';
import {
    canonicalizeLegacyMekTurnStateV1,
    parseLegacyMekTurnStateV1,
    type LegacyMekTurnStateV1,
} from './legacy-mek-turn-state-v1';
import {
    projectLegacyMekTurnStateV1,
    restoreLegacyMekMovementPsrV1,
} from './mek-movement-psr-restoration-v1';
import { createPristineMekMovementPsrStateV2 } from './mek-movement-psr-v2';
import {
    componentEscalatingFailureProfile,
    type ComponentEscalatingFailureProfile,
} from './component-escalating-failure';
import {
    PPC_CAPACITOR_CHARGED_STATE,
    PPC_CAPACITOR_CHARGING_STATE,
    ppcCapacitorWeaponId,
} from './component-ppc-capacitor';
import {
    BOMBAST_LASER_CHARGED_STATE,
    BOMBAST_LASER_CHARGING_STATE,
    isCoreBombastLaserComponent,
} from './component-bombast-laser';
import {
    isC3EmergencyMasterComponent,
} from './component-c3-emergency-master';
import {
    buildMekRuntimeIndex,
    type MekRuntimeIndex,
    type MekIndexedComponent,
} from './mek-runtime-index';
import {
    mekAmmoCapacity,
    mekAmmoDefaultMunitionKey,
    mekAmmoLoadout,
    mekIntrinsicMagazine,
} from './mek-ammo';
import type { CBTRuleset } from '../cbt-ruleset.model';
import {
    canonicalizeMekHeatStateV2,
    MAX_MEK_HEATSINKS_OFF_V2,
    MAX_MEK_HEAT_VALUE_V2,
} from './mek-heat-state-v2';
import {
    C3EM_MODE_STATE_KEY,
    C3EM_OPERATING_TURNS_STATE_KEY,
} from '../c3-emergency-master.model';
import {
    createMekTorsoCripplingRuleCheckTokenV2,
    freezeRuleChecks,
    MEK_TORSO_CRIPPLING_RULE_CHECK_KEY,
    type MekRuleCheckStateV2,
} from './mek-destruction-state-v2';
import {
    mekCriticalSlotDirectHitThreshold,
    mekCriticalSlotMaximumHits,
} from './mek-critical-slot-rules';
import { isShieldEquipment, resolveShieldProfile } from '../entity/utils/physical-weapon';
import { mekCriticalSlotLabel } from '../../utils/mek-critical-display.util';
import { AmmoEquipment } from '../equipment.model';

interface MekRestoreUnit {
    readonly entity: MekEntity;
    readonly index: MekRuntimeIndex;
    readonly ruleset: CBTRuleset;
}

export interface LegacyStateRestoreResult {
    readonly state: MekUnitRuntimeState;
    readonly warnings: readonly string[];
}

export class StateRestoreIdentityError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'StateRestoreIdentityError';
    }
}

/**
 * Tolerant same-design restoration. Physical slot damage is coordinate-owned:
 * it is applied even if the current occupant changed, and the mismatch is reported.
 * Equipment-owned facts require a unique compatible target; otherwise their loss is reported.
 */
export async function restoreLegacyUnitState(
    record: LegacyUnitSourceV1,
    entity: MekEntity,
    initialized: { readonly baselineRef: InstanceBaselineRef; readonly state: MekUnitRuntimeState },
): Promise<LegacyStateRestoreResult> {
    // Detach portable evidence and retain the exact entity reference.
    record = structuredClone(record);
    initialized = {
        baselineRef: structuredClone(initialized.baselineRef),
        state: freezeRuntimeState(initialized.state),
    };
    if (record.identity.kind !== 'resolved') {
        throw new StateRestoreIdentityError('An unresolved legacy design cannot become an operational V2 instance');
    }
    const rawState = readLegacyUnitStateV1(record);
    const saved = record.identity.uuid;
    if (saved !== initialized.baselineRef.entity
        || saved !== entity.uuid()) {
        throw new StateRestoreIdentityError('Saved state belongs to a different UUID');
    }
    const unit: MekRestoreUnit = Object.freeze({
        entity,
        index: buildMekRuntimeIndex(entity),
        ruleset: initialized.baselineRef.ruleset,
    });

    const warnings: string[] = [];
    const idTranslation: Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId> = {};
    const slots = new Map(initialized.state.slots);
    const components = new Map(initialized.state.components);
    const ammo = new Map(initialized.state.ammo);
    // Null marks conflicting duplicate first-slot consumption; inventory cannot override it.
    const criticalAmmoConsumption = new Map<ComponentId, number | null>();
    const locations = new Map(initialized.state.locations);
    const pendingLocation = new Map(initialized.state.pendingCombat.locationInternalDamage);
    const pendingArmor = new Map(initialized.state.pendingCombat.armorDamage);
    const pendingCritical = new Map(initialized.state.pendingCombat.criticalHits);
    const pendingComponents = new Map(initialized.state.pendingCombat.componentStatus);
    const pendingShieldDamage = new Map(initialized.state.pendingCombat.shieldDamage);
    const pendingLocationConditions = new Map([...initialized.state.pendingCombat.locationConditions]
        .map(([locationId, values]) => [locationId, new Map(values)] as const));
    const conditions = new Set(initialized.state.conditions);

    for (const raw of array(rawState['crits'])) {
        const critical = recordObject(raw);
        if (!critical) {
            warnings.push('Critical witness is not an object');
            continue;
        }
        const coordinate = criticalCoordinate(critical, unit);
        if (coordinate) {
            let hits = committedHits(
                critical,
                mekCriticalSlotMaximumHits(unit.index, unit.ruleset, coordinate),
            );
            const parsedPendingHits = integer(critical['pendingHits']);
            let pendingHits = parsedPendingHits ?? 0;
            if (critical['hits'] !== undefined && nonnegativeInteger(critical['hits']) === null) {
                warnings.push('Malformed committed critical hits were skipped');
            }
            if (critical['pendingHits'] !== undefined && parsedPendingHits === null) {
                warnings.push('Malformed pending critical hits were skipped');
            }
            const destroying = critical['destroying'] === true || nonnegativeInteger(critical['destroying']) !== null;
            const destroyed = critical['destroyed'] === true || nonnegativeInteger(critical['destroyed']) !== null;
            for (const key of ['destroying', 'destroyed'] as const) {
                if (critical[key] !== undefined && typeof critical[key] !== 'boolean'
                    && nonnegativeInteger(critical[key]) === null) {
                    warnings.push(`Malformed critical ${key} marker was skipped`);
                }
            }
            // V1 included a pending direct hit in `hits` and set `destroying`
            // before `destroyed`. Zero-hit markers come from location loss;
            // V2 derives that loss from locations without inventing slot damage.
            if (critical['pendingHits'] === undefined && destroying && !destroyed
                && hits >= mekCriticalSlotDirectHitThreshold(coordinate)) {
                const committed = mekCriticalSlotDirectHitThreshold(coordinate) - 1;
                pendingHits = hits - committed;
                hits = committed;
            }
            const expected = expectedEquipmentName(critical);
            const current = slotOccupants(unit, coordinate.id);
            const mismatch = !!expected && !current.some(candidate => equipmentNamesMatch(expected, candidate));
            const destroyedTurn = nonnegativeInteger(critical['destroyedTurn']);
            if (critical['destroyedTurn'] !== undefined && destroyedTurn === null) {
                warnings.push('Malformed critical destruction turn was skipped');
            }
            if (hits > 0) {
                const nextHits = (slots.get(coordinate.id)?.hits ?? 0) + hits;
                slots.set(coordinate.id, {
                    hits: nextHits,
                    ...(destroyedTurn === null
                        || destroyedTurn === 0
                        || nextHits < mekCriticalSlotDirectHitThreshold(coordinate)
                        ? {}
                        : { destroyedTurn }),
                });
            }
            if (pendingHits !== 0) pendingCritical.set(
                coordinate.id,
                (pendingCritical.get(coordinate.id) ?? 0) + pendingHits,
            );
            idTranslation[string(critical['id']) ?? `${coordinate.locationCode}:${coordinate.slotIndex}`] = coordinate.id;
            if (mismatch && (hits > 0 || pendingHits !== 0)) {
                warnings.push(`Applied saved damage to ${coordinate.locationCode} slot ${coordinate.slotIndex} despite an occupant mismatch.`);
            }
            restoreCriticalAmmo(critical, coordinate.id, unit, ammo, criticalAmmoConsumption, warnings);
            const unsupported = hasUnknownFields(critical, new Set([
                'id', 'name', 'originalName', 'loc', 'slot', 'hits', 'pendingHits',
                'consumed', 'totalAmmo', 'destroying', 'destroyed', 'destroyedTurn', 'armored',
            ]));
            if (unsupported) warnings.push('Unsupported critical-hit details were skipped');
            continue;
        }

        const semantic = semanticSystemTarget(critical, unit);
        if (semantic) {
            const hits = committedHits(critical);
            if (critical['hits'] !== undefined && nonnegativeInteger(critical['hits']) === null) {
                warnings.push('Malformed semantic-system critical hits were skipped');
            }
            const targetSlots = [...unit.index.slots.values()]
                .filter(slot => slot.componentIds.includes(semantic.id))
                .slice(0, hits);
            for (const slot of targetSlots) slots.set(slot.id, { hits: (slots.get(slot.id)?.hits ?? 0) + 1 });
            warnings.push(`Mapped legacy semantic system ${semantic.system} to current critical coordinates.`);
            idTranslation[string(critical['id']) ?? semantic.system] = semantic.id;
            const unsupported = hasUnknownFields(critical, new Set(['id', 'name', 'originalName', 'hits', 'destroyed']));
            if (unsupported) warnings.push('Unsupported system damage details were skipped');
        } else {
            warnings.push('No current physical or semantic critical target');
        }
    }

    for (const raw of array(rawState['inventory'])) {
        const inventory = recordObject(raw);
        if (!inventory) {
            warnings.push('Inventory witness is not an object');
            continue;
        }
        // Early V1 saves included pristine rows, including intrinsic physical
        // attacks. They carry no mutable fact that requires an equipment mount.
        if (Object.entries(inventory).every(([key, value]) =>
            key === 'id' || (key === 'destroyed' && value === false))) continue;
        const matched = matchInventoryComponent(inventory, unit);
        if (!matched) {
            warnings.push('Equipment-specific state has no unique compatible target');
            continue;
        }
        const matchedDefinition = unit.index.components.get(matched.id)!;
        const current = components.get(matched.id) ?? {};
        const destroyed = stateMarker(inventory['destroyed']);
        const destroying = stateMarker(inventory['destroying']);
        const disabled = disabledState(inventory['states']);
        const intrinsicSystemStatus = matchedDefinition.kind === 'system'
            && (destroyed || destroying || disabled);
        if (intrinsicSystemStatus) {
            warnings.push('Intrinsic system status requires authoritative critical-slot or location damage evidence');
        }
        const escalatingFailure = restoreLegacyEscalatingFailureState(
            inventory['states'],
            matchedDefinition.kind === 'equipment'
                && matchedDefinition.mount.equipment !== undefined
                ? componentEscalatingFailureProfile(
                    matchedDefinition.mount.equipment.flags,
                    unit.ruleset,
                )
                : null,
        );
        const ppcCapacitor = restoreLegacyPpcCapacitorState(
            escalatingFailure.unknownStates,
            ppcCapacitorWeaponId(entity, unit.index, matched.id),
        );
        const bombastLaser = restoreLegacyBombastLaserState(
            ppcCapacitor.unknownStates,
            isCoreBombastLaserComponent(unit.index, matched.id, unit.ruleset),
        );
        const c3EmergencyMaster = restoreLegacyC3EmergencyMasterState(
            bombastLaser.unknownStates,
            isC3EmergencyMasterComponent(unit.index, matched.id),
        );
        const gaussPower = restoreLegacyGaussPowerState(
            c3EmergencyMaster.unknownStates,
            matchedDefinition.kind === 'equipment'
                && isGaussEquipment(matchedDefinition.mount.equipment),
        );
        const intrinsicAmmo = restoreLegacyIntrinsicAmmoState(
            gaussPower.unknownStates,
            unit,
            matched.id,
        );
        const unknownStates = intrinsicAmmo.unknownStates;
        if ((!intrinsicSystemStatus && (destroyed || disabled))
            || escalatingFailure.state || ppcCapacitor.state
            || bombastLaser.state || c3EmergencyMaster.state || gaussPower.state) components.set(matched.id, {
            ...current,
            ...(!intrinsicSystemStatus && (destroyed || disabled)
                ? { statusOverride: destroyed ? 'destroyed' as const : 'disabled' as const }
                : {}),
            ...(escalatingFailure.state ? { escalatingFailure: escalatingFailure.state } : {}),
            ...(ppcCapacitor.state ? { ppcCapacitor: ppcCapacitor.state } : {}),
            ...(bombastLaser.state ? { bombastLaser: bombastLaser.state } : {}),
            ...(c3EmergencyMaster.state
                ? { c3EmergencyMaster: c3EmergencyMaster.state }
                : {}),
            ...(gaussPower.state ? { gaussPower: gaussPower.state } : {}),
        });
        if (destroying && !intrinsicSystemStatus) pendingComponents.set(matched.id, 'destroyed');
        const consumed = nonnegativeInteger(inventory['consumed']);
        const criticalEvidence = criticalAmmoConsumption.get(matched.id);
        if (consumed !== null) {
            const modularArmor = matchedDefinition.kind === 'equipment'
                && isModularArmorEquipment(matchedDefinition.mount.equipment);
            const capacity = modularArmor
                ? MODULAR_ARMOR_POINTS_PER_MOUNT
                : mekAmmoCapacity(entity, unit.index, matched.id, unit.ruleset);
            if (capacity === null) {
                warnings.push('Ammo consumption targeted equipment without an ammo-bin capability');
            } else if (modularArmor) {
                const damage = Math.min(consumed, capacity);
                if (damage !== consumed) warnings.push(`${matched.equipmentKey} damage exceeded its current capacity`);
                if (damage > 0) components.set(matched.id, {
                    ...components.get(matched.id),
                    modularArmorDamage: damage,
                });
            } else {
                const shotsSpent = Math.min(consumed, capacity);
                if (shotsSpent !== consumed) warnings.push(`${matched.equipmentKey} ammunition consumption exceeded current capacity`);
                if (criticalEvidence === null) {
                    warnings.push(`${matched.equipmentKey} parent consumption cannot resolve conflicting first-critical evidence`);
                } else if (criticalEvidence !== undefined && criticalEvidence !== consumed) {
                    warnings.push(`${matched.equipmentKey} parent consumption disagrees with its first critical slot`);
                } else if (criticalEvidence === undefined) {
                    ammo.set(matched.id, { shotsSpent });
                }
            }
        }
        if (intrinsicAmmo.munitionOverride !== undefined) {
            const currentAmmo = ammo.get(matched.id);
            ammo.set(matched.id, Object.freeze({
                shotsSpent: currentAmmo?.shotsSpent ?? 0,
                munitionOverride: intrinsicAmmo.munitionOverride,
            }));
        }
        const savedCapacity = nonnegativeInteger(inventory['totalAmmo']);
        const currentCapacity = mekAmmoCapacity(entity, unit.index, matched.id, unit.ruleset);
        if (savedCapacity !== null && currentCapacity !== null && savedCapacity !== currentCapacity) {
            warnings.push(`${matched.equipmentKey} ammunition capacity changed from the saved baseline`);
        }
        if (unknownStates.length > 0 || inventory['ammo'] !== undefined) {
            warnings.push('Unsupported equipment modes or ammunition overrides were skipped');
        }
        idTranslation[string(inventory['id']) ?? matched.equipmentKey] = matched.id;
    }

    if (rawState['crits'] !== undefined && !Array.isArray(rawState['crits'])) {
        warnings.push('Malformed legacy critical container was skipped');
    }
    if (rawState['inventory'] !== undefined && !Array.isArray(rawState['inventory'])) {
        warnings.push('Malformed legacy inventory container was skipped');
    }
    if (rawState['conditions'] !== undefined && !Array.isArray(rawState['conditions'])) {
        warnings.push('Malformed legacy conditions were skipped');
    }
    const ruleChecks = new Map(initialized.state.ruleChecks);
    const restoredLegacyRuleChecks = restoreLegacyMekRuleChecks(
        rawState['ruleChecks'],
        unit,
        initialized.state.stateRevision,
        ruleChecks,
    );
    let explicitlyDestroyed = initialized.state.explicitlyDestroyed;
    if (rawState['destroyed'] !== undefined) {
        if (typeof rawState['destroyed'] === 'boolean') {
            explicitlyDestroyed = rawState['destroyed'];
        } else {
            warnings.push('Malformed legacy destroyed state was skipped');
        }
    }
    restoreLocations(
        rawState['locations'], unit, locations, components, pendingLocation, pendingArmor,
        pendingShieldDamage, pendingLocationConditions, warnings, idTranslation,
    );
    for (const condition of array(rawState['conditions'])) {
        if (isUnitConditionKey(condition)) conditions.add(condition);
        else warnings.push('An unsupported unit condition was skipped');
    }
    // Early V1 saves predate the conditions array and store shutdown directly.
    if (rawState['shutdown'] === true) conditions.add('shutdown');
    else if (rawState['shutdown'] !== undefined && typeof rawState['shutdown'] !== 'boolean') {
        warnings.push('Malformed legacy shutdown state was skipped');
    }
    const rawHeat = recordObject(rawState['heat']);
    let heat = initialized.state.heat;
    let unsupportedHeat = rawHeat !== null && hasUnknownFields(
        rawHeat,
        new Set(['current', 'previous', 'next', 'heatsinksOff']),
    );
    if (rawHeat) {
        const current = legacyHeatValue(rawHeat['current']);
        const previous = legacyHeatValue(rawHeat['previous']);
        const pendingOverride = legacyHeatValue(rawHeat['next']);
        const parsedHeatsinksOff = nonnegativeInteger(rawHeat['heatsinksOff']);
        const heatsinksOff = parsedHeatsinksOff !== null
            && parsedHeatsinksOff <= MAX_MEK_HEATSINKS_OFF_V2
            ? parsedHeatsinksOff
            : null;
        unsupportedHeat ||= (rawHeat['current'] !== undefined && current === null)
            || (rawHeat['previous'] !== undefined && previous === null)
            || (rawHeat['next'] !== undefined && pendingOverride === null)
            || (rawHeat['heatsinksOff'] !== undefined && heatsinksOff === null);
        heat = canonicalizeMekHeatStateV2({
            current: current ?? initialized.state.heat.current,
            previous: previous ?? initialized.state.heat.previous,
            ...(pendingOverride === null ? {} : { pendingOverride }),
            heatsinksOff: heatsinksOff ?? initialized.state.heat.heatsinksOff,
        });
    } else if (rawState['heat'] !== undefined) {
        warnings.push('Malformed legacy heat state was skipped');
    }
    if (unsupportedHeat) warnings.push('Invalid or unknown legacy heat facts were skipped');
    const restoredTurn = parseLegacyMekTurnStateV1(rawState['turnState']);
    const movementPsr = restoreLegacyMekMovementPsrV1(restoredTurn);
    if (movementPsr.kind === 'unsupported') {
        warnings.push(...movementPsr.warnings);
    }
    const translatedTurn = translateLegacyHeatAcknowledgementIds(
        restoredTurn.state,
        unit,
        idTranslation,
    );
    warnings.push(...restoredTurn.warnings);
    if (hasUnsupportedFamilyState(rawState, restoredLegacyRuleChecks)) {
        warnings.push('Unsupported legacy family state was skipped');
    }

    const pendingCombat: PendingCombatOverlay = Object.freeze({
        locationInternalDamage: new ImmutableIndex(pendingLocation),
        armorDamage: new ImmutableIndex(pendingArmor),
        criticalHits: new ImmutableIndex(pendingCritical),
        componentStatus: new ImmutableIndex(pendingComponents),
        shieldDamage: new ImmutableIndex(pendingShieldDamage),
        modularArmorDamage: new ImmutableIndex<ComponentId, number>([]),
        locationConditions: new ImmutableIndex([...pendingLocationConditions]
            .map(([locationId, values]) => [locationId, new ImmutableIndex(values)] as const)),
    });
    const state = freezeRuntimeState({
        ...initialized.state,
        explicitlyDestroyed,
        destroyed: explicitlyDestroyed || initialized.state.destroyed,
        locations: new ImmutableIndex(locations),
        slots: new ImmutableIndex(slots),
        components: new ImmutableIndex(components),
        ammo: new ImmutableIndex(ammo),
        ruleChecks: freezeRuleChecks(ruleChecks),
        conditions: new ImmutableSet(conditions),
        heat,
        movementPsr: movementPsr.kind === 'supported'
            ? movementPsr.state
            : createPristineMekMovementPsrStateV2(),
        turn: projectLegacyMekTurnStateV1(translatedTurn),
        pendingCombat,
    });
    return { state, warnings: Object.freeze([...new Set(warnings)]) };
}

/**
 * Legacy source acknowledgements embed source-owned runtime IDs. Restoration already maps the
 * corresponding critical/inventory facts through idTranslation, so the acknowledgement must
 * follow the same exact mapping or a settled source would reopen after source revision drift.
 * Unknown IDs are deliberately retained verbatim; this helper never guesses by heat value.
 */
function translateLegacyHeatAcknowledgementIds(
    turn: LegacyMekTurnStateV1,
    unit: MekRestoreUnit,
    idTranslation: Readonly<Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>>,
): LegacyMekTurnStateV1 {
    if (turn.acknowledgedHeatSources.size === 0) return turn;
    const original = turn.acknowledgedHeatSources;
    const translated = new Map<string, string>();
    let changed = false;
    for (const [sourceId, signature] of original) {
        const translatedSourceId = translatePpcHeatSourceId(sourceId, unit, idTranslation);
        const translatedSignature = translateLegacyHeatSourceSignature(
            sourceId,
            signature,
            unit,
            idTranslation,
        );
        // Preserve both witnesses if malformed legacy input aliases two old IDs to one current ID.
        const targetId = translatedSourceId !== sourceId
            && (original.has(translatedSourceId) || translated.has(translatedSourceId))
            ? sourceId
            : translatedSourceId;
        translated.set(targetId, translatedSignature);
        changed ||= targetId !== sourceId || translatedSignature !== signature;
    }
    return changed
        ? canonicalizeLegacyMekTurnStateV1({ ...turn, acknowledgedHeatSources: translated })
        : turn;
}

function translatePpcHeatSourceId(
    sourceId: string,
    unit: MekRestoreUnit,
    idTranslation: Readonly<Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>>,
): string {
    const prefix = 'ppc-capacitor:';
    if (!sourceId.startsWith(prefix)) return sourceId;
    const savedWeaponId = sourceId.slice(prefix.length);
    const currentWeaponId = translatedComponentId(savedWeaponId, unit, idTranslation);
    return currentWeaponId === savedWeaponId ? sourceId : `${prefix}${currentWeaponId}`;
}

function translateLegacyHeatSourceSignature(
    sourceId: string,
    signature: string,
    unit: MekRestoreUnit,
    idTranslation: Readonly<Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>>,
): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(signature);
    } catch {
        return signature;
    }
    if (!Array.isArray(parsed) || parsed.length !== 3) return signature;
    const translated = [...parsed];
    if (sourceId.startsWith('ppc-capacitor:') && typeof translated[1] === 'string') {
        translated[1] = translatedComponentId(translated[1], unit, idTranslation);
    }
    if (sourceId === 'damaged-engine' && typeof translated[2] === 'string') {
        translated[2] = translated[2].split('|')
            .map(savedSlotId => translatedCriticalSlotId(savedSlotId, unit, idTranslation))
            .join('|');
    }
    const result = JSON.stringify(translated);
    return result === signature ? signature : result;
}

function translatedComponentId(
    savedId: string,
    unit: MekRestoreUnit,
    idTranslation: Readonly<Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>>,
): string {
    if (unit.index.components.has(savedId as ComponentId)) return savedId;
    const translated = idTranslation[savedId];
    return translated !== undefined && unit.index.components.has(translated as ComponentId)
        ? translated
        : savedId;
}

function translatedCriticalSlotId(
    savedId: string,
    unit: MekRestoreUnit,
    idTranslation: Readonly<Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>>,
): string {
    if (unit.index.slots.has(savedId as CriticalSlotId)) return savedId;
    const translated = idTranslation[savedId];
    return translated !== undefined && unit.index.slots.has(translated as CriticalSlotId)
        ? translated
        : savedId;
}

function criticalCoordinate(raw: JsonObject, unit: MekRestoreUnit) {
    const code = string(raw['loc']);
    const slotIndex = integer(raw['slot']);
    if (!code || slotIndex === null || slotIndex < 0) return null;
    const location = [...unit.index.locations.values()].find(candidate => candidate.code === code);
    if (!location) return null;
    const slot = [...unit.index.slots.values()].find(candidate =>
        candidate.locationId === location.id && candidate.slotIndex === slotIndex,
    );
    return slot ? { ...slot, locationCode: code } : null;
}

function semanticSystemTarget(raw: JsonObject, unit: MekRestoreUnit) {
    const name = expectedEquipmentName(raw);
    if (!name) return null;
    const normalized = normalizeEquipmentName(name);
    const candidates = [...unit.index.components.entries()].flatMap(([id, component]) =>
        component.kind === 'system' && normalizeEquipmentName(component.systemType) === normalized
            ? [{ id, system: component.systemType }]
            : [],
    );
    return candidates.length === 1 ? candidates[0] : null;
}

function restoreCriticalAmmo(
    raw: JsonObject,
    slotId: CriticalSlotId,
    unit: MekRestoreUnit,
    ammo: Map<ComponentId, AmmoRuntimeState>,
    criticalAmmoConsumption: Map<ComponentId, number | null>,
    warnings: string[],
): void {
    const consumed = nonnegativeInteger(raw['consumed']);
    if (consumed === null) return;
    const slot = unit.index.slots.get(slotId)!;
    const candidates = slot.componentIds.filter(id =>
        mekAmmoCapacity(unit.entity, unit.index, id, unit.ruleset) !== null);
    if (candidates.length !== 1 && consumed === 0) return;
    // V1 exposes one consumption counter for identical bins sharing a
    // superheavy slot. Distribute that total in the entity's stable mount order.
    const firstBin = unit.index.components.get(candidates[0]);
    if (candidates.length > 1 && firstBin?.kind === 'equipment'
        && firstBin.mount.equipment instanceof AmmoEquipment
        && candidates.every(id => {
            const candidate = unit.index.components.get(id);
            return candidate?.kind === 'equipment'
                && candidate.mount.equipment?.id === firstBin.mount.equipment!.id;
        })) {
        let remaining = consumed;
        for (const id of candidates) {
            const capacity = mekAmmoCapacity(unit.entity, unit.index, id, unit.ruleset)!;
            const shotsSpent = Math.min(remaining, capacity);
            ammo.set(id, { shotsSpent });
            remaining -= shotsSpent;
        }
        if (remaining > 0) warnings.push('Critical-slot ammunition consumption exceeded current capacity');
        return;
    }
    if (candidates.length === 1) {
        const componentId = candidates[0];
        const capacity = mekAmmoCapacity(unit.entity, unit.index, componentId, unit.ruleset)!;
        const shotsSpent = Math.min(consumed, capacity);
        if (shotsSpent !== consumed) warnings.push('Critical-slot ammunition consumption exceeded current capacity');
        if (mekIntrinsicMagazine(unit.entity, unit.index, componentId, unit.ruleset) === null) {
            ammo.set(componentId, { shotsSpent });
            return;
        }
        if (!isFirstComponentCritical(unit, componentId, slotId)) {
            warnings.push('One-shot ammunition consumption outside the weapon first critical slot was skipped');
            return;
        }
        const current = criticalAmmoConsumption.get(componentId);
        if (current === undefined) {
            ammo.set(componentId, { shotsSpent });
            criticalAmmoConsumption.set(componentId, shotsSpent);
            return;
        }
        if (current === shotsSpent) return;
        warnings.push('Conflicting duplicate first-critical one-shot ammunition consumption was skipped');
        ammo.delete(componentId);
        criticalAmmoConsumption.set(componentId, null);
    } else warnings.push('Ammo consumption has no unique bin at this coordinate');
}

function isFirstComponentCritical(
    unit: MekRestoreUnit,
    componentId: ComponentId,
    slotId: CriticalSlotId,
): boolean {
    const component = unit.index.components.get(componentId);
    if (component?.kind !== 'equipment' || component.mount.allocation.kind !== 'location') return false;
    const first = component.mount.allocation.placements?.[0];
    const slot = unit.index.slots.get(slotId);
    return first !== undefined
        && slot !== undefined
        && unit.index.locations.get(slot.locationId)?.code === first.location
        && first.slotIndex === slot.slotIndex;
}

function restoreLegacyIntrinsicAmmoState(
    states: readonly JsonValue[],
    unit: MekRestoreUnit,
    componentId: ComponentId,
): { readonly munitionOverride?: string; readonly unknownStates: readonly JsonValue[] } {
    if (mekIntrinsicMagazine(unit.entity, unit.index, componentId, unit.ruleset) === null) {
        return { unknownStates: states };
    }
    const entries = states.filter(item =>
        recordObject(item)?.['name'] === INTRINSIC_ONE_SHOT_AMMO_STATE);
    if (entries.length !== 1) return { unknownStates: states };
    const munitionKey = recordObject(entries[0])?.['value'];
    const defaultMunitionKey = mekAmmoDefaultMunitionKey(unit.entity, unit.index, componentId);
    if (typeof munitionKey !== 'string'
        || munitionKey === defaultMunitionKey
        || mekAmmoLoadout(unit.entity, unit.index, componentId, unit.ruleset, munitionKey) === null) {
        return { unknownStates: states };
    }
    return {
        munitionOverride: munitionKey,
        unknownStates: states.filter(item => item !== entries[0]),
    };
}

function restoreLocations(
    raw: JsonValue | undefined,
    unit: MekRestoreUnit,
    locations: Map<LocationId, LocationRuntimeState>,
    components: Map<ComponentId, ComponentRuntimeState>,
    pendingInternal: Map<LocationId, number>,
    pendingArmor: Map<ArmorFaceId, number>,
    pendingShieldDamage: Map<ComponentId, MekShieldDamageRuntimeState>,
    pendingConditions: Map<LocationId, Map<MekLocationConditionKey, number>>,
    warnings: string[],
    idTranslation: Record<string, ComponentId | CriticalSlotId | LocationId | ArmorFaceId>,
): void {
    if (raw === undefined) return;
    const records = recordObject(raw);
    if (!records) {
        warnings.push('Malformed legacy locations container was skipped');
        return;
    }
    for (const [savedCode, value] of Object.entries(records)) {
        const data = recordObject(value);
        if (!data) {
            warnings.push(`Malformed location ${savedCode}`);
            continue;
        }
        if (restoreLegacyShieldTrack(savedCode, data, unit, components, pendingShieldDamage, warnings)) continue;
        const rear = savedCode.endsWith('-rear');
        const code = rear ? savedCode.slice(0, -'-rear'.length) : savedCode;
        const location = [...unit.index.locations.values()].find(candidate => candidate.code === code);
        if (!location) {
            warnings.push(`Unknown location ${savedCode}`);
            continue;
        }
        const current = locations.get(location.id) ?? emptyLocationRuntimeState();
        const internal = nonnegativeInteger(data['internal']);
        if (data['internal'] !== undefined && internal === null) {
            warnings.push(`Malformed internal damage at ${savedCode} was skipped`);
        }
        const appliedInternal = internal === null
            ? current.internalDamage
            : Math.min(internal, location.internalPoints);
        if (internal !== null && appliedInternal !== internal) warnings.push(`${savedCode} internal damage exceeded current capacity`);
        const face = location.armorFaceIds
            .map(faceId => unit.index.armorFaces.get(faceId)!)
            .find(candidate => candidate.face === (rear ? 'rear' : 'front'));
        if (!face) {
            warnings.push(`Location ${savedCode} has no matching armor face`);
            continue;
        }
        const armor = nonnegativeInteger(data['armor']);
        if (data['armor'] !== undefined && armor === null) {
            warnings.push(`Malformed armor damage at ${savedCode} was skipped`);
        }
        const appliedArmor = armor === null ? null : Math.min(armor, face.maximumPoints);
        if (armor !== null && appliedArmor !== armor) warnings.push(`${savedCode} armor damage exceeded current capacity`);
        const armorDamage = new Map(current.armorDamage.map(entry => [entry.faceId, entry.damage]));
        if (appliedArmor !== null) {
            if (appliedArmor === 0) armorDamage.delete(face.id);
            else armorDamage.set(face.id, appliedArmor);
        }
        const nextLocation = {
            internalDamage: appliedInternal,
            armorDamage: [...armorDamage].map(([faceId, damage]) => ({ faceId, damage })),
            conditions: new ImmutableIndex(current.conditions),
        };
        if (nextLocation.internalDamage === 0
            && nextLocation.armorDamage.length === 0
            && nextLocation.conditions.size === 0) {
            locations.delete(location.id);
        } else {
            locations.set(location.id, nextLocation);
        }
        idTranslation[`location:${code}`] = location.id;
        idTranslation[`armor:${code}:${face.face}`] = face.id;
        const parsedPendingInternal = integer(data['pendingInternal']);
        const parsedPendingArmor = integer(data['pendingArmor']);
        if (data['pendingInternal'] !== undefined && parsedPendingInternal === null) {
            warnings.push(`Malformed pending internal damage at ${savedCode} was skipped`);
        }
        if (data['pendingArmor'] !== undefined && parsedPendingArmor === null) {
            warnings.push(`Malformed pending armor damage at ${savedCode} was skipped`);
        }
        const pendingI = parsedPendingInternal ?? 0;
        const pendingA = parsedPendingArmor ?? 0;
        if (pendingI !== 0) pendingInternal.set(location.id, pendingI);
        if (pendingA !== 0) pendingArmor.set(face.id, pendingA);
        restoreLegacyLocationConditions(
            data['conditions'], savedCode, rear, location.id, locations, pendingConditions, warnings,
        );
    }
    clearRestoredNarcFromPhysicallyDestroyedLocations(unit.index, locations, pendingConditions);
}

function restoreLegacyShieldTrack(
    savedCode: string,
    data: JsonObject,
    unit: MekRestoreUnit,
    components: Map<ComponentId, ComponentRuntimeState>,
    pendingShieldDamage: Map<ComponentId, MekShieldDamageRuntimeState>,
    warnings: string[],
): boolean {
    const match = /^(DA|DC)(LA|RA)$/u.exec(savedCode);
    if (!match) return false;

    const armCode = match[2];
    const candidates = [...unit.index.components.values()].filter(component =>
        component.kind === 'equipment'
        && isShieldEquipment(component.mount.equipment)
        && componentLocations(unit.index, component).some(locationId =>
            unit.index.locations.get(locationId)?.code === armCode));
    const component = candidates.length === 1 ? candidates[0] : undefined;
    const profile = component?.kind === 'equipment'
        ? resolveShieldProfile(component.mount.equipment)
        : undefined;
    if (!component || !profile) {
        warnings.push(`Legacy shield track ${savedCode} has no unique current physical shield`);
        return true;
    }

    const track = match[1] === 'DA' ? 'absorptionDamage' : 'capacityDamage';
    const maximum = match[1] === 'DA' ? profile.damageAbsorption : profile.damageCapacity;
    const current = components.get(component.id) ?? {};
    const currentDamage = current.shieldDamage ?? { absorptionDamage: 0, capacityDamage: 0 };
    const committed = nonnegativeInteger(data['armor']);
    if (data['armor'] !== undefined && committed === null) {
        warnings.push(`Malformed shield damage at ${savedCode} was skipped`);
    }
    const effectiveCommitted = committed === null ? currentDamage[track] : Math.min(committed, maximum);
    if (committed !== null && effectiveCommitted !== committed) warnings.push(`${savedCode} shield damage exceeded current capacity`);
    if (committed !== null) {
        setComponentShieldDamage(components, component.id, {
            ...currentDamage,
            [track]: effectiveCommitted,
        });
    }

    const pending = integer(data['pendingArmor']);
    if (data['pendingArmor'] !== undefined && pending === null) {
        warnings.push(`Malformed pending shield damage at ${savedCode} was skipped`);
    }
    if (pending !== null) {
        const effectivePending = Math.max(
            -effectiveCommitted,
            Math.min(pending, maximum - effectiveCommitted),
        );
        if (effectivePending !== pending) warnings.push(`${savedCode} pending shield damage exceeded current capacity`);
        const currentPending = pendingShieldDamage.get(component.id)
            ?? { absorptionDamage: 0, capacityDamage: 0 };
        const nextPending = Object.freeze({ ...currentPending, [track]: effectivePending });
        if (nextPending.absorptionDamage === 0 && nextPending.capacityDamage === 0) {
            pendingShieldDamage.delete(component.id);
        } else {
            pendingShieldDamage.set(component.id, nextPending);
        }
    }

    if (hasUnknownFields(data, new Set(['armor', 'pendingArmor']))) {
        warnings.push(`Legacy shield track ${savedCode} contains unsupported location state`);
    }
    return true;
}

function setComponentShieldDamage(
    components: Map<ComponentId, ComponentRuntimeState>,
    componentId: ComponentId,
    shieldDamage: MekShieldDamageRuntimeState,
): void {
    const current = components.get(componentId) ?? {};
    if (shieldDamage.absorptionDamage !== 0 || shieldDamage.capacityDamage !== 0) {
        components.set(componentId, Object.freeze({
            ...current,
            shieldDamage: Object.freeze(shieldDamage),
        }));
        return;
    }
    const { shieldDamage: _removed, ...remaining } = current;
    if (Object.keys(remaining).length === 0) components.delete(componentId);
    else components.set(componentId, Object.freeze(remaining));
}

function restoreLegacyLocationConditions(
    raw: JsonValue | undefined,
    savedCode: string,
    rear: boolean,
    locationId: LocationId,
    locations: Map<LocationId, LocationRuntimeState>,
    pendingConditions: Map<LocationId, Map<MekLocationConditionKey, number>>,
    warnings: string[],
): void {
    if (raw === undefined) return;
    if (!Array.isArray(raw)) {
        warnings.push(`Malformed location conditions for ${savedCode}`);
        return;
    }
    if (rear) {
        warnings.push(`Rear armor record ${savedCode} cannot own a stable location condition`);
        return;
    }

    const current = locations.get(locationId) ?? emptyLocationRuntimeState();
    const committed = new Map(current.conditions);
    const pending = new Map(pendingConditions.get(locationId) ?? []);
    for (const entry of raw) {
        const parsed = parseLegacyLocationCondition(entry);
        if (parsed.kind === 'unresolved') {
            warnings.push(`${parsed.reason} at ${savedCode}`);
            if (parsed.recognizedKey !== undefined) {
                committed.delete(parsed.recognizedKey);
                pending.delete(parsed.recognizedKey);
            }
            continue;
        }
        if (parsed.warning !== undefined) {
            warnings.push(`${parsed.warning} at ${savedCode}`);
        }
        if (parsed.pending) {
            committed.delete(parsed.key);
            pending.set(parsed.key, parsed.value);
        } else {
            pending.delete(parsed.key);
            committed.set(parsed.key, parsed.value);
        }
    }

    if (pending.size === 0) pendingConditions.delete(locationId);
    else pendingConditions.set(locationId, pending);
    if (current.internalDamage === 0 && current.armorDamage.length === 0 && committed.size === 0) {
        locations.delete(locationId);
    } else locations.set(locationId, Object.freeze({
        ...current,
        conditions: new ImmutableIndex(committed),
    }));
}

type ParsedLegacyLocationCondition =
    | {
        readonly kind: 'unresolved';
        readonly reason: string;
        readonly recognizedKey?: MekLocationConditionKey;
    }
    | {
        readonly kind: 'supported';
        readonly key: MekLocationConditionKey;
        readonly value: number;
        readonly pending: boolean;
        readonly warning?: string;
    };

function parseLegacyLocationCondition(raw: JsonValue): ParsedLegacyLocationCondition {
    if (typeof raw === 'string') {
        if (!isMekLocationConditionKey(raw)) {
            return { kind: 'unresolved', reason: `Unknown location condition ${raw}` };
        }
        if (raw === 'narc') {
            return {
                kind: 'unresolved',
                reason: 'Counted NARC condition has no positive integer value',
                recognizedKey: raw,
            };
        }
        return {
            kind: 'supported',
            key: raw,
            value: 1,
            pending: false,
        };
    }
    const record = recordObject(raw);
    if (!record) return { kind: 'unresolved', reason: 'Location condition is not a string or object' };
    const condition = record['key'];
    if (!isMekLocationConditionKey(condition)) {
        return { kind: 'unresolved', reason: `Unknown location condition ${String(condition)}` };
    }
    const value = record['value'];
    const pending = record['pending'] === true;
    const allowed = new Set(['key', 'value', 'pending']);
    const malformedMetadata = Object.keys(record).some(key => !allowed.has(key))
        || (record['pending'] !== undefined && typeof record['pending'] !== 'boolean')
        || (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)));

    if (condition === 'narc') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value)
            || value <= 0 || value > MAX_MEK_LOCATION_CONDITION_VALUE) {
            return {
                kind: 'unresolved',
                reason: 'Counted NARC condition requires a bounded positive integer value',
                recognizedKey: condition,
            };
        }
        return {
            kind: 'supported',
            key: condition,
            value,
            pending,
            ...(malformedMetadata ? { warning: 'Malformed legacy NARC metadata was skipped' } : {}),
        };
    }

    const discardedBooleanValue = value !== undefined;
    return {
        kind: 'supported',
        key: condition,
        value: 1,
        pending,
        ...(malformedMetadata || discardedBooleanValue
            ? { warning: 'Invalid boolean location-condition metadata was skipped' }
            : {}),
    };
}

function clearRestoredNarcFromPhysicallyDestroyedLocations(
    index: MekRuntimeIndex,
    locations: Map<LocationId, LocationRuntimeState>,
    pendingConditions: Map<LocationId, Map<MekLocationConditionKey, number>>,
): void {
    for (const [locationId, current] of [...locations]) {
        if (!isMekLocationPhysicallyDestroyed(index, locations, locationId)) continue;
        const committed = new Map(current.conditions);
        const pending = new Map(pendingConditions.get(locationId) ?? []);
        const committedChanged = committed.delete('narc');
        const pendingChanged = pending.delete('narc');
        if (!committedChanged && !pendingChanged) continue;
        if (pending.size === 0) pendingConditions.delete(locationId);
        else pendingConditions.set(locationId, pending);
        if (current.internalDamage === 0 && current.armorDamage.length === 0 && committed.size === 0) {
            locations.delete(locationId);
        } else locations.set(locationId, Object.freeze({
            ...current,
            conditions: new ImmutableIndex(committed),
        }));
    }
}

function emptyLocationRuntimeState(): LocationRuntimeState {
    return Object.freeze({
        internalDamage: 0,
        armorDamage: Object.freeze([]),
        conditions: new ImmutableIndex<MekLocationConditionKey, number>([]),
    });
}

interface MatchedInventoryComponent {
    readonly id: ComponentId;
    readonly equipmentKey: string;
}

function matchInventoryComponent(raw: JsonObject, unit: MekRestoreUnit): MatchedInventoryComponent | null {
    const id = string(raw['id']) ?? '';
    const evidence = parseLegacyInventoryId(id);
    const exact = unit.index.components.get(id as ComponentId);
    if (exact?.kind === 'equipment') return {
        id: exact.id,
        equipmentKey: exact.mount.equipment?.id ?? exact.mount.equipmentId,
    };
    const candidates = [...unit.index.components.values()].flatMap(component => {
        if (component.kind !== 'equipment') return [];
        const equipmentKey = component.mount.equipment?.id ?? component.mount.equipmentId;
        const names = [equipmentKey, component.mount.equipment?.name]
            .filter((item): item is string => !!item);
        if (evidence.equipment
            && !names.some(name => equipmentNamesMatch(evidence.equipment!, name))) return [];
        if (evidence.location && !componentLocations(unit.index, component).some(locationId =>
            unit.index.locations.get(locationId)?.code === evidence.location)) return [];
        return [{ id: component.id, equipmentKey }];
    });
    if (candidates.length > 1 && evidence.location && evidence.slotIndex !== undefined) {
        const slot = criticalCoordinate({ loc: evidence.location, slot: evidence.slotIndex }, unit);
        const atCoordinate = candidates.filter(candidate => slot?.componentIds.includes(candidate.id));
        return atCoordinate.length === 1 ? atCoordinate[0] : null;
    }
    return candidates.length === 1 ? candidates[0] : null;
}

function parseLegacyInventoryId(id: string): { equipment?: string; location?: string; slotIndex?: number } {
    const match = /^(.*?)@([^#]+)#([0-9]+)(?:\.[0-9]+)?$/u.exec(id);
    if (!match) return id ? { equipment: id } : {};
    return { equipment: match[1], location: match[2], slotIndex: Number(match[3]) };
}

function componentLocations(index: MekRuntimeIndex, component: MekIndexedComponent): readonly LocationId[] {
    if (component.kind === 'system') {
        return [...new Set(component.placements.map(item => item.locationId))];
    }
    const codes = new Set(component.mount.getOccupiedLocations());
    return [...index.locations.values()]
        .filter(location => codes.has(location.code))
        .map(location => location.id);
}

function slotOccupants(unit: MekRestoreUnit, slotId: CriticalSlotId): readonly string[] {
    const slot = unit.index.slots.get(slotId);
    if (!slot) return [];
    const location = unit.index.locations.get(slot.locationId)!;
    const sheetSlot = unit.entity.criticalSlotGrid().get(location.code)?.[slot.slotIndex];
    return [mekCriticalSlotLabel(sheetSlot, unit.entity), ...slot.componentIds.flatMap(id => {
        const component = unit.index.components.get(id);
        if (!component) return [];
        return component.kind === 'equipment'
            ? [component.mount.equipment?.id ?? component.mount.equipmentId,
                component.mount.equipment?.name ?? component.mount.equipmentId]
            : [component.systemType];
    })];
}

function expectedEquipmentName(raw: JsonObject): string | null {
    return string(raw['originalName']) ?? string(raw['name']) ?? string(raw['id'])?.split('@')[0] ?? null;
}

function equipmentNamesMatch(left: string, right: string): boolean {
    return normalizeEquipmentName(left) === normalizeEquipmentName(right);
}

function normalizeEquipmentName(value: string): string {
    return value.trim().toLowerCase().replace(/^(?:is|clan)/u, '').replace(/[^a-z0-9]+/gu, '');
}

function committedHits(raw: JsonObject, destroyedMarkerCapacity = 1): number {
    const hits = nonnegativeInteger(raw['hits']);
    if (hits !== null) return hits;
    return stateMarker(raw['destroyed']) ? destroyedMarkerCapacity : 0;
}

function disabledState(raw: JsonValue | undefined): boolean {
    return array(raw).some(item => {
        const state = recordObject(item);
        return state?.['name'] === 'disabled' && state['value'] === 'true';
    });
}

function stateMarker(raw: JsonValue | undefined): boolean {
    return raw === true || (typeof raw === 'number' && Number.isFinite(raw));
}

function restoreLegacyEscalatingFailureState(
    raw: JsonValue | undefined,
    profile: ComponentEscalatingFailureProfile | null,
): { readonly state?: EscalatingFailureRuntimeState; readonly unknownStates: readonly JsonValue[] } {
    const states = array(raw);
    const recognized = states.map(item => {
        const state = recordObject(item);
        return state?.['name'] === 'disabled' && state['value'] === 'true';
    });
    if (!profile) return { unknownStates: states.filter((_, index) => !recognized[index]) };
    const keys = legacyEscalatingFailureStateKeys(profile.kind);

    const sequenceIndexes = states.flatMap((item, index) =>
        recordObject(item)?.['name'] === keys.sequence ? [index] : []);
    const activeIndexes = states.flatMap((item, index) =>
        recordObject(item)?.['name'] === keys.active ? [index] : []);
    const sequenceIndex = sequenceIndexes.length === 1 ? sequenceIndexes[0] : -1;
    const sequence = sequenceIndex < 0
        ? null
        : legacyEscalatingFailureSequence(
            recordObject(states[sequenceIndex])?.['value'],
            profile.targets.length,
        );
    if (sequence === null) {
        return { unknownStates: states.filter((_, index) => !recognized[index]) };
    }
    recognized[sequenceIndex] = true;

    const activeIndex = activeIndexes.length === 1 ? activeIndexes[0] : -1;
    const active = activeIndex >= 0
        && recordObject(states[activeIndex])?.['value'] === 'true';
    if (active) recognized[activeIndex] = true;
    return {
        state: Object.freeze({ sequence, ...(active ? { active: true as const } : {}) }),
        unknownStates: states.filter((_, index) => !recognized[index]),
    };
}

function legacyEscalatingFailureStateKeys(
    kind: ComponentEscalatingFailureProfile['kind'],
): { readonly sequence: string; readonly active: string } {
    switch (kind) {
        case 'masc':
            return { sequence: 'masc', active: 'mascActive' };
        case 'radical-heat-sink':
            return { sequence: 'radicalHeatSink', active: 'radicalHeatSinkActive' };
        case 'blue-shield':
            return { sequence: 'blueShieldUses', active: 'blueShieldUsedThisTurn' };
        case 'risc-emergency-coolant-system':
            return {
                sequence: 'riscEmergencyCoolantSystem',
                active: 'riscEmergencyCoolantSystemActive',
            };
        case 'risc-viral-jammer':
            return { sequence: 'riscViralJammer', active: 'riscViralJammerActive' };
    }
}

function legacyEscalatingFailureSequence(
    value: JsonValue | undefined,
    maximum: number,
): EscalatingFailureRuntimeState['sequence'] | null {
    if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null;
    const sequence = Number(value);
    return Number.isSafeInteger(sequence) && sequence >= 1 && sequence <= maximum
        ? sequence
        : null;
}

function restoreLegacyPpcCapacitorState(
    states: readonly JsonValue[],
    weaponId: ComponentId | undefined,
): { readonly state?: PpcCapacitorRuntimeState; readonly unknownStates: readonly JsonValue[] } {
    if (weaponId === undefined) return { unknownStates: states };
    const chargeEntries = states.filter(item =>
        recordObject(item)?.['name'] === 'ppc_capacitor_state');
    const firedEntries = states.filter(item =>
        recordObject(item)?.['name'] === 'ppc_capacitor_fired');
    if (chargeEntries.length === 1 && firedEntries.length === 0) {
        const rawCharge = recordObject(chargeEntries[0])?.['value'];
        if (rawCharge !== PPC_CAPACITOR_CHARGING_STATE && rawCharge !== PPC_CAPACITOR_CHARGED_STATE) {
            return { unknownStates: states };
        }
        return {
            state: Object.freeze({ weaponId, chargeState: rawCharge }),
            unknownStates: states.filter(item => item !== chargeEntries[0]),
        };
    }
    if (firedEntries.length === 1 && chargeEntries.length === 0
        && recordObject(firedEntries[0])?.['value'] === '1') {
        return {
            state: Object.freeze({ weaponId, firedThisTurn: true }),
            unknownStates: states.filter(item => item !== firedEntries[0]),
        };
    }
    return { unknownStates: states };
}

function restoreLegacyBombastLaserState(
    states: readonly JsonValue[],
    supported: boolean,
): { readonly state?: BombastLaserRuntimeState; readonly unknownStates: readonly JsonValue[] } {
    if (!supported) return { unknownStates: states };
    const chargeEntries = states.filter(item =>
        recordObject(item)?.['name'] === 'bombast_laser_charge_state');
    const firedEntries = states.filter(item =>
        recordObject(item)?.['name'] === 'bombast_laser_fired');
    if (chargeEntries.length === 1 && firedEntries.length === 0) {
        const rawCharge = recordObject(chargeEntries[0])?.['value'];
        if (rawCharge !== BOMBAST_LASER_CHARGING_STATE
            && rawCharge !== BOMBAST_LASER_CHARGED_STATE) {
            return { unknownStates: states };
        }
        return {
            state: Object.freeze({ chargeState: rawCharge }),
            unknownStates: states.filter(item => item !== chargeEntries[0]),
        };
    }
    if (firedEntries.length === 1 && chargeEntries.length === 0
        && recordObject(firedEntries[0])?.['value'] === '1') {
        return {
            state: Object.freeze({ firedThisTurn: true }),
            unknownStates: states.filter(item => item !== firedEntries[0]),
        };
    }
    return { unknownStates: states };
}

function restoreLegacyC3EmergencyMasterState(
    states: readonly JsonValue[],
    supported: boolean,
): { readonly state?: C3EmergencyMasterRuntimeState; readonly unknownStates: readonly JsonValue[] } {
    if (!supported) return { unknownStates: states };
    const modeIndexes = states.flatMap((item, index) =>
        recordObject(item)?.['name'] === C3EM_MODE_STATE_KEY ? [index] : []);
    const turnsIndexes = states.flatMap((item, index) =>
        recordObject(item)?.['name'] === C3EM_OPERATING_TURNS_STATE_KEY ? [index] : []);
    const consumed = new Set<number>();
    let mode: C3EmergencyMasterRuntimeState['mode'];
    let operatingTurns: C3EmergencyMasterRuntimeState['operatingTurns'];

    if (modeIndexes.length === 1) {
        const value = recordObject(states[modeIndexes[0]])?.['value'];
        if (value === 'on' || value === 'off') {
            mode = value;
            consumed.add(modeIndexes[0]);
        }
    }
    if (turnsIndexes.length === 1) {
        const value = recordObject(states[turnsIndexes[0]])?.['value'];
        if (typeof value === 'string' && /^[1-7]$/u.test(value)) {
            operatingTurns = Number(value) as C3EmergencyMasterRuntimeState['operatingTurns'];
            consumed.add(turnsIndexes[0]);
        }
    }
    if (mode === undefined && operatingTurns === undefined) return { unknownStates: states };
    return {
        state: Object.freeze({
            ...(mode === undefined ? {} : { mode }),
            ...(operatingTurns === undefined ? {} : { operatingTurns }),
        }),
        unknownStates: states.filter((_, index) => !consumed.has(index)),
    };
}

function restoreLegacyGaussPowerState(
    states: readonly JsonValue[],
    supported: boolean,
): {
    readonly state?: Exclude<ComponentRuntimeState['gaussPower'], undefined>;
    readonly unknownStates: readonly JsonValue[];
} {
    if (!supported) return { unknownStates: states };
    const matches = states.flatMap((item, index) =>
        recordObject(item)?.['name'] === 'inventory_control_mode' ? [index] : []);
    if (matches.length !== 1) return { unknownStates: states };
    const index = matches[0]!;
    const value = recordObject(states[index])?.['value'];
    if (!isMekGaussPowerState(value)) return { unknownStates: states };
    return {
        ...(value === GAUSS_POWERED_UP ? {} : { state: value }),
        unknownStates: states.filter((_, position) => position !== index),
    };
}

function restoreLegacyMekRuleChecks(
    raw: JsonValue | undefined,
    unit: MekRestoreUnit,
    openedRevision: MekUnitRuntimeState['stateRevision'],
    output: Map<typeof MEK_TORSO_CRIPPLING_RULE_CHECK_KEY, MekRuleCheckStateV2>,
): boolean {
    const checks = recordObject(raw);
    if (!checks) return false;
    if (Object.keys(checks).length === 0) return true;
    if (Object.keys(checks).length !== 1) return false;
    const check = recordObject(checks[MEK_TORSO_CRIPPLING_RULE_CHECK_KEY]);
    if (!check
        || Object.keys(check).some(key => key !== 'token' && key !== 'trigger' && key !== 'status')
        || typeof check['token'] !== 'string'
        || !check['token']
        || typeof check['trigger'] !== 'string'
        || !check['trigger']
        || (check['status'] !== 'pending' && check['status'] !== 'success' && check['status'] !== 'failed')) {
        return false;
    }
    const matches = [...unit.index.locations.values()].filter(location =>
        location.code === check['trigger']);
    if (matches.length !== 1) return false;
    const triggerLocationId = matches[0]!.id;
    output.set(MEK_TORSO_CRIPPLING_RULE_CHECK_KEY, Object.freeze({
        token: createMekTorsoCripplingRuleCheckTokenV2(openedRevision, triggerLocationId),
        triggerLocationId,
        openedRevision,
        status: check['status'],
    }));
    return true;
}

function hasUnsupportedFamilyState(raw: JsonObject, includeRuleChecks = false): boolean {
    const known = new Set([
        'modified', 'destroyed', 'shutdown', 'conditions', 'crits', 'locations', 'heat', 'inventory', 'turnState',
        // The force converter owns crew assignment/runtime and encounter editor positions.
        'crew', 'c3Position',
        ...(includeRuleChecks ? ['ruleChecks'] : []),
    ]);
    return hasUnknownFields(raw, known);
}

function hasUnknownFields(raw: JsonObject, known: ReadonlySet<string>): boolean {
    return Object.keys(raw).some(key => !known.has(key));
}

function recordObject(value: JsonValue | undefined): JsonObject | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function array(value: JsonValue | undefined): readonly JsonValue[] {
    return Array.isArray(value) ? value : [];
}

function string(value: JsonValue | undefined): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function integer(value: JsonValue | undefined): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function nonnegativeInteger(value: JsonValue | undefined): number | null {
    const result = integer(value);
    return result !== null && result >= 0 ? result : null;
}

function legacyHeatValue(value: JsonValue | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
        && value >= 0 && value <= MAX_MEK_HEAT_VALUE_V2
        ? value
        : null;
}
