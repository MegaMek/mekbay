// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitCommand } from './unit-instance';
import type { UnitInstanceId } from './runtime-state';

type DependencyRefresh = readonly [
    baseBattleValueChangedUnitIds: readonly string[] | null,
    battleValueInputsChanged: boolean,
    operationalC3InputsChanged: boolean,
];

/** Classifies one synchronous Mek publication without retaining runtime results. */
export class CBTForceMekMutationImpact {
    private active: DependencyRefresh | undefined;

    public publish(
        instanceId: UnitInstanceId,
        command: CBTUnitCommand,
        changedUnitIds: readonly UnitInstanceId[],
        emit: (changedUnitIds: readonly UnitInstanceId[]) => void,
    ): void {
        const previous = this.active;
        const baseChanged = commandMayChangeBaseBattleValue(command);
        this.active = Object.freeze([
            baseChanged ? Object.freeze([instanceId]) : Object.freeze([]),
            baseChanged,
            commandMayChangeOperationalC3(command),
        ]);
        try {
            emit(changedUnitIds);
        } finally {
            this.active = previous;
        }
    }

    public dependencyRefresh(changedUnitIds: readonly string[] | null): DependencyRefresh {
        return this.active ?? Object.freeze([changedUnitIds, true, true]);
    }
}

function commandMayChangeOperationalC3(command: CBTUnitCommand): boolean {
    switch (command.type) {
        case 'damage-internal':
        case 'repair-internal':
        case 'hit-critical':
        case 'repair-critical':
        case 'apply-mek-blow-off':
        case 'apply-mek-critical-roll':
        case 'set-system-critical-level':
        case 'set-component-status':
        case 'set-component-mode':
        case 'detonate-booby-trap':
        case 'set-stealth-state':
        case 'edit-escalating-failure':
        case 'edit-c3-emergency-master':
        case 'set-mek-shutdown-state':
        case 'declare-mek-action':
        case 'clear-mek-action':
        case 'end-phase':
        case 'end-turn':
        case 'commit-pending':
        case 'cancel-pending':
            return true;
        case 'set-location-condition':
            return command.condition !== 'narc';
        case 'set-condition':
            return command.condition === 'jammed' || command.condition === 'shutdown';
        default:
            return false;
    }
}

function commandMayChangeBaseBattleValue(command: CBTUnitCommand): boolean {
    switch (command.type) {
        case 'damage-armor':
        case 'repair-armor':
        case 'damage-internal':
        case 'repair-internal':
        case 'hit-critical':
        case 'repair-critical':
        case 'apply-mek-blow-off':
        case 'apply-mek-critical-roll':
        case 'set-system-critical-level':
        case 'set-component-status':
        case 'damage-shield':
        case 'repair-shield':
            return command.target === 'committed';
        case 'set-location-condition':
            return command.target === 'committed' && command.condition !== 'narc';
        case 'configure-ammo-source':
        case 'spend-ammo':
        case 'activate-coolant-pod':
        case 'fire-weapons':
        case 'detonate-booby-trap':
        case 'edit-escalating-failure':
        case 'end-phase':
        case 'end-turn':
        case 'commit-pending':
            return true;
        default:
            return false;
    }
}
