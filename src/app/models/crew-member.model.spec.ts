// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    CrewMember,
    CRIPPLED_CREW_WOUND_THRESHOLD,
    MAX_CREW_WOUNDS,
} from './crew-member.model';

describe('CrewMember', () => {
    it('projects one effective state while retaining independent stored facts', () => {
        const crew = CrewMember.healthy.withState({
            wounds: 2,
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
        const pending = CrewMember.healthy.withState({
            wounds: MAX_CREW_WOUNDS,
            unconscious: true,
            ejected: false,
        });

        expect(pending.isFatallyWounded()).toBeTrue();
        expect(pending.isDeathCommitted()).toBeFalse();
        expect(pending.effectiveState()).toBe('unconscious');

        const committed = pending.commitDeath();
        expect(committed.isDeathCommitted()).toBeTrue();
        expect(committed.effectiveState()).toBe('dead');
    });

    it('marks four-wound crew crippled only while alive and aboard', () => {
        const crippled = CrewMember.healthy.withState({
            wounds: CRIPPLED_CREW_WOUND_THRESHOLD,
            unconscious: false,
            ejected: false,
        });

        expect(crippled.isCrippled()).toBeTrue();
        expect(crippled.withState({
            wounds: crippled.wounds,
            unconscious: false,
            ejected: true,
        }).isCrippled()).toBeFalse();
        expect(crippled.isCrippled(true)).toBeFalse();
    });

    it('owns recovery scheduling and sparse-state decisions', () => {
        const unconscious = CrewMember.healthy.withState({
            wounds: 1,
            unconscious: true,
            ejected: false,
            recoveryReadyTurn: 3,
        });
        const rescheduled = unconscious.withState({
            wounds: 1,
            unconscious: true,
            ejected: false,
        });
        const recovered = rescheduled.withState({
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

    it('drops committed death when fatal wounds are corrected', () => {
        const committed = CrewMember.healthy.withState({
            wounds: MAX_CREW_WOUNDS,
            unconscious: false,
            ejected: false,
        }).commitDeath();

        const corrected = committed.withState({
            wounds: MAX_CREW_WOUNDS - 1,
            unconscious: false,
            ejected: false,
        });

        expect(corrected.isDeathCommitted()).toBeFalse();
        expect(corrected.effectiveState()).toBe('healthy');
    });
});
