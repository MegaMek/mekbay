// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import type { CBTForce } from '../cbt-force.model';
import { CBTForceMember } from '../force-member.model';
import type { EncounterNetwork } from './encounter-runtime';
import type { ReadyClassicUnit } from './ready-classic-unit';
import { asUnitInstanceId, type UnitInstanceId } from './runtime-state';
import type { SerializedCBTForceV2 } from './persistence-v2';
import type { ScenarioRules } from './unit-state-initializer';

export type CBTForceMemberRegistryRefresh = Readonly<{
    membershipChanged: boolean;
    runtimeChanged: boolean;
    battleValueInputsChanged: boolean;
    operationalC3InputsChanged: boolean;
}>;

/**
 * Stable presentation handles and their exact reactive witnesses. This stores
 * no BV result: each member's base signal remains unit-local. Configured BV
 * topology and live operational C3 state deliberately have separate witnesses.
 */
export class CBTForceMemberRegistry {
    private readonly byId = new Map<UnitInstanceId, CBTForceMember>();
    private readonly membersState = signal<readonly CBTForceMember[]>(Object.freeze([]));
    private readonly battleValueInputRevision = signal(0);
    private readonly operationalC3InputRevision = signal(0);
    private observedNetworks: readonly EncounterNetwork[] | null = null;
    private observedScenario: ScenarioRules | null = null;

    public constructor(
        private readonly owner: CBTForce,
        private readonly readyUnit: (instanceId: UnitInstanceId) => ReadyClassicUnit | null,
    ) {}

    public members(): readonly CBTForceMember[] {
        return this.membersState();
    }

    public member(instanceId: UnitInstanceId): CBTForceMember | null {
        return this.byId.get(instanceId) ?? null;
    }

    public dependOnBattleValueInputs(): void {
        this.battleValueInputRevision();
    }

    public dependOnOperationalC3Inputs(): void {
        this.operationalC3InputRevision();
    }

    public refresh(
        envelope: SerializedCBTForceV2 | null,
        networks: readonly EncounterNetwork[],
        scenario: ScenarioRules | null,
        changedUnitIds: readonly string[] | null = null,
        baseBattleValueChangedUnitIds: readonly string[] | null = changedUnitIds,
        runtimeBattleValueInputsChanged = true,
        runtimeOperationalC3InputsChanged = true,
    ): CBTForceMemberRegistryRefresh {
        let members: Readonly<{ membershipChanged: boolean; runtimeChanged: boolean }>;
        if (changedUnitIds === null) {
            members = this.synchronize(envelope);
        } else {
            let runtimeChanged = changedUnitIds.length > 0;
            let requiresMembershipSync = false;
            const baseBattleValueChanged = baseBattleValueChangedUnitIds === null
                ? null
                : new Set(baseBattleValueChangedUnitIds.map(asUnitInstanceId));
            for (const value of new Set(changedUnitIds)) {
                const instanceId = asUnitInstanceId(value);
                const member = this.byId.get(instanceId);
                const runtime = this.readyUnit(instanceId);
                if (!member || !runtime || member.entity !== runtime.getUnit()) {
                    requiresMembershipSync = true;
                    break;
                }
                member.bindRuntime(
                    runtime,
                    runtime.revision(),
                    baseBattleValueChanged === null || baseBattleValueChanged.has(instanceId),
                );
            }
            members = requiresMembershipSync
                ? this.synchronize(envelope)
                : Object.freeze({ membershipChanged: false, runtimeChanged });
        }
        const networksChanged = networks !== this.observedNetworks;
        const battleValueInputsChanged = members.membershipChanged
            || (members.runtimeChanged && runtimeBattleValueInputsChanged)
            || networksChanged
            || scenario !== this.observedScenario;
        const operationalC3InputsChanged = members.membershipChanged
            || (members.runtimeChanged && runtimeOperationalC3InputsChanged)
            || networksChanged;
        this.observedNetworks = networks;
        this.observedScenario = scenario;
        if (battleValueInputsChanged) this.battleValueInputRevision.update(revision => revision + 1);
        if (operationalC3InputsChanged) this.operationalC3InputRevision.update(revision => revision + 1);
        return Object.freeze({ ...members, battleValueInputsChanged, operationalC3InputsChanged });
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

        const retained = new Set<UnitInstanceId>();
        let membershipChanged = false;
        let runtimeChanged = false;
        const members = envelope.roster.groups.flatMap(group => group.members.flatMap(rosterMember => {
            const runtime = this.readyUnit(rosterMember.instanceId);
            if (!runtime) return [];
            retained.add(rosterMember.instanceId);
            let member = this.byId.get(rosterMember.instanceId);
            if (!member || member.entity !== runtime.getUnit()) {
                member = new CBTForceMember(rosterMember.instanceId, this.owner, runtime.getUnit());
                this.byId.set(rosterMember.instanceId, member);
                membershipChanged = true;
            }
            runtimeChanged = member.bindRuntime(runtime, runtime.revision()) || runtimeChanged;
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
