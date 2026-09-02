// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { asCrewPositionId } from '../../../models/entity/entity-identifiers';
import type { NonMekRecordSheetCrewPosition } from '../../../models/runtime/non-mek-record-sheet';
import { nonMekCrewStateCommand } from './page-viewer-non-mek-runtime.service';

describe('PageViewerNonMekRuntimeService crew state command', () => {
    it('maps the non-Mek stunned label to canonical unconscious state', () => {
        expect(nonMekCrewStateCommand(
            position('healthy'),
            ['stunned'],
            'stunned',
        )).toEqual({
            kind: 'set-crew-state',
            
            positionId: CREW_ID,
            wounds: 0,
            unconscious: true,
            ejected: false,
        });

        expect(nonMekCrewStateCommand(
            position('stunned'),
            ['stunned'],
            'stunned',
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
        )).toEqual(jasmine.objectContaining({ dead: true, unconscious: false }));
        expect(nonMekCrewStateCommand(
            position('dead'),
            ['unconscious'],
            'dead',
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
            wounds: effectiveState === 'dead' || effectiveState === 'killed' ? 6 : 0,
            unconscious: effectiveState === 'unconscious' || effectiveState === 'stunned',
            ejected: false,
            ...(effectiveState === 'dead' || effectiveState === 'killed'
                ? { dead: true as const }
                : {}),
        }),
        effectiveState,
    });
}
