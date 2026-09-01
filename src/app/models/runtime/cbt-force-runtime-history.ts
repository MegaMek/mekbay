// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { jsonValuesEqual } from '../../utils/json-value.util';
import { compareText } from '../../utils/string.util';
import type { JsonValue } from '../persisted-unit-state';
import type { MotiveModes } from '../motiveModes.model';
import {
    createSavedTargetRef,
    parseSavedTargetRef,
    type SerializedCBTUnitV2,
} from './persistence-v2';
import {
    MAX_MEK_CREW_WOUNDS,
    type MekUnitRuntimeState,
    type CrewRuntimeState,
    type MekLocationConditionKey,
    type UnitInstanceId,
} from './runtime-state';
import {
    isReadyNonMekUnit,
    isReadyMekUnit,
    type ReadyClassicUnit,
} from './ready-classic-unit';
import type { ReadyMekUnit } from './ready-unit-factory';
import type {
    ArmorFaceId,
    ComponentId,
    CrewPositionId,
    CriticalSlotId,
    LocationId,
    SystemDamageTrackId,
} from '../entity/entity-identifiers';
import { getMekLocationLabel } from '../entity/types/mek';
import type {
    NonMekCrewRuntimeState,
    NonMekUnitCommand,
    NonMekUnitRuntimeState,
} from './non-mek-unit-instance';
import type { CBTUnitCommand } from './unit-instance';
import type { CrewProfileSnapshot } from './crew-profile';
import { serializeUnitCover } from '../unit-cover.model';
import type { EquipmentRowOrderState } from './equipment-row-order';
import {
    RUNTIME_HISTORY_MESSAGE,
    type RuntimeHistoryEventInput,
    type RuntimeHistoryTargetKind,
} from './runtime-history';
import {
    isSerializedNonMekUnit,
    type SerializedNonMekUnit,
} from './non-mek-unit-persistence';

interface MekHistoryUnitAccess {
    instanceIds(): readonly UnitInstanceId[];
    readyMekUnit(instanceId: UnitInstanceId): ReadyMekUnit | null;
}

export function unitHistory(
    messageId: RuntimeHistoryEventInput['messageId'],
    instanceId: UnitInstanceId,
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

export type RuntimeHistoryInput = RuntimeHistoryEventInput
    | readonly RuntimeHistoryEventInput[]
    | undefined;

function armorHistoryTarget(unit: ReadyClassicUnit, faceId: ArmorFaceId): string {
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

function internalHistoryTarget(unit: ReadyClassicUnit, locationId: LocationId): string {
    const location = unit.getIndex().locations.get(locationId);
    return location === undefined
        ? locationId
        : createSavedTargetRef('location', location.code.toLowerCase(), 'internal');
}

function criticalHistoryTarget(unit: ReadyClassicUnit, criticalId: CriticalSlotId): string {
    if (!isReadyMekUnit(unit)) return criticalId;
    const slot = unit.getIndex().slots.get(criticalId);
    const location = slot === undefined ? undefined : unit.getIndex().locations.get(slot.locationId);
    return slot === undefined || location === undefined
        ? criticalId
        : createSavedTargetRef('slot', `${location.code.toLowerCase()}:${slot.slotIndex}`);
}

function componentHistoryTarget(componentId: ComponentId): string {
    return createSavedTargetRef('component', componentId);
}

function crewStateCode(state: CrewRuntimeState | NonMekCrewRuntimeState): number {
    if (state.wounds >= MAX_MEK_CREW_WOUNDS) return 3;
    if ('state' in state && state.state === 'killed') return 4;
    if ('state' in state && state.state === 'stunned') return 5;
    if (state.ejected) return 2;
    return state.unconscious ? 1 : 0;
}

function crewRuntimeHistory(
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
    positionId: CrewPositionId,
    before: CrewRuntimeState | NonMekCrewRuntimeState,
    after: CrewRuntimeState | NonMekCrewRuntimeState,
): RuntimeHistoryEventInput {
    const occurrence = unit.getIndex().crewPositions.get(positionId)?.occurrence ?? 0;
    return unitHistory(
        RUNTIME_HISTORY_MESSAGE.CREW_CHANGED,
        instanceId,
        occurrence,
        before.wounds,
        after.wounds,
        crewStateCode(before),
        crewStateCode(after),
    );
}

export function heatHistory(
    instanceId: UnitInstanceId,
    before: Readonly<{
        readonly current: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
    }>,
    after: Readonly<{
        readonly current: number;
        readonly pendingOverride?: number;
        readonly heatsinksOff: number;
    }>,
): RuntimeHistoryEventInput | undefined {
    if (before.current !== after.current) {
        return unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 0, before.current, after.current);
    }
    const beforeTarget = before.pendingOverride ?? before.current;
    const afterTarget = after.pendingOverride ?? after.current;
    if (beforeTarget !== afterTarget) {
        return unitHistory(RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED, instanceId, 1, beforeTarget, afterTarget);
    }
    if (before.heatsinksOff !== after.heatsinksOff) {
        return unitHistory(
            RUNTIME_HISTORY_MESSAGE.HEAT_CHANGED,
            instanceId,
            2,
            before.heatsinksOff,
            after.heatsinksOff,
        );
    }
    return undefined;
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
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
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
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
    before: CrewProfileSnapshot,
    after: CrewProfileSnapshot,
): readonly RuntimeHistoryEventInput[] {
    const beforeById = new Map(before.positions.map(position => [position.positionId, position] as const));
    const events: RuntimeHistoryEventInput[] = [];
    for (const position of after.positions) {
        const previous = beforeById.get(position.positionId);
        if (!previous) continue;
        const occurrence = unit.getIndex().crewPositions.get(position.positionId)?.occurrence ?? 0;
        if (previous.gunnery !== position.gunnery) {
            events.push(unitHistory(
                RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
                instanceId,
                occurrence,
                0,
                previous.gunnery,
                position.gunnery,
            ));
        }
        if (previous.piloting !== position.piloting) {
            events.push(unitHistory(
                RUNTIME_HISTORY_MESSAGE.CREW_SKILL_CHANGED,
                instanceId,
                occurrence,
                1,
                previous.piloting,
                position.piloting,
            ));
        }
    }
    return Object.freeze(events);
}

function historyLocationByCode(unit: ReadyClassicUnit, code: string) {
    const normalized = code.toLowerCase();
    return [...unit.getIndex().locations.values()]
        .find(location => location.code.toLowerCase() === normalized);
}

function historyLocationLabel(unit: ReadyClassicUnit, locationId: LocationId): string {
    const code = unit.getIndex().locations.get(locationId)?.code;
    return code === undefined ? locationId : getMekLocationLabel(code) ?? code;
}

function historyComponentLabel(unit: ReadyClassicUnit, componentId: ComponentId): string {
    if (isReadyMekUnit(unit)) {
        const component = unit.getIndex().components.get(componentId);
        if (component?.kind === 'system') return component.systemType;
        return component?.mount.displayName() ?? componentId;
    }
    if (isReadyNonMekUnit(unit)) {
        return unit.getIndex().components.get(componentId)?.mount.displayName() ?? componentId;
    }
    return componentId;
}

function historyCriticalLabel(
    unit: ReadyClassicUnit,
    targetId: string,
): string {
    if (isReadyNonMekUnit(unit)) {
        return unit.getIndex().damageTracks.get(targetId as SystemDamageTrackId)?.label ?? targetId;
    }
    if (!isReadyMekUnit(unit)) return targetId;
    const slot = historyMekSlot(unit, targetId)
        ?? unit.getIndex().slots.get(targetId as CriticalSlotId);
    if (slot === undefined) return targetId;
    const componentLabels = [...new Set(slot.componentIds.map(componentId =>
        historyComponentLabel(unit, componentId)))];
    const component = componentLabels.join(' / ') || 'Critical slot';
    return `${component} at ${historyLocationLabel(unit, slot.locationId)} slot ${slot.slotIndex + 1}`;
}

function historyMekSlot(unit: ReadyMekUnit, targetId: string) {
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
    unit: ReadyClassicUnit,
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

export function historyCrewLabel(unit: ReadyClassicUnit, occurrence: number): string {
    const definition = [...unit.getIndex().crewPositions.values()]
        .find(position => position.occurrence === occurrence);
    const assigned = definition === undefined
        ? undefined
        : unit.getCrewAssignment().positions.find(position => position.positionId === definition.id);
    const role = assigned?.role.trim();
    if (role) return role;
    if (unit.getUnit().entityType === 'Mek' && occurrence === 0) return 'Pilot';
    return `Crew ${occurrence + 1}`;
}

export function nonMekCommandHistory(
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
    command: NonMekUnitCommand,
    before: NonMekUnitRuntimeState,
    after: NonMekUnitRuntimeState,
    modeChange?: Readonly<{ readonly before?: string; readonly after?: string }>,
): RuntimeHistoryInput {
    if (command.kind === 'set-movement' || command.kind === 'set-airborne') {
        const events: RuntimeHistoryEventInput[] = [];
        const beforeMovement = before.turn.movement;
        const afterMovement = after.turn.movement;
        if (beforeMovement?.mode !== afterMovement?.mode
            || beforeMovement?.distance !== afterMovement?.distance) {
            events.push(movementRuntimeHistory(instanceId, beforeMovement, afterMovement));
        }
        if (before.turn.airborne !== after.turn.airborne) {
            events.push(unitHistory(
                RUNTIME_HISTORY_MESSAGE.AIRBORNE_CHANGED,
                instanceId,
                airborneHistoryCode(before.turn.airborne),
                airborneHistoryCode(after.turn.airborne),
            ));
        }
        return events;
    }

    switch (command.kind) {
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
        case 'set-component-status':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS, instanceId, componentHistoryTarget(command.componentId), command.status, command.target);
        case 'set-component-mode':
            return componentModeHistory(instanceId, command.componentId, modeChange?.before, modeChange?.after);
        case 'end-phase':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED, instanceId);
        case 'mark-end-turn-heat-staged':
        case 'set-control-recovery':
            return undefined;
        case 'cancel-pending':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED, instanceId);
        case 'end-turn':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_ENDED, instanceId);
        case 'set-condition':
            return unitHistory(
                RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED,
                instanceId,
                command.condition,
                before.conditions.has(command.condition),
                after.conditions.has(command.condition),
            );
        case 'set-crew-state':
            return crewRuntimeHistory(
                instanceId,
                unit,
                command.positionId,
                before.crew.get(command.positionId) ?? { wounds: 0, unconscious: false, ejected: false },
                after.crew.get(command.positionId) ?? { wounds: 0, unconscious: false, ejected: false },
            );
        case 'set-heat':
        case 'set-heatsinks-off':
        case 'apply-heat':
            return heatHistory(instanceId, before.heat, after.heat);
        case 'set-ammo-spent':
        case 'configure-ammo-source':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.AMMO_CHANGED, instanceId);
        default:
            return unitHistory(RUNTIME_HISTORY_MESSAGE.UNIT_ACTION, instanceId, command.kind);
    }
}

export function nonMekCommandBoundary(command: NonMekUnitCommand): 'phase' | undefined {
    return command.kind === 'end-phase' ? 'phase' : undefined;
}

export function mekCommandHistory(
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
    command: CBTUnitCommand,
    before: MekUnitRuntimeState,
    after: MekUnitRuntimeState,
    modeChange?: Readonly<{ readonly before?: string; readonly after?: string }>,
): RuntimeHistoryInput {
    switch (command.type) {
        case 'damage-armor':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_ARMOR, instanceId, armorHistoryTarget(unit, command.faceId), command.amount, command.target);
        case 'repair-armor':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_ARMOR, instanceId, armorHistoryTarget(unit, command.faceId), command.amount, command.target);
        case 'damage-internal':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_INTERNAL, instanceId, internalHistoryTarget(unit, command.locationId), command.amount, command.target);
        case 'repair-internal':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_INTERNAL, instanceId, internalHistoryTarget(unit, command.locationId), command.amount, command.target);
        case 'hit-critical':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.DAMAGE_CRITICAL, instanceId, criticalHistoryTarget(unit, command.slotId), command.hits, command.target);
        case 'repair-critical':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.REPAIR_CRITICAL, instanceId, criticalHistoryTarget(unit, command.slotId), command.hits, command.target);
        case 'set-component-status':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.COMPONENT_STATUS, instanceId, componentHistoryTarget(command.componentId), command.status, command.target);
        case 'set-component-mode':
            return componentModeHistory(instanceId, command.componentId, modeChange?.before, modeChange?.after);
        case 'apply-mek-blow-off':
            return mekLocationConditionHistory(
                instanceId,
                unit,
                before,
                after,
                command.locationId,
                'blown-off',
                command.target,
            );
        case 'commit-pending':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED, instanceId);
        case 'end-phase':
            return after.movementPsr.checks.some(check => check.status === 'pending')
                ? undefined
                : unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_COMMITTED, instanceId);
        case 'mark-end-turn-heat-staged':
        case 'set-pending-fall-consequences':
            return undefined;
        case 'cancel-pending':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.PHASE_DISCARDED, instanceId);
        case 'end-turn':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.TURN_ENDED, instanceId);
        case 'set-condition':
            return unitHistory(
                RUNTIME_HISTORY_MESSAGE.CONDITION_CHANGED,
                instanceId,
                command.condition,
                before.conditions.has(command.condition),
                after.conditions.has(command.condition),
            );
        case 'set-location-condition':
            return mekLocationConditionHistory(
                instanceId,
                unit,
                before,
                after,
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
        case 'configure-ammo-source':
        case 'spend-ammo':
        case 'activate-coolant-pod':
            return unitHistory(RUNTIME_HISTORY_MESSAGE.AMMO_CHANGED, instanceId);
        case 'set-heat':
        case 'set-pending-heat':
        case 'set-heatsinks-off':
        case 'apply-heat':
            return heatHistory(instanceId, before.heat, after.heat);
        case 'declare-mek-movement':
        case 'clear-mek-movement':
            return movementRuntimeHistory(
                instanceId,
                before.movementPsr.movement,
                after.movementPsr.movement,
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
            return mekTurnStateHistory(instanceId, before, after);
        default:
            return unitHistory(RUNTIME_HISTORY_MESSAGE.UNIT_ACTION, instanceId, command.type);
    }
}

function componentModeHistory(
    instanceId: UnitInstanceId,
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
    instanceId: UnitInstanceId,
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
    instanceId: UnitInstanceId,
    unit: ReadyClassicUnit,
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
    readonly instanceId: UnitInstanceId;
    readonly componentId: ComponentId;
    readonly mode?: string;
}

export function captureMekComponentModes(
    authority: MekHistoryUnitAccess,
    instanceIds: readonly UnitInstanceId[] = authority.instanceIds(),
): readonly ComponentModeHistoryState[] {
    const rows: ComponentModeHistoryState[] = [];
    for (const instanceId of instanceIds) {
        const unit = authority.readyMekUnit(instanceId);
        if (unit === null) continue;
        const query = unit.getInstance().query();
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
        const after = authority.readyMekUnit(row.instanceId)
            ?.getInstance().query().componentMode(row.componentId);
        const event = componentModeHistory(row.instanceId, row.componentId, row.mode, after);
        if (event !== undefined) events.push(event);
    }
    return Object.freeze(events);
}

function movementRuntimeHistory(
    instanceId: UnitInstanceId,
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

export function preserveOperationalUnitState<T extends Readonly<{
    readonly attackerTargeting: unknown;
    readonly equipmentRowOrder?: EquipmentRowOrderState;
}>>(checkpoint: T, current: T): T {
    const {
        attackerTargeting: _targeting,
        equipmentRowOrder: _rowOrder,
        ...gameplay
    } = checkpoint;
    return Object.freeze({
        ...gameplay,
        attackerTargeting: current.attackerTargeting,
        ...(current.equipmentRowOrder === undefined
            ? {}
            : { equipmentRowOrder: current.equipmentRowOrder }),
    }) as T;
}

export function compareUnitInstanceIds(left: UnitInstanceId, right: UnitInstanceId): number {
    return compareText(left, right);
}

export function sameReadyUnitGameplayState(left: ReadyClassicUnit, right: ReadyClassicUnit): boolean {
    const { stateRevision: _leftRevision, ...leftState } = left.serialize();
    const { stateRevision: _rightRevision, ...rightState } = right.serialize();
    return jsonValuesEqual(leftState, rightState);
}
