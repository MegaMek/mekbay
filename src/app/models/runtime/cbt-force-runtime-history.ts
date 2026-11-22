// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { elevationAt } from '../elevation-record.model';
import { type CBTMekUnit } from './cbt-unit';
import { systemDamagePresentation } from './system-damage-presentation';
import type { CBTUnitCommand } from './unit-command';

import { jsonValuesEqual } from '../../utils/json-value.util';
import type { MotiveModes } from '../motiveModes.model';
import type { JsonValue } from '../persisted-unit-state';
import { isCBTMekUnit,isCBTNonMekUnit,type CBTUnit } from './cbt-unit';
import { createSavedTargetRef,parseSavedTargetRef,type SerializedCBTUnitV2 } from './persistence-v2';
import {
type AmmoRuntimeState,
type MekLocationConditionKey,
type MekUnitRuntimeState,
} from './runtime-state';

import { hasMekRuntime,hasNonMekRuntime,type CBTUnitSnapshot } from '../cbt-unit-snapshot';
import type {
ArmorFaceId,
ComponentId,
CrewPositionId,
CriticalSlotId,
LocationId,
SystemDamageTrackId,
} from '../entity/entity-identifiers';
import { getMekLocationLabel } from '../entity/types/mek';
import { isInfantryEntity } from '../entity/utils/entity-type-guards';
import { platoonAttackLabel } from '../rules/conventional-infantry-combat-rules';
import { nextHeat } from './cbt-unit-runtime';
import { outsideHeatThisTurn } from '../rules/inferno-rules';

import { CrewMember,type CrewMemberRuntimeState } from '../crew-member.model';
import { serializeUnitCover } from '../unit-cover.model';
import type { CrewAssignment } from './crew-assignment';
import type { EquipmentRowOrderState } from './equipment-row-order';
import { entityAmmoLoadout,mekAmmoLoadout } from './mek-ammo';
import { isSerializedNonMekUnit,type SerializedNonMekUnit } from './non-mek-unit-persistence';
import {
RUNTIME_HISTORY_MESSAGE,
type RuntimeHistoryEventInput,
type RuntimeHistoryTargetKind,
type SerializedRuntimeHistory,
type SerializedRuntimeHistoryMessage,
} from './runtime-history';
import { CBT_HISTORY_FIELD, CBT_HISTORY_TURN_FIELD } from './force-storage-vocabulary';

interface MekHistoryUnitAccess {
    instanceIds(): readonly string[];
    mekUnit(instanceId: string): CBTMekUnit | null;
}

export function unitHistory(
    messageId: RuntimeHistoryEventInput['messageId'],
    instanceId: string,
    ...data: JsonValue[]
): RuntimeHistoryEventInput {
    return Object.freeze({ messageId, data: Object.freeze([instanceId, ...data]) });
}

export function forceHistory(
    messageId: RuntimeHistoryEventInput['messageId'],
    ...data: JsonValue[]
): RuntimeHistoryEventInput {
    return Object.freeze({ messageId, ...(data.length === 0 ? {} : { data: Object.freeze(data) }) });
}

/**
 * History names a component or a 'Mek's critical slot by an ID or slot coordinate that it reads against the unit's
 * current design. Once a unit's source has changed, that ID or coordinate may hold other equipment, so each such
 * message of the unit becomes a plain "Updated equipment"; its location damage, and a non-'Mek's critical hits, which
 * name its system damage tracks, stay as they were.
 */
export function anonymizeSourceChangedEquipmentHistory(
    history: SerializedRuntimeHistory,
    units: ReadonlyMap<string, CBTUnit>,
    changedInstanceIds: ReadonlySet<string>,
): SerializedRuntimeHistory {
    if (changedInstanceIds.size === 0) return history;
    const unitIds = history[CBT_HISTORY_FIELD.unitIds];
    const namesEquipment = (message: SerializedRuntimeHistoryMessage, instanceId: string): boolean => {
        switch (message[0]) {
            case RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS:
            case RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED:
            case RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED:
            case RUNTIME_HISTORY_MESSAGE.AMMO_LOADOUT_RESET:
                return true;
            case RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL:
            case RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL:
                return isCBTMekUnit(units.get(instanceId)!);
            default:
                return false;
        }
    };
    const anonymized = (message: SerializedRuntimeHistoryMessage): SerializedRuntimeHistoryMessage => {
        const instanceId = typeof message[1] === 'number' ? unitIds[message[1]] : undefined;
        return instanceId !== undefined && changedInstanceIds.has(instanceId) && namesEquipment(message, instanceId)
            ? Object.freeze([RUNTIME_HISTORY_MESSAGE.EQUIPMENT_CHANGED, message[1]!])
            : message;
    };
    return Object.freeze({
        ...history,
        [CBT_HISTORY_FIELD.turns]: Object.freeze(history[CBT_HISTORY_FIELD.turns].map(turn => Object.freeze({
            ...turn,
            [CBT_HISTORY_TURN_FIELD.phases]: Object.freeze(turn[CBT_HISTORY_TURN_FIELD.phases]
                .map(phase => Object.freeze(phase.map(anonymized)))),
        }))),
    });
}

export type RuntimeHistoryInput = RuntimeHistoryEventInput
    | readonly RuntimeHistoryEventInput[]
    | undefined;

function armorHistoryTarget(unit: CBTUnit, faceId: ArmorFaceId): string {
    const index = unit.getIndex();
    const face = index.armorFaces.get(faceId);
    const location = face === undefined ? undefined : index.locations.get(face.locationId);
    return face === undefined || location === undefined
        ? faceId
        : createSavedTargetRef(
            'location',
            location.code.toLowerCase(),
            face.face === 'rear' ? 'rear-armor' : 'front-armor',
        );
}

function internalHistoryTarget(unit: CBTUnit, locationId: LocationId): string {
    const location = unit.getIndex().locations.get(locationId);
    return location === undefined
        ? locationId
        : createSavedTargetRef('location', location.code.toLowerCase(), 'internal');
}

function criticalHistoryTarget(unit: CBTUnit, criticalId: CriticalSlotId): string {
    if (!isCBTMekUnit(unit)) return criticalId;
    const slot = unit.getIndex().slots.get(criticalId);
    const location = slot === undefined ? undefined : unit.getIndex().locations.get(slot.locationId);
    return slot === undefined || location === undefined
        ? criticalId
        : createSavedTargetRef('slot', `${location.code.toLowerCase()}:${slot.slotIndex}`);
}

function componentHistoryTarget(componentId: ComponentId): string {
    return createSavedTargetRef('component', componentId);
}

function crewStateCode(unit: CBTUnit, state: CrewMemberRuntimeState): number {
    switch (CrewMember.from(state).effectiveState()) {
        case 'dead': return isCBTNonMekUnit(unit) ? 4 : 3;
        case 'ejected': return 2;
        case 'unconscious': return isCBTNonMekUnit(unit) ? 5 : 1;
        default: return 0;
    }
}

function crewRuntimeHistory(
    instanceId: string,
    unit: CBTUnit,
    positionId: CrewPositionId,
    before: CrewMemberRuntimeState,
    after: CrewMemberRuntimeState,
): RuntimeHistoryEventInput {
    const occurrence = unit.getIndex().crewPositions.get(positionId)?.occurrence ?? 0;
    return unitHistory(
        RUNTIME_HISTORY_MESSAGE.CREW_CHANGED,
        instanceId,
        occurrence,
        before.wounds,
        after.wounds,
        crewStateCode(unit, before),
        crewStateCode(unit, after),
    );
}

export function heatHistory(
    instanceId: string,
    before: Readonly<{
        readonly current: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
        readonly heatsinksOffNext?: number;
    }>,
    after: Readonly<{
        readonly current: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
        readonly heatsinksOffNext?: number;
    }>,
): RuntimeHistoryEventInput | undefined {
    if (before.current !== after.current) {
        return unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 0, before.current, after.current);
    }
    // Switching heat sinks moves a NEXT that follows the calculated heat; the switch is what the player did.
    const switchOf = (heat: typeof before) => heat.heatsinksOffNext ?? heat.heatsinksOff;
    if (switchOf(before) !== switchOf(after)) {
        return unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 2, switchOf(before), switchOf(after));
    }
    const beforeTarget = nextHeat(before);
    const afterTarget = nextHeat(after);
    if (beforeTarget !== afterTarget) {
        return unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 1, beforeTarget, afterTarget);
    }
    return undefined;
}

/** The heat End Turn settled, logged beside the turn ending; none when it left the heat where it was. */
export function endTurnHeatHistory(
    instanceId: string,
    before: Parameters<typeof heatHistory>[1],
    after: Parameters<typeof heatHistory>[2],
): RuntimeHistoryEventInput | undefined {
    return before.current === after.current ? undefined : heatHistory(instanceId, before, after);
}

function mekLocationConditionHistoryValue(
    state: MekUnitRuntimeState,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    target: 'committed' | 'pending',
): number {
    const committed = state.locations.get(locationId)?.conditions.get(condition) ?? 0;
    return target === 'pending'
        ? state.pendingCombat.locationConditions.get(locationId)?.get(condition) ?? committed
        : committed;
}

function mekLocationConditionHistory(
    instanceId: string,
    unit: CBTUnit,
    before: MekUnitRuntimeState,
    after: MekUnitRuntimeState,
    locationId: LocationId,
    condition: MekLocationConditionKey,
    target: 'committed' | 'pending',
): RuntimeHistoryEventInput {
    return unitHistory(
        RUNTIME_HISTORY_MESSAGE.LOCATION_CONDITION_CHANGED,
        instanceId,
        internalHistoryTarget(unit, locationId),
        condition,
        mekLocationConditionHistoryValue(before, locationId, condition, target),
        mekLocationConditionHistoryValue(after, locationId, condition, target),
        target,
    );
}

export function crewProfileHistory(
    instanceId: string,
    unit: CBTUnit,
    before: CrewAssignment,
    after: CrewAssignment,
): readonly RuntimeHistoryEventInput[] {
    const beforeById = new Map(before.positions.map(position => [position.positionId, position] as const));
    const events: RuntimeHistoryEventInput[] = [];
    for (const position of after.positions) {
        const previous = beforeById.get(position.positionId);
        if (!previous) continue;
        const occurrence = unit.getIndex().crewPositions.get(position.positionId)?.occurrence ?? 0;
        for (const [field, code, standard] of [
            ['gunnery', 0, 4], ['piloting', 1, 5], ['aeroGunnery', 2, 4], ['aeroPiloting', 3, 5],
        ] as const) {
            const oldSkill = previous[field] ?? standard;
            const newSkill = position[field] ?? standard;
            if (oldSkill !== newSkill) events.push(unitHistory(
                RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED, instanceId, occurrence, code, oldSkill, newSkill,
            ));
        }
    }
    return Object.freeze(events);
}

function historyLocationByCode(unit: CBTUnit, code: string) {
    const normalized = code.toLowerCase();
    return [...unit.getIndex().locations.values()]
        .find(location => location.code.toLowerCase() === normalized);
}

function historyLocationLabel(unit: CBTUnit, locationId: LocationId): string {
    const code = unit.getIndex().locations.get(locationId)?.code;
    return code === undefined ? locationId : getMekLocationLabel(code) ?? code;
}

function historyComponentLabel(unit: CBTUnit, componentId: ComponentId): string {
    if (isCBTMekUnit(unit)) {
        const component = unit.getIndex().components.get(componentId);
        if (component?.kind === 'system') return component.systemType;
        return component?.mount.displayName() ?? componentId;
    }
    if (isCBTNonMekUnit(unit)) {
        const mount = unit.getIndex().components.get(componentId)?.mount;
        const entity = unit.getUnit();
        // A platoon's one attack is recorded on its primary weapon.
        if (mount?.platoonWeapon === 'primary' && isInfantryEntity(entity)) return platoonAttackLabel(entity);
        return mount?.displayName() ?? componentId;
    }
    return componentId;
}

function historyCriticalLabel(
    unit: CBTUnit,
    targetId: string,
): string {
    if (isCBTNonMekUnit(unit)) {
        const track = unit.getIndex().damageTracks.get(targetId as SystemDamageTrackId);
        return track === undefined ? targetId : systemDamagePresentation(track).label;
    }
    if (!isCBTMekUnit(unit)) return targetId;
    const slot = historyMekSlot(unit, targetId)
        ?? unit.getIndex().slots.get(targetId as CriticalSlotId);
    if (slot === undefined) return targetId;
    const componentLabels = [...new Set(slot.componentIds.map(componentId =>
        historyComponentLabel(unit, componentId)))];
    const component = componentLabels.join(' / ') || 'Critical slot';
    return `${component} at ${historyLocationLabel(unit, slot.locationId)} slot ${slot.slotIndex + 1}`;
}

function historyMekSlot(unit: CBTMekUnit, targetId: string) {
    const parsed = parseSavedTargetRef(targetId);
    if (parsed?.kind !== 'slot') return undefined;
    const coordinate = parsed.parts[0]!;
    const separator = coordinate.lastIndexOf(':');
    if (separator < 1) return undefined;
    const location = historyLocationByCode(unit, coordinate.slice(0, separator));
    const slotIndex = Number(coordinate.slice(separator + 1));
    if (location === undefined || !Number.isSafeInteger(slotIndex)) return undefined;
    return [...unit.getIndex().slots.values()].find(slot =>
        slot.locationId === location.id && slot.slotIndex === slotIndex);
}

export function historyTargetLabel(
    unit: CBTUnit,
    kind: RuntimeHistoryTargetKind,
    targetId: string,
): string {
    if (kind === 'critical') return historyCriticalLabel(unit, targetId);
    const parsed = parseSavedTargetRef(targetId);
    if (kind === 'component') {
        const componentId = parsed?.kind === 'component' || parsed?.kind === 'system'
            ? parsed.parts[0]!
            : targetId;
        return historyComponentLabel(unit, componentId as ComponentId);
    }
    if (parsed?.kind === 'location') {
        const location = historyLocationByCode(unit, parsed.parts[0]!);
        if (location === undefined) return targetId;
        const label = getMekLocationLabel(location.code) ?? location.code;
        const face = parsed.parts[1] === 'rear-armor' ? 'rear' : 'front';
        return kind === 'armor' && location.armorFaceIds.length > 1
            ? `${label} (${face})`
            : label;
    }
    if (kind === 'armor') {
        const face = unit.getIndex().armorFaces.get(targetId as ArmorFaceId);
        if (face === undefined) return targetId;
        const location = unit.getIndex().locations.get(face.locationId);
        const label = location === undefined
            ? face.locationId
            : getMekLocationLabel(location.code) ?? location.code;
        return location !== undefined && location.armorFaceIds.length > 1
            ? `${label} (${face.face})`
            : label;
    }
    return historyLocationLabel(unit, targetId as LocationId);
}

export function historyCrewLabel(unit: CBTUnit, occurrence: number): string {
    if (unit.getUnit().entityType === 'Mek' && occurrence === 0) return 'Pilot';
    return `Crew ${occurrence + 1}`;
}

function ammoLoadoutResetHistory(
    instanceId: string,
    unit: CBTUnit,
    before: ReadonlyMap<ComponentId, AmmoRuntimeState>,
    after: ReadonlyMap<ComponentId, AmmoRuntimeState>,
): RuntimeHistoryEventInput {
    const changes: JsonValue[] = [];
    for (const [componentId, previous] of before) {
        const current = after.get(componentId);
        if (previous.shotsSpent === (current?.shotsSpent ?? 0)
            && previous.munitionOverride === current?.munitionOverride) continue;
        const loadout = (munitionOverride?: string) => {
            if (isCBTMekUnit(unit)) {
                return mekAmmoLoadout(unit.getUnit(), unit.getIndex(), componentId, unit.ruleset(), munitionOverride);
            }
            if (isCBTNonMekUnit(unit)) {
                const component = unit.getIndex().components.get(componentId);
                return component === undefined ? null
                    : entityAmmoLoadout(unit.getUnit(), component.mount, unit.ruleset(), munitionOverride);
            }
            return null;
        };
        const previousLoadout = loadout(previous.munitionOverride);
        const currentLoadout = loadout(current?.munitionOverride);
        if (previousLoadout === null || currentLoadout === null) continue;
        changes.push([
            componentHistoryTarget(componentId),
            previousLoadout.munitionKey,
            previousLoadout.capacity - previous.shotsSpent,
            currentLoadout.munitionKey,
            currentLoadout.capacity - (current?.shotsSpent ?? 0),
        ]);
    }
    return unitHistory(RUNTIME_HISTORY_MESSAGE.AMMO_LOADOUT_RESET, instanceId, ...changes);
}

export function unitCommandHistory(
    instanceId: string,
    unit: CBTUnit,
    command: CBTUnitCommand,
    beforeSnapshot: CBTUnitSnapshot,
    afterSnapshot: CBTUnitSnapshot,
    modeChange?: Readonly<{ readonly before?: string; readonly after?: string }>,
): RuntimeHistoryInput {
    const before = beforeSnapshot.state;
    const after = afterSnapshot.state;
    if (hasNonMekRuntime(beforeSnapshot) && hasNonMekRuntime(afterSnapshot)
        && (command.type === 'set-movement' || command.type === 'set-airborne' || command.type === 'set-elevation')) {
        const events: RuntimeHistoryEventInput[] = [];
        const beforeElevation = elevationAt(beforeSnapshot.state.elevationRecord, beforeSnapshot.state.turn.turnCounter + 1);
        const afterElevation = elevationAt(afterSnapshot.state.elevationRecord, afterSnapshot.state.turn.turnCounter + 1);
        if (beforeElevation !== afterElevation) {
            events.push(unitHistory(RUNTIME_HISTORY_MESSAGE.ELEVATION_CHANGED, instanceId, beforeElevation, afterElevation));
        }
        const beforeMovement = beforeSnapshot.state.turn.movement;
        const afterMovement = afterSnapshot.state.turn.movement;
        if (beforeMovement?.mode !== afterMovement?.mode
            || beforeMovement?.distance !== afterMovement?.distance) {
            events.push(movementRuntimeHistory(instanceId, beforeMovement, afterMovement));
        }
        if (beforeSnapshot.state.turn.airborne !== afterSnapshot.state.turn.airborne) {
            events.push(unitHistory(
                RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED,
                instanceId,
                airborneHistoryCode(beforeSnapshot.state.turn.airborne),
                airborneHistoryCode(afterSnapshot.state.turn.airborne),
            ));
        }
        return events;
    }

    switch (command.type) {
        case 'damage-armor':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR, instanceId, armorHistoryTarget(unit, command.faceId), command.amount, command.target);
        case 'repair-armor':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR, instanceId, armorHistoryTarget(unit, command.faceId), command.amount, command.target);
        case 'damage-internal':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL, instanceId, internalHistoryTarget(unit, command.locationId), command.amount, command.target);
        case 'repair-internal':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_INTERNAL, instanceId, internalHistoryTarget(unit, command.locationId), command.amount, command.target);
        case 'damage-track':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL, instanceId, command.damageTrackId, command.amount, command.target);
        case 'repair-damage-track':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL, instanceId, command.damageTrackId, command.amount, command.target);
        case 'hit-critical':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL, instanceId, criticalHistoryTarget(unit, command.slotId), command.hits, command.target);
        case 'repair-critical':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL, instanceId, criticalHistoryTarget(unit, command.slotId), command.hits, command.target);
        case 'set-component-status':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS, instanceId, componentHistoryTarget(command.componentId), command.status, command.target);
        case 'set-component-statuses':
            return command.componentIds.map(id => unitHistory(RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS,
                instanceId, componentHistoryTarget(id), command.status, command.target));
        case 'hit-components': {
            const perspective = command.target === 'pending' ? 'preview' : 'committed';
            return command.componentIds.filter(id => beforeSnapshot.query.componentStatus(id, perspective) !== 'destroyed')
                .map(id => unitHistory(RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS, instanceId, componentHistoryTarget(id),
                    afterSnapshot.query.componentStatus(id, perspective) === 'destroyed' ? 'destroyed' : 'hit', command.target));
        }
        case 'set-component-mode':
            return componentModeHistory(instanceId, command.componentId, modeChange?.before, modeChange?.after);
        case 'apply-mek-blow-off':
            if (!hasMekRuntime(beforeSnapshot) || !hasMekRuntime(afterSnapshot)) return undefined;
            return mekLocationConditionHistory(
                instanceId,
                unit,
                beforeSnapshot.state,
                afterSnapshot.state,
                command.locationId,
                'blown-off',
                command.target,
            );
        case 'commit-pending':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED, instanceId);
        case 'end-phase':
            return hasMekRuntime(afterSnapshot) && afterSnapshot.state.movementPsr.checks.some(check => check.status === 'pending')
                ? undefined
                : unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED, instanceId);
        case 'mark-end-turn-heat-staged':
        case 'set-pending-fall-consequences':
        case 'set-consciousness-rolls-due':
        case 'set-control-recovery':
        // The attack that began or ended the swarm is what the log records.
        case 'set-swarming':
            return undefined;
        case 'cancel-pending':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED, instanceId);
        case 'end-turn': {
            const ended = unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_ENDED, instanceId);
            const heat = endTurnHeatHistory(instanceId, before.heat, after.heat);
            return heat === undefined ? ended : [heat, ended];
        }
        case 'set-condition':
            return unitHistory(
                RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED,
                instanceId,
                command.condition,
                before.conditions.has(command.condition),
                after.conditions.has(command.condition),
            );
        case 'set-location-condition':
            if (!hasMekRuntime(beforeSnapshot) || !hasMekRuntime(afterSnapshot)) return undefined;
            return mekLocationConditionHistory(
                instanceId,
                unit,
                beforeSnapshot.state,
                afterSnapshot.state,
                command.locationId,
                command.condition,
                command.target,
            );
        case 'set-crew-state':
            return crewRuntimeHistory(
                instanceId,
                unit,
                command.positionId,
                before.crew.get(command.positionId) ?? { wounds: 0, unconscious: false, ejected: false },
                after.crew.get(command.positionId) ?? { wounds: 0, unconscious: false, ejected: false },
            );
        case 'reset-ammo-loadout':
            return ammoLoadoutResetHistory(instanceId, unit, before.ammo, after.ammo);
        case 'configure-ammo-source':
        case 'spend-ammo':
        case 'activate-coolant-pod':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.AMMO_CHANGED, instanceId);
        case 'configure-bombs':
        case 'set-bombs-spent':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.BOMBS_CHANGED, instanceId);
        case 'set-velocity-record':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.VELOCITY_RECORD_CHANGED, instanceId);
        case 'complete-turn-step':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_STEP_COMPLETED, instanceId, command.step);
        case 'join-turn':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_JOINED, instanceId, command.turn);
        case 'rewind-turn-step':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_STEP_REWOUND, instanceId, command.step);
        case 'record-mek-physical-attack-checks':
            return unitHistory(
                RUNTIME_HISTORY_MESSAGE.PHYSICAL_ATTACK_CHECKS,
                instanceId,
                command.missedDeathFromAbove ? 1 : 0,
                ...command.checks,
            );
        case 'set-heat':
        case 'set-pending-heat':
        case 'set-heatsinks-off':
        case 'apply-heat':
            return heatHistory(instanceId, before.heat, after.heat);
        case 'declare-mek-movement':
        case 'clear-mek-movement':
            if (!hasMekRuntime(beforeSnapshot) || !hasMekRuntime(afterSnapshot)) return undefined;
            return movementRuntimeHistory(
                instanceId,
                beforeSnapshot.state.movementPsr.movement,
                afterSnapshot.state.movementPsr.movement,
            );
        case 'declare-mek-action': {
            const wasShutdown = before.conditions.has('shutdown') ? 1 : 0;
            const isShutdown = after.conditions.has('shutdown') ? 1 : 0;
            return wasShutdown === isShutdown
                ? undefined
                : unitHistory(
                    RUNTIME_HISTORY_MESSAGE.MEK_ACTION_CHANGED,
                    instanceId,
                    wasShutdown,
                    isShutdown,
                );
        }
        case 'clear-mek-action':
            return undefined;
        case 'replace-turn-state':
            return hasMekRuntime(beforeSnapshot) && hasMekRuntime(afterSnapshot)
                ? mekTurnStateHistory(instanceId, beforeSnapshot.state, afterSnapshot.state) : undefined;
        case 'add-inferno-missiles':
            return undefined;
        case 'add-outside-heat': {
            // Pending heat past the turn's cap changes nothing the player reads.
            const before = outsideHeatThisTurn(beforeSnapshot.state);
            const after = outsideHeatThisTurn(afterSnapshot.state);
            return before === after
                ? undefined
                : unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 3, before, after);
        }
        default:
            return unitHistory(RUNTIME_HISTORY_MESSAGE.UNIT_ACTION, instanceId, command.type);
    }
}

export function nonMekCommandBoundary(command: CBTUnitCommand): 'phase' | undefined {
    return command.type === 'end-phase' ? 'phase' : undefined;
}

function componentModeHistory(
    instanceId: string,
    componentId: ComponentId,
    before: string | undefined,
    after: string | undefined,
): RuntimeHistoryEventInput | undefined {
    return before === after
        ? undefined
        : unitHistory(
            RUNTIME_HISTORY_MESSAGE.COMPONENT_MODE_CHANGED,
            instanceId,
            componentHistoryTarget(componentId),
            before ?? null,
            after ?? null,
        );
}

function mekTurnStateHistory(
    instanceId: string,
    before: MekUnitRuntimeState,
    after: MekUnitRuntimeState,
): readonly RuntimeHistoryEventInput[] {
    const events: RuntimeHistoryEventInput[] = [];
    if (before.turn.airborne !== after.turn.airborne) {
        events.push(unitHistory(
            RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED,
            instanceId,
            airborneHistoryCode(before.turn.airborne),
            airborneHistoryCode(after.turn.airborne),
        ));
    }
    if (before.turn.spotting !== after.turn.spotting) {
        events.push(unitHistory(
            RUNTIME_HISTORY_MESSAGE.SPOTTING_CHANGED,
            instanceId,
            before.turn.spotting,
            after.turn.spotting,
        ));
    }
    if (before.turn.cover !== after.turn.cover) {
        events.push(unitHistory(
            RUNTIME_HISTORY_MESSAGE.COVER_CHANGED,
            instanceId,
            before.turn.cover === null ? 0 : serializeUnitCover(before.turn.cover),
            after.turn.cover === null ? 0 : serializeUnitCover(after.turn.cover),
        ));
    }
    return Object.freeze(events);
}

export function selectedWeaponFireHistory(
    instanceId: string,
    unit: CBTUnit,
): readonly RuntimeHistoryEventInput[] {
    const targeting = unit.captureRuntime().query.attackerTargetingState();
    return Object.freeze([...targeting.components]
        .filter(([, component]) => component.selection !== undefined)
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([componentId, component]) => unitHistory(
            RUNTIME_HISTORY_MESSAGE.WEAPONS_FIRED,
            instanceId,
            componentHistoryTarget(componentId),
            ...(component.ammo === undefined ? [] : [component.ammo.munitionKey]),
        )));
}

interface ComponentModeHistoryState {
    readonly instanceId: string;
    readonly componentId: ComponentId;
    readonly mode?: string;
}

export function captureMekComponentModes(
    authority: MekHistoryUnitAccess,
    instanceIds: readonly string[] = authority.instanceIds(),
): readonly ComponentModeHistoryState[] {
    const rows: ComponentModeHistoryState[] = [];
    for (const instanceId of instanceIds) {
        const unit = authority.mekUnit(instanceId);
        if (unit === null) continue;
        const query = unit.query();
        for (const componentId of unit.getIndex().components.keys()) {
            const mode = query.componentMode(componentId);
            rows.push(Object.freeze({
                instanceId,
                componentId,
                ...(mode === undefined ? {} : { mode }),
            }));
        }
    }
    return Object.freeze(rows);
}

export function changedComponentModeHistory(
    authority: MekHistoryUnitAccess,
    before: readonly ComponentModeHistoryState[],
): readonly RuntimeHistoryEventInput[] {
    const events: RuntimeHistoryEventInput[] = [];
    for (const row of before) {
        const after = authority.mekUnit(row.instanceId)
            ?.query().componentMode(row.componentId);
        const event = componentModeHistory(row.instanceId, row.componentId, row.mode, after);
        if (event !== undefined) events.push(event);
    }
    return Object.freeze(events);
}

function movementRuntimeHistory(
    instanceId: string,
    before: Readonly<{ readonly mode: MotiveModes; readonly distance: number }> | null | undefined,
    after: Readonly<{ readonly mode: MotiveModes; readonly distance: number }> | null | undefined,
): RuntimeHistoryEventInput {
    return unitHistory(
        RUNTIME_HISTORY_MESSAGE.MOVEMENT_CHANGED,
        instanceId,
        movementModeHistoryCode(before?.mode ?? null),
        before?.distance ?? 0,
        movementModeHistoryCode(after?.mode ?? null),
        after?.distance ?? 0,
    );
}

function movementModeHistoryCode(mode: MotiveModes | null): number {
    switch (mode) {
        case 'stationary': return 1;
        case 'walk': return 2;
        case 'run': return 3;
        case 'jump': return 4;
        case 'UMU': return 5;
        case 'VTOL': return 6;
        case 'sprint': return 7;
        case 'tracked': return 8;
        default: return 0;
    }
}

function airborneHistoryCode(value: boolean | null): number {
    return value === null ? -1 : value ? 1 : 0;
}

export function mekCommandBoundary(
    command: CBTUnitCommand,
    after: MekUnitRuntimeState,
): 'phase' | undefined {
    if (command.type !== 'end-phase' && command.type !== 'commit-pending') return undefined;
    return after.movementPsr.checks.some(check => check.status === 'pending') ? undefined : 'phase';
}

export function serializedUnitTurnCounter(unit: SerializedCBTUnitV2 | SerializedNonMekUnit): number {
    return isSerializedNonMekUnit(unit)
        ? unit.turn?.turnCounter ?? 0
        : unit.turn.turnCounter ?? 0;
}

export function preserveEquipmentRowOrder<T extends Readonly<{
    readonly equipmentRowOrder?: EquipmentRowOrderState;
}>>(checkpoint: T, current: T): T {
    const {
        equipmentRowOrder: _rowOrder,
        ...gameplay
    } = checkpoint;
    return Object.freeze({
        ...gameplay,
        ...(current.equipmentRowOrder === undefined
            ? {}
            : { equipmentRowOrder: current.equipmentRowOrder }),
    }) as T;
}

export function sameCBTUnitGameplayState(left: CBTUnit, right: CBTUnit): boolean {
    const { stateRevision: _leftRevision, ...leftState } = left.serialize();
    const { stateRevision: _rightRevision, ...rightState } = right.serialize();
    return jsonValuesEqual(leftState, rightState);
}
