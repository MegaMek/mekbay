// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTUnitCommand } from './unit-command';
export function commandMayChangeOperationalC3(command: CBTUnitCommand): boolean {
    switch (command.type) {
        case 'damage-internal':
        case 'repair-internal':
        case 'hit-critical':
        case 'repair-critical':
        case 'apply-mek-blow-off':
        case 'apply-mek-critical-roll':
        case 'set-system-critical-level':
        case 'set-component-status':
        case 'set-component-statuses':
        case 'set-destroyed':
        case 'set-internal-damage':
        case 'damage-track':
        case 'repair-damage-track':
        case 'set-sensor-damage-level':
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

/** Shared exhaustive classifier for runtime-BV dependency invalidation. */
export function commandMayChangeBaseBattleValue(command: CBTUnitCommand): boolean {
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
        case 'set-component-statuses':
        case 'damage-track':
        case 'repair-damage-track':
        case 'set-sensor-damage-level':
        case 'damage-shield':
        case 'repair-shield':
            return command.target === 'committed';
        case 'set-location-condition':
            return command.target === 'committed' && command.condition !== 'narc';
        case 'configure-ammo-source':
        case 'set-destroyed':
        case 'set-internal-damage':
        case 'set-armor-damage':
        case 'set-ammo-spent':
        case 'reset-ammo-loadout':
        case 'spend-ammo':
        case 'activate-coolant-pod':
        case 'fire-weapons':
        case 'detonate-booby-trap':
        case 'edit-escalating-failure':
        case 'end-phase':
        case 'end-turn':
        case 'commit-pending':
            return true;
        case 'set-component-mode':
        case 'set-airborne':
        case 'set-movement':
        case 'set-cover':
        case 'set-spotting':
        case 'set-control-recovery':
        case 'set-stealth-state':
        case 'toggle-gauss-power':
        case 'set-component-jammed':
        case 'set-ppc-capacitor-charge':
        case 'set-bombast-laser-charge':
        case 'edit-c3-emergency-master':
        case 'set-heat':
        case 'set-pending-heat':
        case 'set-heatsinks-off':
        case 'apply-heat':
        case 'set-condition':
        case 'set-mek-shutdown-state':
        case 'resolve-mek-rule-check':
        case 'set-crew-state':
        case 'declare-mek-movement':
        case 'clear-mek-movement':
        case 'declare-mek-action':
        case 'clear-mek-action':
        case 'prepare-mek-stand':
        case 'resolve-mek-stand-attempt':
        case 'adjust-mek-stand-attempts':
        case 'resolve-mek-pilot-check':
        case 'dismiss-mek-pilot-checks':
        case 'dismiss-mek-automatic-falls':
        case 'replace-turn-state':
        case 'set-pending-fall-consequences':
        case 'reset-turn-state':
        case 'mark-end-turn-heat-staged':
        case 'cancel-pending':
            return false;
        default: {
            const exhaustive: never = command;
            throw new Error(`Unclassified CBT unit command: ${String(exhaustive)}`);
        }
    }
}
