// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    CrewMember,
    CRIPPLED_CREW_WOUND_THRESHOLD,
    MAX_CREW_WOUNDS,
} from './crew-member.model';

describe('CrewMember', () => {
    it('distinguishes vacancy from healthy, killed, unconscious, or ejected people', () => {
        expect(CrewMember.vacant.effectiveState()).toBe('vacant');
        expect(CrewMember.vacant.effectiveState(true)).toBe('vacant');
        expect(CrewMember.vacant.isAvailable()).toBeFalse();
        expect(CrewMember.vacant.isAboard()).toBeFalse();
        expect(CrewMember.vacant.isCrippled()).toBeFalse();
        expect(CrewMember.vacant.hasState('healthy')).toBeFalse();
        expect(CrewMember.vacant.hasState('killed', true)).toBeFalse();
        expect(CrewMember.vacant.equals(CrewMember.healthy)).toBeFalse();
        expect(CrewMember.from()).toBe(CrewMember.healthy);
    });

    it('projects one effective state while retaining independent stored facts', () => {
        const crew = CrewMember.healthy.withManualDeath({
            unconscious: true,
            ejected: true,
            dead: true,
        });

        expect(crew.effectiveState()).toBe('dead');
        expect(crew.hasState('dead')).toBeTrue();
        expect(crew.hasState('killed')).toBeTrue();
        expect(crew.hasState('unconscious')).toBeTrue();
        expect(crew.hasState('ejected')).toBeTrue();
        expect(crew.hasState('stunned')).toBeTrue();
        expect(crew.isAvailable()).toBeFalse();
        expect(crew.isAboard()).toBeFalse();
    });

    it('keeps fatal wounds pending until death is committed', () => {
        const pending = CrewMember.healthy.withWoundTrackedState({
            wounds: MAX_CREW_WOUNDS,
            unconscious: true,
            ejected: false,
        });

        expect(pending.isFatallyWounded()).toBeTrue();
        expect(pending.isDeathCommitted()).toBeFalse();
        expect(pending.effectiveState()).toBe('unconscious');
        expect(pending.isAvailable()).toBeFalse();

        const committed = pending.commitDeath();
        expect(committed.isDeathCommitted()).toBeTrue();
        expect(committed.effectiveState()).toBe('dead');
    });

    it('marks four-wound crew crippled only while alive and aboard', () => {
        const crippled = CrewMember.healthy.withWoundTrackedState({
            wounds: CRIPPLED_CREW_WOUND_THRESHOLD,
            unconscious: false,
            ejected: false,
        });

        expect(crippled.isCrippled()).toBeTrue();
        expect(crippled.withWoundTrackedState({
            wounds: crippled.wounds,
            unconscious: false,
            ejected: true,
        }).isCrippled()).toBeFalse();
        expect(crippled.isCrippled(true)).toBeFalse();
    });

    it('owns recovery scheduling and sparse-state decisions', () => {
        const unconscious = CrewMember.healthy.withWoundTrackedState({
            wounds: 1,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn: 3,
        });
        const rescheduled = unconscious.withWoundTrackedState({
            wounds: 1,
            unconscious: true,
            ejected: false,
        });
        const recovered = rescheduled.withWoundTrackedState({
            wounds: 0,
            unconscious: false,
            ejected: false,
        });

        expect(rescheduled.recoveryReadyTurn).toBe(3);
        expect(recovered.recoveryReadyTurn).toBeUndefined();
        expect(recovered.isPristine()).toBeTrue();
        expect(recovered.toRuntimeState()).toEqual({
            wounds: 0,
            unconscious: false,
            ejected: false,
        });
    });

    it('drops automatic death when fatal wounds are corrected', () => {
        const committed = CrewMember.healthy.withWoundTrackedState({
            wounds: MAX_CREW_WOUNDS,
            unconscious: false,
            ejected: false,
        }).commitDeath();

        const corrected = committed.withWoundTrackedState({
            wounds: MAX_CREW_WOUNDS - 1,
            unconscious: false,
            ejected: false,
        });

        expect(corrected.isDeathCommitted()).toBeFalse();
        expect(corrected.effectiveState()).toBe('healthy');
    });

    it('canonicalizes a manual Killed switch to six or zero wounds', () => {
        const killed = CrewMember.healthy.withManualDeath({
            unconscious: false,
            ejected: false,
            dead: true,
        });

        expect(killed.isDeathCommitted()).toBeTrue();
        expect(killed.wounds).toBe(MAX_CREW_WOUNDS);
        const restored = killed.withManualDeath({
            unconscious: false,
            ejected: false,
            dead: false,
        });
        expect(restored.isDeathCommitted()).toBeFalse();
        expect(restored.wounds).toBe(0);
        expect(restored.isPristine()).toBeTrue();
    });
});
