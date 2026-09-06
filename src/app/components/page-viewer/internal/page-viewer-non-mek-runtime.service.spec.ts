// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { asCrewPositionId } from '../../../models/entity/entity-identifiers';
import type { CBTForceMember } from '../../../models/force-member.model';
import type { NonMekRecordSheetCrewPosition } from '../../../models/runtime/non-mek-record-sheet';
import { DialogsService } from '../../../services/dialogs.service';
import { ForcePilotEditorService } from '../../../services/force-pilot-editor.service';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { OverlayManagerService } from '../../../services/overlay-manager.service';
import { PickerFactoryService } from '../../../services/picker-factory.service';
import { ToastService } from '../../../services/toast.service';
import { UnitNameService } from '../../../services/unit-name.service';
import { PageViewerZoomPanService } from '../page-viewer-zoom-pan.service';
import { PageViewerOverlayService } from './page-viewer-overlay.service';
import { PageViewerNonMekRuntimeService, nonMekCrewStateCommand } from './page-viewer-non-mek-runtime.service';

describe('PageViewerNonMekRuntimeService ammo loadout navigation', () => {
    it('routes the current sheet ammo interaction to its member and the ammo tab', () => {
        const overlays = jasmine.createSpyObj<PageViewerOverlayService>('PageViewerOverlayService', ['openEquipment']);
        TestBed.configureTestingModule({ providers: [
            PageViewerNonMekRuntimeService,
            { provide: PageViewerOverlayService, useValue: overlays },
            ...[
                DialogsService, ForcePilotEditorService, LoggerService, OptionsService,
                OverlayManagerService, PickerFactoryService, ToastService, UnitNameService, PageViewerZoomPanService,
            ].map(provide => ({ provide, useValue: {} })),
        ] });
        const service = TestBed.inject(PageViewerNonMekRuntimeService);
        const member = {
            id: 'tank-1',
            nonMekRecordSheetSnapshot: () => ({ stateRevision: 3 }),
        } as unknown as CBTForceMember;
        const event = new MouseEvent('click');

        service.handle(member, { kind: 'open-equipment', tab: 'ammo', expectedRevision: 3 }, event);
        expect(overlays.openEquipment).toHaveBeenCalledOnceWith('tank-1', event, 'ammo');
        service.handle(member, { kind: 'open-equipment', tab: 'ammo', expectedRevision: 2 }, event);
        expect(overlays.openEquipment).toHaveBeenCalledTimes(1);
    });
});

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
