// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { endTurnCalculatesHeat, realPhasesEnabled, type OptionsService } from '../../services/options.service';
import type { CBTUnitSnapshot } from '../cbt-unit-snapshot';
import { isAntiMekAttack } from '../rules/anti-mek-attack-rules';
import { attackDeclarationOpen } from '../rules/turn-sequence';
import type { AttackerTargetingEdit } from './attacker-targeting-state';
import type { CBTUnitCommand } from './unit-command';

/** Applies the force's current turn options when accepting a sheet command. */
export class CBTForceTurnPolicy {
    constructor(private readonly getOptions: () => OptionsService | null) {}

    prepare(command: CBTUnitCommand): CBTUnitCommand {
        switch (command.type) {
            case 'declare-mek-movement':
            case 'declare-mek-action':
            case 'replace-turn-state': {
                const options = this.getOptions();
                return options && realPhasesEnabled(options) ? { ...command, realPhases: true } : command;
            }
            case 'set-pending-heat': {
                const options = this.getOptions();
                return options && endTurnCalculatesHeat(options) ? { ...command, follow: true } : command;
            }
            default: return command;
        }
    }

    allowsTargetEdit(snapshot: CBTUnitSnapshot, edit: AttackerTargetingEdit): boolean {
        if (edit.kind === 'set-target-facts') return true;
        const action = edit.kind === 'set-action-selection' ? edit.target : null;
        const kind = action?.kind === 'intrinsic'
            ? snapshot.entity.intrinsicWeapons().find(row => row.id === action.actionId)?.kind : undefined;
        return this.declarationOpen(snapshot, action && !isAntiMekAttack(kind) ? 'physical' : 'weapons');
    }

    allowsFiringMode(snapshot: CBTUnitSnapshot, command: CBTUnitCommand): boolean {
        return command.type !== 'set-component-mode' || !snapshot.state.attackerTargeting.components.get(command.componentId)?.selection
            || this.declarationOpen(snapshot, 'weapons');
    }

    private declarationOpen(snapshot: CBTUnitSnapshot, phase: 'weapons' | 'physical'): boolean {
        const options = this.getOptions();
        return !options || !realPhasesEnabled(options) || attackDeclarationOpen(snapshot.state.turn.turnStep, phase);
    }
}
