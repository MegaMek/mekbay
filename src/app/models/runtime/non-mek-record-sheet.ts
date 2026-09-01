// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    SystemDamageTrackId,
    LocationId,
} from '../entity/entity-identifiers';
import type { BaseEntity } from '../entity/base-entity';
import {
    isAeroEntity,
    isInfantryFamilyEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../entity/utils/entity-type-guards';
import type { CBTRuleset } from '../cbt-ruleset.model';
import { STANDARD_MOVEMENT_CALCULATION, type EntityTechBase } from '../entity/types';
import type { UnitType } from '../unit-summary.model';
import type { CrewMemberState } from '../crew.model';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import {
    effectiveNonMekCrewState,
    type NonMekCrewRuntimeState,
    type NonMekUnitRuntimeState,
} from './non-mek-unit-instance';
import type { StateRevision } from './runtime-state';
import type { CrewAssignment } from './crew-assignment';
import { entityAmmoLoadout } from './mek-ammo';
import { projectVehicleRuntimeRules } from '../rules/vehicle-runtime-rules';
import { projectProtoMekRuntimeRules } from '../rules/protomek-runtime-rules';
import { projectInfantryRuntimeRules } from '../rules/infantry-runtime-rules';
import { projectAeroRuntimeRules, type AeroHeatEffects } from '../rules/aero-runtime-rules';
import { projectNonMekComponentStatuses } from './non-mek-component-status';
import type { UnitConditionKey } from '../unit-condition.model';
import { projectedNonMekAirGroundCondition } from './non-mek-airborne-state';

export interface NonMekRecordSheetArmorFace {
    readonly faceId: ArmorFaceId;
    readonly locationId: LocationId;
    readonly face: 'front' | 'rear';
    readonly maximum: number;
    readonly remaining: number;
    readonly previewRemaining: number;
}

export interface NonMekRecordSheetLocation {
    readonly locationId: LocationId;
    readonly code: string;
    readonly sheetCode: string;
    readonly combinedPips?: boolean;
    readonly soldierPips?: boolean;
    readonly maximumInternal: number;
    readonly remainingInternal: number;
    readonly previewRemainingInternal: number;
    readonly armor: readonly NonMekRecordSheetArmorFace[];
}

export interface NonMekRecordSheetComponent {
    readonly componentId: ComponentId;
    readonly equipmentId: string;
    readonly label: string;
    readonly sheetLocations: readonly string[];
    readonly status: EquipmentStatus;
    readonly previewStatus: EquipmentStatus;
    readonly ammo?: Readonly<{
        readonly capacity: number;
        readonly remaining: number;
    }>;
}

export interface NonMekRecordSheetDamageTrack {
    readonly damageTrackId: SystemDamageTrackId;
    readonly sheetId: string;
    readonly label: string;
    readonly maximumHits: number;
    readonly visibleHitPips?: number;
    readonly motiveLevel?: number;
    readonly committedHits: number;
    readonly previewHits: number;
    readonly committedHitTimestamps: readonly number[];
    readonly pendingHitTimestamps: readonly number[];
}

export interface NonMekRecordSheetCrewPosition {
    readonly positionId: CrewPositionId;
    readonly occurrence: number;
    readonly name: string;
    readonly role: string;
    readonly gunnery: number;
    readonly piloting: number;
    readonly state: NonMekCrewRuntimeState;
    readonly effectiveState: CrewMemberState;
}

/** Detached display/edit projection of one non-Mek BaseEntity plus sparse runtime state. */
export interface NonMekRecordSheetSnapshot {
    readonly entityUuid: string;
    readonly stateRevision: StateRevision;
    readonly displayName: string;
    readonly unitType: UnitType;
    readonly subtype: string;
    readonly tonnage: number;
    readonly year: number;
    readonly techBase: EntityTechBase;
    readonly mixedTech?: boolean;
    readonly role: string;
    readonly movementType: string;
    readonly movement: Readonly<{
        readonly walk: number;
        readonly run: number;
        readonly jump: number;
        readonly umu: number;
    }>;
    readonly armorType: string;
    readonly structureType: string;
    readonly crewSize: number;
    readonly crew: readonly NonMekRecordSheetCrewPosition[];
    readonly conditions: readonly UnitConditionKey[];
    readonly conditionControlKeys: readonly UnitConditionKey[];
    readonly crewStateControlKeys: readonly CrewMemberState[];
    readonly crewStateDisplayKeys: readonly CrewMemberState[];
    readonly destroyed: boolean;
    readonly heat: Readonly<{
        readonly tracked: boolean;
        readonly current: number;
        readonly pending: number | null;
        readonly heatsinksOff: number;
        readonly heatSinkCount: number;
        readonly dissipation: number;
        readonly effects: AeroHeatEffects;
    }>;
    readonly currentBattleValue: number;
    readonly pristineBattleValue: number;
    readonly locations: readonly NonMekRecordSheetLocation[];
    readonly components: readonly NonMekRecordSheetComponent[];
    readonly damageTracks: readonly NonMekRecordSheetDamageTrack[];
}

export function projectNonMekRecordSheet(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
    currentBattleValue: number,
    pristineBattleValue: number,
    crewAssignment?: CrewAssignment,
): NonMekRecordSheetSnapshot {
    if (entity.entityType === 'Mek') throw new Error('Meks require the Mek record-sheet projection');
    const vehicleRules = isVehicleEntity(entity)
        ? projectVehicleRuntimeRules(entity, index, state, ruleset)
        : null;
    const protoMekRules = isProtoMekEntity(entity)
        ? projectProtoMekRuntimeRules(entity, index, state, ruleset)
        : null;
    const infantryRules = isInfantryFamilyEntity(entity)
        ? projectInfantryRuntimeRules(entity, index, state)
        : null;
    const aeroRules = isAeroEntity(entity)
        ? projectAeroRuntimeRules(entity, index, state, ruleset)
        : null;
    const entityComponentStatuses = projectNonMekComponentStatuses(index, state);

    const locations = [...index.locations.values()].map(location => {
        const locationState = state.locations.get(location.id);
        const internalDamage = locationState?.internalDamage ?? 0;
        const pendingInternal = state.pendingCombat.locationInternalDamage.get(location.id) ?? 0;
        const armor = location.armorFaceIds.map(faceId => {
            const face = index.armorFaces.get(faceId);
            if (!face) throw new Error(`Non-Mek runtime is missing armor face ${faceId}`);
            const damage = locationState?.armorDamage.find(row => row.faceId === faceId)?.damage ?? 0;
            const pendingDamage = state.pendingCombat.armorDamage.get(faceId) ?? 0;
            return Object.freeze({
                faceId,
                locationId: location.id,
                face: face.face,
                maximum: face.maximumPoints,
                remaining: face.maximumPoints - damage,
                previewRemaining: face.maximumPoints - clamp(damage + pendingDamage, 0, face.maximumPoints),
            });
        });
        return Object.freeze({
            locationId: location.id,
            code: location.code,
            sheetCode: location.sheetCode ?? '',
            ...(location.combinedPips === true ? { combinedPips: true } : {}),
            ...(location.soldierPips === true ? { soldierPips: true } : {}),
            maximumInternal: location.internalPoints,
            remainingInternal: location.internalPoints - internalDamage,
            previewRemainingInternal: location.internalPoints
                - clamp(internalDamage + pendingInternal, 0, location.internalPoints),
            armor: Object.freeze(armor),
        });
    });

    const components = [...index.components.values()].map(component => {
        const mount = component.mount;
        const status = vehicleRules?.componentStatuses.get(component.id)
            ?? entityComponentStatuses.committed.get(component.id)
            ?? 'available';
        const previewStatus = vehicleRules?.previewComponentStatuses.get(component.id)
            ?? entityComponentStatuses.preview.get(component.id)
            ?? status;
        const runtimeAmmo = state.ammo.get(component.id);
        const loadout = entityAmmoLoadout(
            entity,
            mount,
            ruleset,
            runtimeAmmo?.munitionOverride,
        );
        return Object.freeze({
            componentId: component.id,
            equipmentId: mount.equipmentId,
            label: mount.displayName(),
            sheetLocations: Object.freeze(mount.getOccupiedLocations()
                .map(location => entity.componentLocationLabel(location))),
            status,
            previewStatus,
            ...(loadout === null ? {} : {
                ammo: Object.freeze({
                    capacity: loadout.capacity,
                    remaining: Math.max(0, loadout.capacity - (runtimeAmmo?.shotsSpent ?? 0)),
                }),
            }),
        });
    });

    const damageTracks = [...index.damageTracks.values()].map(track => {
        const committed = state.damageTracks.get(track.id);
        const pending = state.pendingCombat.damageTrackHits.get(track.id);
        const committedHits = committed?.hits ?? 0;
        return Object.freeze({
            damageTrackId: track.id,
            sheetId: track.sheetId,
            label: track.label,
            maximumHits: track.maximumHits,
            ...(track.visibleHitPips === undefined ? {} : { visibleHitPips: track.visibleHitPips }),
            ...(track.motiveLevel === undefined ? {} : { motiveLevel: track.motiveLevel }),
            committedHits,
            previewHits: committedHits + (pending?.hitDelta ?? 0),
            committedHitTimestamps: Object.freeze([...(committed?.hitTimestamps ?? [])]),
            pendingHitTimestamps: Object.freeze([...(pending?.hitTimestamps ?? [])]),
        });
    });

    const armor = entity.uniformArmor();
    const structure = entity.uniformStructureMaterial();
    const crew = [...index.crewPositions.values()]
        .sort((left, right) => left.occurrence - right.occurrence)
        .map(position => {
            const runtimeState = state.crew.get(position.id);
            const assignment = crewAssignment?.positions.find(candidate => candidate.positionId === position.id);
            const crewState = Object.freeze(runtimeState === undefined
                ? { wounds: 0, unconscious: false, ejected: false }
                : { ...runtimeState });
            const effectiveState = effectiveNonMekCrewState(runtimeState);
            return Object.freeze({
                positionId: position.id,
                occurrence: position.occurrence,
                name: assignment?.name ?? '',
                role: assignment?.role ?? '',
                gunnery: assignment?.gunnery ?? 4,
                piloting: assignment?.piloting ?? 5,
                state: crewState,
                effectiveState: vehicleRules && effectiveState === 'dead'
                    ? 'killed'
                    : effectiveState,
            });
        });
    const conditions = new Set(state.conditions);
    vehicleRules?.computedConditions.forEach(condition => conditions.add(condition));
    protoMekRules?.computedConditions.forEach(condition => conditions.add(condition));
    aeroRules?.computedConditions.forEach(condition => conditions.add(condition));
    conditions.delete('airborne');
    conditions.delete('grounded');
    const airGroundCondition = projectedNonMekAirGroundCondition(entity, state.turn.airborne);
    if (airGroundCondition !== null) conditions.add(airGroundCondition);
    const destroyed = vehicleRules?.destroyed
        ?? protoMekRules?.destroyed
        ?? infantryRules?.destroyed
        ?? aeroRules?.destroyed
        ?? state.explicitlyDestroyed;
    const movementBlocked = destroyed
        || protoMekRules?.computedConditions.includes('immobile') === true
        || state.conditions.has('immobile');
    return Object.freeze({
        entityUuid: entity.uuid(),
        stateRevision: state.stateRevision,
        displayName: entity.displayName(),
        unitType: entity.unitType(),
        subtype: entity.unitSubtype(),
        tonnage: entity.tonnage(),
        year: entity.year(),
        techBase: entity.techBase(),
        mixedTech: entity.mixedTech(),
        role: entity.role(),
        movementType: entity.getMotiveTypeAsString() ?? '',
        movement: Object.freeze({
            walk: movementBlocked ? 0 : vehicleRules?.movement.walk
                ?? entity.computeWalkMP(STANDARD_MOVEMENT_CALCULATION),
            run: movementBlocked ? 0 : vehicleRules?.movement.maxRun
                ?? entity.computeRunMP(STANDARD_MOVEMENT_CALCULATION),
            jump: movementBlocked ? 0 : entity.computeJumpMP(STANDARD_MOVEMENT_CALCULATION),
            umu: movementBlocked ? 0 : entity.umuMP(),
        }),
        armorType: armor?.armor.name ?? 'Patchwork',
        structureType: structure?.structure.name ?? '',
        crewSize: index.crewPositions.size,
        crew: Object.freeze(crew),
        conditions: Object.freeze([...conditions]),
        conditionControlKeys: vehicleRules?.conditionControlKeys
            ?? protoMekRules?.conditionControlKeys
            ?? aeroRules?.conditionControlKeys
            ?? Object.freeze([]),
        crewStateControlKeys: vehicleRules?.crewStateControlKeys
            ?? protoMekRules?.crewStateControlKeys
            ?? aeroRules?.crewStateControlKeys
            ?? Object.freeze([]),
        crewStateDisplayKeys: vehicleRules?.crewStateDisplayKeys
            ?? protoMekRules?.crewStateDisplayKeys
            ?? aeroRules?.crewStateDisplayKeys
            ?? Object.freeze([]),
        destroyed,
        heat: aeroRules?.heat ?? Object.freeze({
            tracked: false,
            current: 0,
            pending: null,
            heatsinksOff: 0,
            heatSinkCount: 0,
            dissipation: 0,
            effects: Object.freeze({ fireModifier: 0 }),
        }),
        currentBattleValue,
        pristineBattleValue,
        locations: Object.freeze(locations),
        components: Object.freeze(components),
        damageTracks: Object.freeze(damageTracks),
    });
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}
