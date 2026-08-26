// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import type { CBTForce } from '../cbt-force.model';
import { CBTForceMember } from '../force-member.model';
import type { SavedEntityIdentity } from '../persisted-unit-state';
import type { UnitSummary } from '../unit-summary.model';
import type { EncounterNetwork } from './encounter-runtime';
import type { ReadyClassicUnit } from './ready-classic-unit';
import { asUnitInstanceId, type UnitInstanceId } from './runtime-state';
import type { SerializedCBTForceV2 } from './persistence-v2';
import type { ScenarioRules } from './unit-state-initializer';

export type CBTForceMemberRegistryRefresh = Readonly<{
    membershipChanged: boolean;
    runtimeChanged: boolean;
    forceInputsChanged: boolean;
}>;

/**
 * Stable presentation handles and their exact reactive witnesses. This stores
 * no BV result: each member's base signal remains unit-local, while the single
 * force-input revision invalidates only adjusted BV/C3 state.
 */
export class CBTForceMemberRegistry {
    private readonly byId = new Map<UnitInstanceId, CBTForceMember>();
    private readonly membersState = signal<readonly CBTForceMember[]>(Object.freeze([]));
    private readonly forceInputRevision = signal(0);
    private observedNetworks: readonly EncounterNetwork[] | null = null;
    private observedScenario: ScenarioRules | null = null;

    public constructor(
        private readonly owner: CBTForce,
        private readonly resolveSummary: (identity: SavedEntityIdentity) => UnitSummary | undefined,
        private readonly readyUnit: (instanceId: UnitInstanceId) => ReadyClassicUnit | null,
    ) {}

    public members(): readonly CBTForceMember[] {
        return this.membersState();
    }

    public member(instanceId: UnitInstanceId): CBTForceMember | null {
        return this.byId.get(instanceId) ?? null;
    }

    public dependOnForceInputs(): void {
        this.forceInputRevision();
    }

    public refresh(
        envelope: SerializedCBTForceV2 | null,
        networks: readonly EncounterNetwork[],
        scenario: ScenarioRules | null,
        changedUnitIds: readonly string[] | null = null,
    ): CBTForceMemberRegistryRefresh {
        let members: Readonly<{ membershipChanged: boolean; runtimeChanged: boolean }>;
        if (changedUnitIds === null) {
            members = this.synchronize(envelope);
        } else {
            let runtimeChanged = false;
            let requiresMembershipSync = false;
            for (const value of new Set(changedUnitIds)) {
                const instanceId = asUnitInstanceId(value);
                const member = this.byId.get(instanceId);
                const runtime = this.readyUnit(instanceId);
                if (!member || !runtime) {
                    requiresMembershipSync = true;
                    break;
                }
                runtimeChanged = member.bindRuntime(runtime, runtime.revision()) || runtimeChanged;
            }
            members = requiresMembershipSync
                ? this.synchronize(envelope)
                : Object.freeze({ membershipChanged: false, runtimeChanged });
        }
        const forceInputsChanged = members.membershipChanged
            || members.runtimeChanged
            || networks !== this.observedNetworks
            || scenario !== this.observedScenario;
        this.observedNetworks = networks;
        this.observedScenario = scenario;
        if (forceInputsChanged) this.forceInputRevision.update(revision => revision + 1);
        return Object.freeze({ ...members, forceInputsChanged });
    }

    private synchronize(
        envelope: SerializedCBTForceV2 | null,
    ): Readonly<{ membershipChanged: boolean; runtimeChanged: boolean }> {
        if (!envelope) {
            const membershipChanged = this.byId.size > 0 || this.membersState().length > 0;
            this.byId.clear();
            if (membershipChanged) this.membersState.set(Object.freeze([]));
            return Object.freeze({ membershipChanged, runtimeChanged: false });
        }

        const entries = new Map(envelope.units.map(entry => [entry.instanceId, entry] as const));
        const retained = new Set<UnitInstanceId>();
        let membershipChanged = false;
        let runtimeChanged = false;
        const members = envelope.roster.groups.flatMap(group => group.members.flatMap(rosterMember => {
            const entry = entries.get(rosterMember.instanceId);
            const identity = entry?.kind === 'ready'
                ? entry.unit.entity
                : entry?.kind === 'deferred' && entry.source.identity.kind === 'resolved'
                    ? entry.source.identity.savedIdentity
                    : undefined;
            if (!identity) return [];
            const summary = this.resolveSummary(identity);
            if (!summary) return [];
            retained.add(rosterMember.instanceId);
            let member = this.byId.get(rosterMember.instanceId);
            if (!member || member.summary !== summary) {
                member = new CBTForceMember(rosterMember.instanceId, this.owner, summary);
                this.byId.set(rosterMember.instanceId, member);
                membershipChanged = true;
            }
            const runtime = this.readyUnit(rosterMember.instanceId);
            runtimeChanged = member.bindRuntime(runtime, runtime?.revision() ?? null) || runtimeChanged;
            return [member];
        }));
        for (const instanceId of this.byId.keys()) {
            if (retained.has(instanceId)) continue;
            this.byId.delete(instanceId);
            membershipChanged = true;
        }
        const current = this.membersState();
        if (current.length !== members.length
            || current.some((member, index) => member !== members[index])) {
            this.membersState.set(Object.freeze(members));
            membershipChanged = true;
        }
        return Object.freeze({ membershipChanged, runtimeChanged });
    }
}
