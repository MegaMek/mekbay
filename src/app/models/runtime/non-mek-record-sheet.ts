// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { VelocityRecordEntry } from '../aerospace-velocity-record.model';
import type { UnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import type { CBTRuleset } from '../cbt-ruleset.model';
import type { CrewMemberRuntimeState,CrewMemberState } from '../crew-member.model';
import type { BaseEntity } from '../entity/base-entity';
import type {
ArmorFaceId,
ComponentId,
CrewPositionId,
LocationId,
SystemDamageTrackId,
} from '../entity/entity-identifiers';
import type { BombLoad } from '../aerospace-bomb.model';
import type { EntityTechBase } from '../entity/types';
import { effectiveEntityPilotingSkill } from '../entity/utils/battle-value/skill-facts';
import { isInfantryEntity, isProtoMekEntity } from '../entity/utils/entity-type-guards';
import { protoMekMovement } from '../rules/protomek-runtime-rules';
import type { EquipmentStatus } from '../equipment-status.model';
import type { AeroRuntimeRulesProjection } from '../rules/aero-runtime-rules';
import {
projectConventionalInfantryCombat,
type ConventionalInfantryCombatProfile,
} from '../rules/conventional-infantry-combat-rules';
import type { SystemDamageKind } from '../rules/system-damage-rules';
import type { UnitConditionKey } from '../unit-condition.model';
import type { UnitType } from '../unit-summary.model';
import { crewSkillsForUnit } from '../unit-crew-policy';
import { entityAmmoLoadout } from './mek-ammo';
import { isCoolantPodEquipment } from './component-coolant-pod';
import type { NonMekRuntimeIndex } from './non-mek-runtime-index';
import type { NonMekUnitQueryPort,NonMekUnitRuntimeState } from './non-mek-unit-instance';
import { systemDamagePresentation } from './system-damage-presentation';
import type { UnitEditContext } from './unit-edit-context';
import { getMotiveModesByUnit, motiveModeFactsForEntity } from '../motiveModes.model';
import { nonMekAttackMovementModifier, nonMekMovementCalculation, projectNonMekEndTurnHeat, projectNonMekMovementCapabilities,type NonMekEndTurnHeatProjection } from './non-mek-unit-instance';
import type { HeatAutomationPolicy } from './cbt-unit-runtime';
import type { RecordSheetMovementSelection } from './record-sheet-movement';

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
        readonly displayName: string;
        readonly capacity: number;
        readonly remaining: number;
    }>;
}

export interface NonMekRecordSheetDamageTrack {
    readonly damageTrackId: SystemDamageTrackId;
    readonly system: SystemDamageKind;
    readonly stage?: number;
    readonly scope?: string;
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
    readonly gunnery: number;
    /** Null for conventional infantry that cannot make anti-'Mech attacks: their sheet has no skill to show. */
    readonly piloting: number | null;
    readonly state: CrewMemberRuntimeState;
    readonly effectiveState: CrewMemberState;
}

/** Detached display/edit projection of one non-Mek BaseEntity plus sparse runtime state. */
export interface NonMekRecordSheetSnapshot {
    readonly editContext: UnitEditContext;
    readonly infantry?: ConventionalInfantryCombatProfile;
    readonly entityUuid: UnitUuid;
    readonly stateRevision: number;
    readonly displayName: string;
    readonly unitType: UnitType;
    readonly subtype: string;
    readonly tonnage: number;
    readonly year: number;
    readonly techBase: EntityTechBase;
    readonly mixedTech?: boolean;
    readonly role: string;
    readonly movementType: string;
    readonly movementSelection: RecordSheetMovementSelection;
    readonly movement: Readonly<{
        readonly walk: number;
        readonly run: number;
        readonly maxRun: number;
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
    /** Carried bombs for the external stores boxes. */
    readonly bombs: readonly BombLoad[];
    /** Aerospace velocity record values. */
    readonly velocityRecord: readonly VelocityRecordEntry[];
    readonly destroyed: boolean;
    readonly heatPolicy: HeatAutomationPolicy;
    readonly heat: AeroRuntimeRulesProjection['heat'] & Readonly<{
        /** End-turn heat for aerospace units that track heat. */
        readonly projection: NonMekEndTurnHeatProjection | null;
    }>;
    readonly currentBattleValue: number;
    readonly pristineBattleValue: number;
    readonly locations: readonly NonMekRecordSheetLocation[];
    readonly components: readonly NonMekRecordSheetComponent[];
    readonly damageTracks: readonly NonMekRecordSheetDamageTrack[];
}

/** Reads destruction, conditions, statuses, crew and remaining values through the unit's query. */
export function projectNonMekRecordSheet(
    entity: BaseEntity,
    index: NonMekRuntimeIndex,
    state: NonMekUnitRuntimeState,
    ruleset: CBTRuleset,
    query: NonMekUnitQueryPort,
    currentBattleValue: number,
    pristineBattleValue: number,
    heatPolicy: HeatAutomationPolicy = 'manual',
): Omit<NonMekRecordSheetSnapshot, 'editContext'> {
    if (entity.entityType === 'Mek') throw new Error('Meks require the Mek record-sheet projection');
    if (state.stateRevision !== query.stateRevision) {
        throw new Error('Record-sheet state and query revisions do not match');
    }
    const { vehicle: vehicleRules, protoMek: protoMekRules, aero: aeroRules } = query.projection();
    const crewAssignment = query.crewAssignment();

    const locations = [...index.locations.values()].map(location => {
        const armor = location.armorFaceIds.map(faceId => {
            const face = index.armorFaces.get(faceId);
            if (!face) throw new Error(`Non-Mek runtime is missing armor face ${faceId}`);
            return Object.freeze({
                faceId,
                locationId: location.id,
                face: face.face,
                maximum: face.maximumPoints,
                remaining: query.remainingArmor(faceId, 'committed'),
                previewRemaining: query.remainingArmor(faceId, 'preview'),
            });
        });
        return Object.freeze({
            locationId: location.id,
            code: location.code,
            sheetCode: entity.entityType === 'BattleArmor'
                ? location.code.replace('Trooper ', 'T')
                : entity.componentLocationLabel(location.code),
            ...(entity.entityType === 'BattleArmor' ? { combinedPips: true } : {}),
            ...(entity.entityType === 'Infantry' ? { soldierPips: true } : {}),
            maximumInternal: location.internalPoints,
            remainingInternal: query.remainingInternal(location.id, 'committed'),
            previewRemainingInternal: query.remainingInternal(location.id, 'preview'),
            armor: Object.freeze(armor),
        });
    });

    const components = [...index.components.values()].map(component => {
        const mount = component.mount;
        const loadout = entityAmmoLoadout(
            entity,
            mount,
            ruleset,
            state.ammo.get(component.id)?.munitionOverride,
        );
        return Object.freeze({
            componentId: component.id,
            equipmentId: mount.equipmentId,
            label: mount.displayName(),
            sheetLocations: Object.freeze(mount.getOccupiedLocations()
                .map(location => entity.componentLocationLabel(location))),
            status: query.componentStatus(component.id, 'committed'),
            previewStatus: query.componentStatus(component.id, 'preview'),
            // The printed ammunition profile; coolant pods are catalogued as ammunition but print as equipment.
            ...(loadout === null || isCoolantPodEquipment(mount.equipment) ? {} : {
                ammo: Object.freeze({
                    displayName: loadout.equipment.shortName || loadout.equipment.name,
                    capacity: loadout.capacity,
                    remaining: query.remainingAmmo(component.id),
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
            system: track.system,
            ...(track.stage === undefined ? {} : { stage: track.stage }),
            ...(track.scope === undefined ? {} : { scope: track.scope }),
            ...systemDamagePresentation(track),
            maximumHits: track.maximumHits,
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
            const assignment = crewAssignment.positions.find(candidate => candidate.positionId === position.id);
            const skills = crewSkillsForUnit(assignment, entity.unitType(), entity.unitSubtype());
            const member = query.crewState(position.id);
            const effectiveState = member.effectiveState();
            return Object.freeze({
                positionId: position.id,
                occurrence: position.occurrence,
                name: assignment?.name ?? '',
                gunnery: skills.gunnery,
                piloting: isInfantryEntity(entity) && !entity.canMakeAntiMekAttacks()
                    ? null
                    : effectiveEntityPilotingSkill(entity, skills.piloting),
                state: member.toRuntimeState(),
                effectiveState: effectiveState === 'dead'
                    ? 'killed'
                    : effectiveState === 'unconscious'
                        ? 'stunned'
                        : effectiveState,
            });
        });
    const destroyed = query.destroyed();
    const movementBlocked = destroyed || query.hasCondition('immobile');
    const capabilities = projectNonMekMovementCapabilities(entity, index, state, ruleset, crewAssignment);
    const movementCalculation = nonMekMovementCalculation(state);
    const protoMovement = protoMekRules && isProtoMekEntity(entity)
        ? protoMekMovement(entity, protoMekRules.criticalHits, entity.computeWalkMP(movementCalculation),
            entity.computeJumpMP(movementCalculation), movementCalculation.ignoreMyomerBooster)
        : null;
    const airborne = state.turn.airborne === true;
    const movementModes = getMotiveModesByUnit(motiveModeFactsForEntity(entity), airborne);
    return Object.freeze({
        entityUuid: entity.uuid(),
        ...(isInfantryEntity(entity) ? { infantry: projectConventionalInfantryCombat(entity) } : {}),
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
        movementSelection: Object.freeze({
            selectedMode: state.turn.movement?.mode ?? null,
            airborne,
            options: Object.freeze(movementModes.map(mode => ({
                mode, modifier: nonMekAttackMovementModifier(entity, mode),
                legal: capabilities.canTakeActiveActions
                    && (mode === 'stationary' || capabilities.maximum[mode] > 0),
                minimumMp: capabilities.minimum[mode],
            }))),
        }),
        movement: Object.freeze({
            walk: movementBlocked ? 0 : vehicleRules?.movement.walk ?? protoMovement?.walk
                ?? entity.computeWalkMP(movementCalculation),
            run: movementBlocked ? 0 : vehicleRules?.movement.run ?? protoMovement?.run
                ?? entity.computeRunMP(movementCalculation),
            maxRun: movementBlocked ? 0 : vehicleRules?.movement.maxRun ?? protoMovement?.run
                ?? entity.computeRunMP(movementCalculation),
            jump: movementBlocked ? 0 : protoMovement?.jump ?? entity.computeJumpMP(movementCalculation),
            umu: movementBlocked ? 0 : entity.umuMP(),
        }),
        armorType: armor?.armor.name ?? 'Patchwork',
        structureType: structure?.structure.name ?? '',
        crewSize: crew.length,
        crew: Object.freeze(crew),
        conditions: query.conditions(),
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
        bombs: state.bombs ?? Object.freeze([]),
        velocityRecord: state.velocityRecord ?? Object.freeze([]),
        destroyed,
        heatPolicy,
        heat: aeroRules ? Object.freeze({
            ...aeroRules.heat,
            projection: aeroRules.heat.tracked ? projectNonMekEndTurnHeat(entity, index, state, ruleset) : null,
        }) : Object.freeze({
            tracked: false,
            current: 0,
            pending: null,
            previous: 0,
            projection: null,
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
