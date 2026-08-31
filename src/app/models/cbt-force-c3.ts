// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    C3EmergencyMasterActivationTracker,
    isC3EmergencyMasterEquipment,
} from './c3-emergency-master.model';
import type { C3State } from './cbt-force-api';
import {
    C3NetworkType,
    C3Role,
    projectNonMekC3Components,
    type C3Component,
} from './c3-network.model';
import {
    projectEncounterC3Components,
    validateEncounterNetworks,
    type C3EncounterPresentationUnit,
} from './c3-network-presentation';
import type { ComponentId } from './entity/entity-identifiers';
import type { ToastService } from '../services/toast.service';
import {
    componentC3EmergencyMasterDefinition,
    componentC3EmergencyMasterFacts,
    componentC3EmergencyMasterStatusLabel,
    settleComponentC3EmergencyMasterEndTurn,
    syncComponentC3EmergencyMasterEncounter,
    type ComponentC3EmergencyMasterDefinition,
} from './runtime/component-c3-emergency-master';
import { projectOperationalC3Networks } from './runtime/c3-operational-network';
import type { EncounterNetwork } from './runtime/encounter-runtime';
import {
    c3EndpointKey,
    projectEffectiveMekC3Networks,
} from './runtime/mek-c3-runtime';
import { equipmentForComponent } from './runtime/mek-runtime-index';
import {
    isReadyNonMekUnit,
    isReadyMekUnit,
    type ReadyClassicUnit,
} from './runtime/ready-classic-unit';
import type { ReadyMekUnit } from './runtime/ready-unit-factory';
import {
    createCommandId,
    type MekUnitRuntimeState,
    type UnitInstanceId,
} from './runtime/runtime-state';
import type {
    CommandReduction,
    UnitDomainEvent,
} from './runtime/unit-instance';

export interface C3EmergencyMasterNotice {
    readonly message: string;
    readonly type: 'info' | 'error';
    readonly id?: string;
}

export interface C3EmergencyMasterMutation {
    readonly changed: boolean;
    readonly notices: readonly C3EmergencyMasterNotice[];
    readonly eventsByUnit: ReadonlyMap<UnitInstanceId, readonly UnitDomainEvent[]>;
}

export interface C3EmergencyMasterEndTurnPlan {
    readonly owner: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>;
    readonly unit: ReadyMekUnit;
    readonly instanceId: UnitInstanceId;
    readonly effectiveNetworks: readonly EncounterNetwork[];
    readonly definitions: readonly ComponentC3EmergencyMasterDefinition[];
}

/**
 * C3 mechanics owned by a force. The force authority supplies only its current
 * ready-unit index; topology, operationality, and emergency-master lifecycle
 * stay in this cohesive component.
 */
export class CBTForceC3 {
    private emergencyMasterTracker = new C3EmergencyMasterActivationTracker();

    public constructor(
        private readonly currentUnits: () => ReadonlyMap<UnitInstanceId, ReadyClassicUnit> | null,
    ) {}

    public reset(): void {
        this.emergencyMasterTracker = new C3EmergencyMasterActivationTracker();
    }

    public isEndpointOperational(instanceId: UnitInstanceId, componentId: ComponentId): boolean {
        const unit = this.currentUnits()?.get(instanceId);
        if (!unit) return false;
        try {
            if (isReadyMekUnit(unit)) {
                const query = unit.getInstance().query();
                return !query.hasCondition('shutdown')
                    && !query.hasCondition('jammed')
                    && !query.c3DisruptedByStealth('preview')
                    && query.componentStatus(componentId, 'preview') === 'available';
            }
            const query = unit.captureRuntime().query;
            return !query.hasCondition('shutdown')
                && !query.hasCondition('jammed')
                && query.componentStatus(componentId, 'preview') === 'available';
        } catch {
            return false;
        }
    }

    /** BV follows configured wiring and permanent loss, never transient operation. */
    public isEndpointIntact(instanceId: UnitInstanceId, componentId: ComponentId): boolean {
        const unit = this.currentUnits()?.get(instanceId);
        if (!unit) return false;
        try {
            const query = isReadyMekUnit(unit)
                ? unit.getInstance().query()
                : unit.captureRuntime().query;
            return query.componentStatus(componentId, 'committed') !== 'destroyed';
        } catch {
            return false;
        }
    }

    public effectiveNetworks(configured: readonly EncounterNetwork[]): readonly EncounterNetwork[] {
        return projectEffectiveMekC3Networks(
            configured,
            [...(this.currentUnits() ?? [])].flatMap(([instanceId, unit]) => isReadyMekUnit(unit)
                ? [Object.freeze({ instanceId, query: unit.getInstance().query() })]
                : []),
        );
    }

    /** Canonical editor-rule validation over the currently owned ready units. */
    public validateConfiguredNetworks(configured: readonly EncounterNetwork[]): boolean {
        return validateCBTEncounterNetworks(configured, this.currentUnits() ?? new Map());
    }

    public state(
        instanceId: UnitInstanceId,
        networks: readonly EncounterNetwork[],
        expectedUnit?: ReadyClassicUnit,
    ): C3State {
        const unit = this.currentUnits()?.get(instanceId);
        if (!unit || (expectedUnit !== undefined && expectedUnit !== unit)) return 'none';
        const linkedNetworks = this.effectiveNetworks(networks).filter(network =>
            network.endpoints.some(endpoint => endpoint.instanceId === instanceId));
        if (linkedNetworks.length === 0) return 'none';
        const operational = projectOperationalC3Networks(
            linkedNetworks,
            (endpointInstanceId, componentId) =>
                this.isEndpointOperational(endpointInstanceId, componentId),
        ).some(network => network.endpoints.some(endpoint => endpoint.instanceId === instanceId));
        return operational ? 'operational' : 'degraded';
    }

    public hasOperationalEndpoint(
        instanceId: UnitInstanceId,
        unit: ReadyClassicUnit,
        networks: readonly EncounterNetwork[],
    ): boolean {
        return this.state(instanceId, networks, unit) === 'operational';
    }

    /** Units whose persisted emergency-master step can change during reconciliation. */
    public emergencyMasterUnitIds(): readonly UnitInstanceId[] {
        return Object.freeze([...(this.currentUnits() ?? [])].flatMap(([instanceId, unit]) => {
            if (!isReadyMekUnit(unit)) return [];
            const hasEmergencyMaster = [...unit.getIndex().components.keys()].some(componentId =>
                isC3EmergencyMasterEquipment(equipmentForComponent(unit.getIndex(), componentId)));
            return hasEmergencyMaster ? [instanceId] : [];
        }));
    }

    public reconcileEmergencyMasters(
        configured: readonly EncounterNetwork[],
        candidateUnitIds: readonly UnitInstanceId[] = this.emergencyMasterUnitIds(),
    ): C3EmergencyMasterMutation {
        const units = this.currentUnits();
        if (!units || candidateUnitIds.length === 0) return emptyC3EmergencyMasterMutation();
        const effectiveNetworks = this.effectiveNetworks(configured);
        const statuses: Array<{ readonly key: string; readonly status: ReturnType<
            typeof componentC3EmergencyMasterFacts
        >['status'] }> = [];
        const definitions = new Map<string, ComponentC3EmergencyMasterDefinition>();
        const eventsByUnit = new Map<UnitInstanceId, UnitDomainEvent[]>();
        let changed = false;

        for (const instanceId of new Set(candidateUnitIds)) {
            const unit = units.get(instanceId);
            if (!unit || !isReadyMekUnit(unit)) continue;
            const runtime = unit.getInstance();
            for (const [componentId] of unit.getIndex().components) {
                if (!isC3EmergencyMasterEquipment(
                    equipmentForComponent(unit.getIndex(), componentId),
                )) continue;
                const definition = componentC3EmergencyMasterDefinition(
                    unit.getUnit(),
                    unit.getIndex(),
                    componentId,
                );
                const context = {
                    instanceId,
                    encounter: () => ({ networks: effectiveNetworks }),
                };
                const facts = componentC3EmergencyMasterFacts(runtime, definition, context);
                const key = c3EndpointKey(instanceId, componentId);
                statuses.push(Object.freeze({ key, status: facts.status }));
                definitions.set(key, definition);
                if (facts.status !== 'active' || facts.operatingTurns !== 0) continue;
                const commandId = createCommandId();
                const result = syncComponentC3EmergencyMasterEncounter(
                    runtime,
                    definition,
                    context,
                    () => commandId,
                );
                if (!result.accepted || !result.changed) continue;
                changed = true;
                appendC3Event(eventsByUnit, instanceId, Object.freeze({
                    kind: 'edit-c3-emergency-master',
                    commandId,
                    revision: runtime.revision(),
                }));
            }
        }

        const activated = this.emergencyMasterTracker.update(statuses);
        const notices = activated.flatMap(key => {
            const definition = definitions.get(key);
            return definition === undefined ? [] : [Object.freeze({
                message: `${definition.unitDisplayName}: ${definition.displayName} EMERGENCY active`,
                type: 'info' as const,
                id: `c3em-activation-${key}`,
            })];
        });
        return Object.freeze({
            changed,
            notices: Object.freeze(notices),
            eventsByUnit: freezeC3Events(eventsByUnit),
        });
    }

    public planEmergencyMasterEndTurn(
        instanceId: UnitInstanceId,
        configured: readonly EncounterNetwork[],
    ): C3EmergencyMasterEndTurnPlan | null {
        const owner = this.currentUnits();
        const candidate = owner?.get(instanceId);
        const unit = candidate && isReadyMekUnit(candidate) ? candidate : undefined;
        if (!owner || !unit) return null;
        const effectiveNetworks = this.effectiveNetworks(configured);
        const runtime = unit.getInstance();
        const definitions = [...unit.getIndex().components.keys()].flatMap(componentId => {
            if (!isC3EmergencyMasterEquipment(
                equipmentForComponent(unit.getIndex(), componentId),
            )) return [];
            const definition = componentC3EmergencyMasterDefinition(
                unit.getUnit(),
                unit.getIndex(),
                componentId,
            );
            const facts = componentC3EmergencyMasterFacts(runtime, definition, {
                instanceId,
                encounter: () => ({ networks: effectiveNetworks }),
            });
            return facts.status === 'active' ? [definition] : [];
        });
        return Object.freeze({
            owner,
            unit,
            instanceId,
            effectiveNetworks,
            definitions: Object.freeze(definitions),
        });
    }

    public settleEmergencyMasterEndTurn(
        plan: C3EmergencyMasterEndTurnPlan | null,
    ): C3EmergencyMasterMutation {
        const units = this.currentUnits();
        if (!plan || units !== plan.owner || units.get(plan.instanceId) !== plan.unit) {
            return emptyC3EmergencyMasterMutation();
        }
        const runtime = plan.unit.getInstance();
        const eventsByUnit = new Map<UnitInstanceId, UnitDomainEvent[]>();
        const notices: C3EmergencyMasterNotice[] = [];
        let changed = false;
        for (const definition of plan.definitions) {
            const context = {
                instanceId: plan.instanceId,
                encounter: () => ({ networks: plan.effectiveNetworks }),
            };
            const commandId = createCommandId();
            const result = settleComponentC3EmergencyMasterEndTurn(
                runtime,
                definition,
                context,
                () => commandId,
            );
            if (!result.accepted || !result.changed) continue;
            changed = true;
            appendC3Event(eventsByUnit, plan.instanceId, Object.freeze({
                kind: 'edit-c3-emergency-master',
                commandId,
                revision: runtime.revision(),
            }));
            const facts = componentC3EmergencyMasterFacts(runtime, definition, context);
            notices.push(Object.freeze({
                message: `${definition.unitDisplayName}: ${definition.displayName} ${
                    componentC3EmergencyMasterStatusLabel(facts)
                }`,
                type: facts.status === 'fried' ? 'error' : 'info',
            }));
        }
        return Object.freeze({
            changed,
            notices: Object.freeze(notices),
            eventsByUnit: freezeC3Events(eventsByUnit),
        });
    }
}

/**
 * Load/save boundary adapter. It projects runtime capabilities, then delegates
 * every topology decision to C3NetworkEditor through validateEncounterNetworks.
 */
export function validateCBTEncounterNetworks(
    configured: readonly EncounterNetwork[],
    units: ReadonlyMap<UnitInstanceId, ReadyClassicUnit>,
): boolean {
    const presentation = [...units].map(([instanceId, unit]): C3EncounterPresentationUnit => Object.freeze({
        instanceId,
        c3Components: projectEncounterC3Components(instanceId, projectReadyC3Components(unit), configured),
    }));
    return validateEncounterNetworks(configured, presentation);
}

function projectReadyC3Components(unit: ReadyClassicUnit): readonly C3Component[] {
    if (!isReadyMekUnit(unit)) {
        return isReadyNonMekUnit(unit)
            ? projectNonMekC3Components(unit.getIndex())
            : Object.freeze([]);
    }
    const projected = unit.getInstance().query().mekC3Endpoints();
    if (projected.kind !== 'supported') return Object.freeze([]);
    return Object.freeze(projected.endpoints.map((endpoint, index) => Object.freeze({
        componentId: endpoint.componentId,
        networkType: endpoint.family as C3NetworkType,
        role: endpoint.role === 'master'
            ? C3Role.MASTER
            : endpoint.role === 'peer' ? C3Role.PEER : C3Role.SLAVE,
        boosted: endpoint.boosted,
        emergency: endpoint.emergency,
        index,
    })));
}

function appendC3Event(
    events: Map<UnitInstanceId, UnitDomainEvent[]>,
    instanceId: UnitInstanceId,
    event: UnitDomainEvent,
): void {
    const current = events.get(instanceId);
    if (current) current.push(event);
    else events.set(instanceId, [event]);
}

function freezeC3Events(
    events: ReadonlyMap<UnitInstanceId, readonly UnitDomainEvent[]>,
): ReadonlyMap<UnitInstanceId, readonly UnitDomainEvent[]> {
    return new Map([...events].map(([instanceId, unitEvents]) => [
        instanceId,
        Object.freeze([...unitEvents]),
    ] as const));
}

export function emptyC3EmergencyMasterMutation(): C3EmergencyMasterMutation {
    return Object.freeze({
        changed: false,
        notices: Object.freeze([]),
        eventsByUnit: new Map(),
    });
}

export function mergeC3CommandReduction(
    reduction: Extract<CommandReduction, { readonly accepted: true }>,
    state: MekUnitRuntimeState,
    instanceId: UnitInstanceId,
    ...mutations: readonly C3EmergencyMasterMutation[]
): CommandReduction {
    const c3Events = mutations.flatMap(mutation => mutation.eventsByUnit.get(instanceId) ?? []);
    if (state.stateRevision === reduction.state.stateRevision && c3Events.length === 0) return reduction;
    return Object.freeze({
        ...reduction,
        state,
        events: Object.freeze([...reduction.events, ...c3Events]),
    });
}

export function publishC3EmergencyMasterNotices(
    notices: readonly C3EmergencyMasterNotice[],
    toast: Pick<ToastService, 'showToast'>,
): void {
    for (const notice of notices) toast.showToast(notice.message, notice.type, notice.id);
}
