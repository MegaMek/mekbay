// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { TnTargetNumberCalculatorState } from '../target-number-calculator.model';
import { aimedShotChoices } from './aimed-shot-choices';
import { asEncounterTargetId, type TargetRegistrySnapshot } from './encounter-runtime';
import {
    projectMekEquipmentPanel,
    projectTargetingTarget,
    projectWeaponTargetPresentation,
    type WeaponAttackContext,
} from './equipment-panel';
import { createDirectTargetingComputerRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('aimed shot target numbers', () => {
    const targetId = asEncounterTargetId('target:aimed');
    const attack: WeaponAttackContext = Object.freeze({
        gunnery: 4, pilotingSkill: 5, movementMode: null, allowExtremeRange: false, missingMovementModifier: false,
        attackModifierBreakdown: Object.freeze([]), c3DegradationSource: 'none', c3Available: true,
    });

    /** The fixture's laser and HAG, both aided by its targeting computer, fired at one 'Mech. */
    function declared(
        calculator: TnTargetNumberCalculatorState,
        ruleset: CBTRuleset = 'core-2026',
        aim?: string,
        partialCover = false,
    ) {
        const fixture = createDirectTargetingComputerRuntimeFixture(ruleset);
        const registry: TargetRegistrySnapshot = Object.freeze({
            revision: 0,
            targets: Object.freeze([Object.freeze({
                id: targetId, letter: 'A', name: 'Target', color: '#123456', unitType: 'mek-biped' as const,
                tnCalculator: Object.freeze(calculator),
            })]),
        });
        const laser = fixture.equipmentComponent('ISMediumLaser');
        // A rejected edit leaves the targeting unchanged.
        const edit = (change: object) => fixture.instance.dispatchAttackerTargeting(
            { type: 'edit-attacker-targeting', edit: change } as never, registry, false).changed;
        expect(edit({
            kind: 'set-component-selection', componentId: laser.id,
            selection: { kind: 'target', targetId, ...(aim === undefined ? {} : { aim }) },
        })).toBeTrue();
        // Partial cover is what this attacker sees of the target, from beyond the adjacent hex.
        if (partialCover) {
            expect(edit({
                kind: 'set-target-facts', targetId, facts: { distance: 3, calculator: { partialCover: true } },
            })).toBeTrue();
        }
        const panel = projectMekEquipmentPanel(
            fixture.entity, fixture.index, fixture.instance.ruleset(), fixture.instance.query(), registry, {});
        const row = (equipmentId: string) =>
            panel.components.find(component => component.componentId === fixture.equipmentComponent(equipmentId).id)!;
        const target = projectTargetingTarget(panel.targets[0], panel.ruleset);
        const number = (aimAt?: string | null) => {
            const presentation = projectWeaponTargetPresentation(row('ISMediumLaser'), target, attack, panel.ruleset, aimAt);
            return { total: presentation.targetNumberBreakdown?.total, aim: presentation.aim?.location ?? null };
        };
        return { edit, panel, row, target, number };
    }

    it('adds +3 in place of the targeting computer against a mobile target, and never names the head', () => {
        const { number, row, target, panel } = declared({});
        const normal = number(null).total!;
        // Gunnery 4, short range, targeting computer -1.
        expect(normal).toBe(3);
        expect(number('LA')).toEqual({ total: normal + 1 + 3, aim: 'LA' });
        // The head is refused: the weapon fires normally.
        expect(number('HD')).toEqual({ total: normal, aim: null });
        expect(projectWeaponTargetPresentation(row('ISMediumLaser'), target, attack, panel.ruleset).aimedShotKind)
            .toBe('targeting-computer');
        // A HAG is a cluster weapon: its computer bonus buys no aimed shot.
        expect(projectWeaponTargetPresentation(row('Test HAG'), target, attack, panel.ruleset, 'LA').aimedShotKind)
            .toBeNull();
    });

    it('keeps the immobile -4 and the computer below the head, and trades both for +3 at the head', () => {
        for (const ruleset of ['core-2026', 'total-warfare'] as const) {
            const { number } = declared({ immobile: true }, ruleset);
            const normal = number(null).total!;
            expect(normal).toBe(-1);
            expect(number('CT')).toEqual({ total: normal, aim: 'CT' });
            expect(number('HD')).toEqual({ total: normal + 4 + 1 + 3, aim: 'HD' });
        }
    });

    it('takes no partial-cover modifier and no covered leg', () => {
        const { number } = declared({ immobile: true }, 'core-2026', undefined, true);
        const normal = number(null).total!;
        // Gunnery 4, computer -1, immobile -4, partial cover +1.
        expect(normal).toBe(0);
        expect(number('RA')).toEqual({ total: normal - 1, aim: 'RA' });
        expect(number('LL')).toEqual({ total: normal, aim: null });
    });

    it('fires at the declared location, lists a target of a declared type without its armor, and refuses physical aims', () => {
        const { number, row, target, panel, edit } = declared({ immobile: true }, 'core-2026', 'RT');
        expect(number()).toEqual({ total: number(null).total, aim: 'RT' });
        const choices = aimedShotChoices(row('ISMediumLaser'), target, attack, panel.ruleset, null);
        expect(choices.current).toBe('RT');
        expect(choices.normalTargetNumber).toBe('-1');
        expect(choices.locations.map(location => location.code)).toEqual(['HD', 'CT', 'LT', 'RT', 'LL', 'RL', 'LA', 'RA']);
        expect(choices.locations.find(location => location.code === 'HD')).toEqual(
            jasmine.objectContaining({ label: 'Head', remaining: null, rearFace: false, targetNumber: '7' }));
        // From behind the torsos are struck on their rear armor, which the rear diagram shows.
        expect(aimedShotChoices(row('ISMediumLaser'), target, attack, panel.ruleset, null, 'rear').locations
            .filter(location => location.rearFace).map(location => location.code)).toEqual(['CT', 'LT', 'RT']);
        // With the unit at hand its locations show what is left, and a destroyed one cannot be named.
        expect(aimedShotChoices(row('ISMediumLaser'), target, attack, panel.ruleset, [
            { code: 'LA', label: 'Left Arm', armor: 0, rearFace: false, frontArmor: 0, structure: 5, destroyed: false },
            { code: 'RA', label: 'Right Arm', armor: 0, rearFace: false, frontArmor: 0, structure: 0, destroyed: true },
            { code: 'CT', label: 'Center Torso', armor: 8, rearFace: true, frontArmor: 20, structure: 16, destroyed: false },
        ], 'rear').locations.map(location => [location.remaining, location.frontRemaining, location.targetNumber]))
            .toEqual([['(5)', '(5)', '-1'], ['✕', '✕', null], ['8', '20', '-1']]);

        // The left arm's laser is declared above. The opposite arm can still punch.
        const punch = panel.physicalAttacks.find(attackRow => attackRow.target.kind === 'intrinsic'
            && attackRow.target.actionId === 'intrinsic:punch:RA' && attackRow.available);
        expect(punch).toBeDefined();
        const punchAt = (aimed: object) =>
            edit({ kind: 'set-action-selection', target: punch!.target, selection: { kind: 'target', targetId, ...aimed } });
        expect(punchAt({ aim: 'HD' })).toBeFalse();
        expect(punchAt({})).toBeTrue();
    });
});
