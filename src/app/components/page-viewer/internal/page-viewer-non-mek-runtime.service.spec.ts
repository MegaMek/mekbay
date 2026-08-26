// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asCrewPositionId } from '../../../models/entity/entity-identifiers';
import type { NonMekRecordSheetCrewPosition } from '../../../models/runtime/non-mek-record-sheet';
import { asStateRevision } from '../../../models/runtime/runtime-state';
import { nonMekCrewStateCommand } from './page-viewer-non-mek-runtime.service';

describe('PageViewerNonMekRuntimeService crew state command', () => {
    it('maps the ProtoMek unconscious control without a vehicle state override', () => {
        expect(nonMekCrewStateCommand(
            position('healthy'),
            ['unconscious'],
            'unconscious',
            asStateRevision(3),
        )).toEqual({
            kind: 'set-crew-state',
            expectedRevision: asStateRevision(3),
            positionId: CREW_ID,
            wounds: 0,
            unconscious: true,
            ejected: false,
        });

        expect(nonMekCrewStateCommand(
            position('unconscious'),
            ['unconscious'],
            'unconscious',
            asStateRevision(4),
        )).toEqual(jasmine.objectContaining({
            unconscious: false,
            ejected: false,
        }));
    });

    it('keeps vehicle killed/stunned controls and rejects display-only states', () => {
        expect(nonMekCrewStateCommand(
            position('healthy'),
            ['killed', 'stunned'],
            'killed',
            asStateRevision(1),
        )).toEqual(jasmine.objectContaining({ state: 'killed' }));
        expect(nonMekCrewStateCommand(
            position('dead'),
            ['unconscious'],
            'dead',
            asStateRevision(1),
        )).toBeNull();
    });
});

const CREW_ID = asCrewPositionId('crew:0');

function position(effectiveState: NonMekRecordSheetCrewPosition['effectiveState']): NonMekRecordSheetCrewPosition {
    return Object.freeze({
        positionId: CREW_ID,
        occurrence: 0,
        name: 'Crew 1',
        role: 'Crew',
        gunnery: 4,
        piloting: 5,
        state: Object.freeze({
            wounds: effectiveState === 'dead' ? 6 : 0,
            unconscious: effectiveState === 'unconscious',
            ejected: false,
        }),
        effectiveState,
    });
}
