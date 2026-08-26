// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';

import {
    buildCrewSkillPreviewEntries,
    EditPilotDialogComponent,
    getSyntheticCrewSkill,
} from './edit-pilot-dialog.component';
import type { CrewMemberDetails } from '../../models/crew.model';

const CREW: CrewMemberDetails[] = [
    { id: 0, name: 'Pilot', gunnery: 4, piloting: 2 },
    { id: 1, name: 'Gunner', gunnery: 3, piloting: 5 },
    { id: 2, name: 'Officer', gunnery: 5, piloting: 4 },
];

describe('Classic multi-crew pilot dialog logic', () => {
    it('selects independent minimum Gunnery and Piloting values', () => {
        expect(getSyntheticCrewSkill(CREW, 'gunnery')).toBe(3);
        expect(getSyntheticCrewSkill(CREW, 'piloting')).toBe(2);
    });

    it('includes additional non-editable skills and falls back for empty crew', () => {
        expect(getSyntheticCrewSkill(CREW, 'gunnery', [1])).toBe(1);
        expect(getSyntheticCrewSkill([{ ...CREW[0], asfGunnery: 2 }], 'gunnery')).toBe(2);
        expect(getSyntheticCrewSkill([], 'gunnery')).toBe(4);
        expect(getSyntheticCrewSkill([], 'piloting')).toBe(5);
    });

    it('shows no Piloting BV variation at or above another member minimum', () => {
        const entries = buildCrewSkillPreviewEntries(
            CREW,
            1,
            'piloting',
            (gunnery, piloting) => gunnery * 100 + piloting,
        );

        expect(entries.slice(2).map((entry) => entry.adjustedValue)).toEqual(Array(7).fill(302));
        expect(entries[0].adjustedValue).toBe(300);
        expect(entries[1].adjustedValue).toBe(301);
    });

    it('shows no Gunnery BV variation at or above another member minimum', () => {
        const entries = buildCrewSkillPreviewEntries(
            CREW,
            2,
            'gunnery',
            (gunnery, piloting) => gunnery * 100 + piloting,
        );

        expect(entries.slice(3).map((entry) => entry.adjustedValue)).toEqual(Array(6).fill(302));
        expect(entries[2].adjustedValue).toBe(202);
    });

    it('previews aerospace skill changes against all ground and crew minima', () => {
        const crew = [
            { id: 0, name: 'LAM Pilot', gunnery: 4, piloting: 5, asfGunnery: 6, asfPiloting: 7 },
            { id: 1, name: 'LAM Gunner', gunnery: 3, piloting: 4, asfGunnery: 5, asfPiloting: 6 },
        ];
        const entries = buildCrewSkillPreviewEntries(
            crew,
            0,
            'asfGunnery',
            (gunnery, piloting) => gunnery * 100 + piloting,
        );

        expect(entries[2].adjustedValue).toBe(204);
        expect(entries[8].adjustedValue).toBe(304);
    });

    it('uses generic and role-specific crew name labels', () => {
        expect(EditPilotDialogComponent.prototype.crewNameLabel.call({ crew: [CREW[0]] }, 0)).toBe('Name');
        expect(EditPilotDialogComponent.prototype.crewNameLabel.call({ crew: CREW }, 0)).toBe('Pilot Name');
        expect(EditPilotDialogComponent.prototype.crewNameLabel.call({ crew: CREW }, 1)).toBe('Gunner Name');
        expect(EditPilotDialogComponent.prototype.crewNameLabel.call({ crew: CREW }, 2)).toBe('Officer Name');
        expect(EditPilotDialogComponent.prototype.crewNameLabel.call({ crew: [...CREW, { ...CREW[0], id: 3 }] }, 3))
            .toBe('Crew Member 4 Name');
    });

    it('submits every crew member, trims names, and preserves fixed Piloting', () => {
        const close = jasmine.createSpy('close');
        const harness = {
            crew: [
                { id: 0, name: signal(' Pilot '), gunnery: signal(3), piloting: signal(1) },
                { id: 1, name: signal('Gunner'), gunnery: signal(2), piloting: signal(2) },
            ],
            data: {
                disablePiloting: true,
                crew: [
                    { id: 0, name: '', gunnery: 4, piloting: 5 },
                    { id: 1, name: '', gunnery: 4, piloting: 6 },
                ],
            },
            selectedGroupCommander: () => true,
            dialogRef: { close },
            crewSnapshot: (EditPilotDialogComponent.prototype as any).crewSnapshot,
        };

        EditPilotDialogComponent.prototype.submit.call(harness as never);

        expect(close).toHaveBeenCalledOnceWith({
            crew: [
                { id: 0, name: 'Pilot', gunnery: 3, piloting: 5 },
                { id: 1, name: 'Gunner', gunnery: 2, piloting: 6 },
            ],
            commander: true,
        });
    });

    it('applies a matrix selection to every crew member', () => {
        const harness = {
            crew: CREW.map((member) => ({
                gunnery: signal(member.gunnery),
                piloting: signal(member.piloting),
                asfGunnery: signal(8),
                asfPiloting: signal(8),
            })),
            data: { disablePiloting: false },
        };

        EditPilotDialogComponent.prototype.setAllCrewSkills.call(harness as never, { gunnery: 2, piloting: 3, bv: 0 });

        expect(harness.crew.map((member) => member.gunnery())).toEqual([2, 2, 2]);
        expect(harness.crew.map((member) => member.piloting())).toEqual([3, 3, 3]);
        expect(harness.crew.map((member) => member.asfGunnery())).toEqual([2, 2, 2]);
        expect(harness.crew.map((member) => member.asfPiloting())).toEqual([3, 3, 3]);
    });

    it('preserves fixed Piloting when applying a matrix selection', () => {
        const harness = {
            crew: CREW.map((member) => ({
                gunnery: signal(member.gunnery),
                piloting: signal(member.piloting),
            })),
            data: { disablePiloting: true },
        };

        EditPilotDialogComponent.prototype.setAllCrewSkills.call(harness as never, { gunnery: 1, piloting: 0, bv: 0 });

        expect(harness.crew.map((member) => member.gunnery())).toEqual([1, 1, 1]);
        expect(harness.crew.map((member) => member.piloting())).toEqual([2, 5, 4]);
    });

    it('generates a name for only the requested crew member and prevents duplicate requests', async () => {
        const firstInput = document.createElement('input');
        const secondInput = document.createElement('input');
        firstInput.maxLength = secondInput.maxLength = 8;
        const generate = jasmine.createSpy('generate').and.resolveTo('Long Gunner Name');
        const harness = {
            crew: [
                { name: signal('Pilot'), generatingName: signal(false) },
                { name: signal(''), generatingName: signal(false) },
            ],
            nameInputs: () => [
                { nativeElement: firstInput },
                { nativeElement: secondInput },
            ],
            pilotNameGenerator: { generate },
            logger: { warn: jasmine.createSpy('warn') },
            data: { factionId: null },
            selectedGroupCommander: () => false,
        };

        await EditPilotDialogComponent.prototype.fillRandomName.call(harness as never, 1);

        expect(harness.crew[0].name()).toBe('Pilot');
        expect(harness.crew[1].name()).toBe('Long Gun');
        expect(secondInput.value).toBe('Long Gun');
        expect(harness.crew[1].generatingName()).toBeFalse();
        expect(generate).toHaveBeenCalledTimes(1);

        harness.crew[1].generatingName.set(true);
        await EditPilotDialogComponent.prototype.fillRandomName.call(harness as never, 1);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('confirms commander replacement using only detached dialog context', async () => {
        const selected = signal(false);
        const requestConfirmation = jasmine.createSpy('requestConfirmation').and.resolveTo(true);
        const harness = {
            commanderSelectionRequestId: 0,
            selectedGroupCommander: selected,
            data: { commanderContext: { conflictingCommanderDisplayName: 'Marauder (Kara)' } },
            dialogsService: { requestConfirmation },
        };

        await EditPilotDialogComponent.prototype.setGroupCommanderSelected.call(harness as never, true);

        expect(requestConfirmation).toHaveBeenCalledTimes(1);
        expect(selected()).toBeTrue();
    });
});
