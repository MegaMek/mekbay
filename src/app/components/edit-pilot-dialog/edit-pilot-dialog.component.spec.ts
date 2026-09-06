// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { OverlayContainer } from '@angular/cdk/overlay';

import {
    buildCrewSkillPreviewEntries,
    EditPilotDialogComponent,
    getSyntheticCrewSkill,
    type EditPilotDialogData,
} from './edit-pilot-dialog.component';
import type { CrewMemberDetails } from '../../models/crew-member.model';
import { DialogsService } from '../../services/dialogs.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { PilotNameGeneratorService } from '../../services/pilot-name-generator.service';
import { UnitNameService } from '../../services/unit-name.service';
import { EditASPilotDialogComponent } from '../edit-as-pilot-dialog/edit-as-pilot-dialog.component';

const CREW: CrewMemberDetails[] = [
    { id: 0, name: 'Pilot', gunnery: 4, piloting: 2 },
    { id: 1, name: 'Gunner', gunnery: 3, piloting: 5 },
    { id: 2, name: 'Officer', gunnery: 5, piloting: 4 },
];

describe('CBT multi-crew pilot dialog logic', () => {
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

    it('uses generic and station-specific crew name labels', () => {
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
                { id: 0, name: signal(' Pilot '), notes: signal(''), portrait: signal('Doctor_M_8'), gunnery: signal(3), piloting: signal(1) },
                { id: 1, name: signal('Gunner'), notes: signal(''), portrait: signal(undefined), gunnery: signal(2), piloting: signal(2) },
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
                { id: 0, name: 'Pilot', portrait: 'Doctor_M_8', gunnery: 3, piloting: 5 },
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

describe('Pilot dialog skill previews and reserve controls', () => {
    let data: EditPilotDialogData;
    let close: jasmine.Spy;

    beforeEach(() => {
        data = {
            crew: [{ id: 0, name: 'Alex', gunnery: 4, piloting: 5 }],
            personnelActions: { canUnassign: false, canDelete: true },
            preSkillBv: 1200,
            skillFacts: { unitType: 'Mek', unitSubtype: 'BattleMek', canAntiMech: false },
        };
        close = jasmine.createSpy('close');
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(),
            { provide: DIALOG_DATA, useValue: data },
            { provide: DialogRef, useValue: { close } },
            { provide: DialogsService, useValue: { requestConfirmation: jasmine.createSpy('requestConfirmation') } },
            { provide: PilotNameGeneratorService, useValue: { generate: jasmine.createSpy('generate') } },
            { provide: LoggerService, useValue: { warn: jasmine.createSpy('warn') } },
            { provide: LayoutService, useValue: { isPhone: signal(false), windowWidth: signal(1024), windowHeight: signal(768) } },
            { provide: OptionsService, useValue: { options: () => ({ ASUseHex: false }) } },
            { provide: UnitNameService, useValue: {} },
        ] });
    });

    afterEach(() => TestBed.inject(OverlayManagerService).closeAllManagedOverlays());

    for (const action of ['unassign', 'delete'] as const) {
        it(`keeps edits when ${action} is dismissed and submits only after confirmation`, async () => {
            data.personnelActions = { canUnassign: true, canDelete: true };
            const requestConfirmation = TestBed.inject(DialogsService).requestConfirmation as jasmine.Spy;
            let resolveConfirmation!: (confirmed: boolean) => void;
            requestConfirmation.and.callFake(() => new Promise<boolean>(resolve => resolveConfirmation = resolve));
            const fixture = TestBed.createComponent(EditPilotDialogComponent);
            fixture.detectChanges();
            fixture.componentInstance.crew[0].name.set('Edited Alex');
            const label = action === 'delete' ? 'Delete' : 'Unassign';
            const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

            button.click();
            expect(requestConfirmation).toHaveBeenCalledOnceWith(
                jasmine.any(String), `${label} Crew Member`, action === 'delete' ? 'danger' : 'info',
            );
            expect(close).not.toHaveBeenCalled();
            resolveConfirmation(false);
            await fixture.whenStable();
            expect(close).not.toHaveBeenCalled();
            expect(fixture.componentInstance.crew[0].name()).toBe('Edited Alex');

            button.click();
            expect(close).not.toHaveBeenCalled();
            resolveConfirmation(true);
            await fixture.whenStable();
            expect(close).toHaveBeenCalledOnceWith(jasmine.objectContaining({ action }));
        });
    }

    it('opens the matrix between Gunnery and Piloting and applies a selected pair', async () => {
        const fixture = TestBed.createComponent(EditPilotDialogComponent);
        fixture.detectChanges();
        const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.crew-skills button');
        expect(buttons.length).toBe(3);
        expect(buttons[1].getAttribute('aria-label')).toBe('Skill Matrix');

        buttons[1].click();
        await fixture.whenStable();

        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        const cells = overlay.querySelectorAll<HTMLElement>('.matrix-cell');
        expect(cells.length).toBe(81);
        expect(cells[3 * 9 + 4].textContent?.trim()).toBe((1584).toLocaleString());
        cells[3 * 9 + 4].click();
        await fixture.whenStable();

        expect(buttons[0].textContent?.trim()).toBe('3');
        expect(buttons[2].textContent?.trim()).toBe('4');
        expect(overlay.querySelector('.matrix-panel')).toBeNull();
        fixture.componentInstance.submit();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ crew: [jasmine.objectContaining({ gunnery: 3, piloting: 4 })] }));
    });

    it('renders nonzero BV totals and positive and negative deltas in both dropdowns', async () => {
        const fixture = TestBed.createComponent(EditPilotDialogComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        root.querySelector<HTMLButtonElement>('#classic-crew-gunnery-0')!.click();
        await fixture.whenStable();

        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        let options = overlay.querySelectorAll('.skill-option');
        expect(options.length).toBe(9);
        expect(options[3].querySelector('.adjusted-value')?.textContent?.trim()).toBe('BV: 1440');
        expect(options[3].querySelector('.delta')?.textContent?.trim()).toBe('+240');
        expect(options[5].querySelector('.delta')?.textContent?.trim()).toBe('-120');

        root.querySelector<HTMLButtonElement>('#classic-crew-piloting-0')!.click();
        await fixture.whenStable();

        options = overlay.querySelectorAll('.skill-option');
        expect(options.length).toBe(9);
        expect(options[4].querySelector('.adjusted-value')?.textContent?.trim()).toBe('BV: 1320');
        expect(options[4].querySelector('.delta')?.textContent?.trim()).toBe('+120');
        expect(options[6].querySelector('.delta')?.textContent?.trim()).toBe('-60');

        root.querySelector<HTMLButtonElement>('[aria-label="Skill Matrix"]')!.click();
        await fixture.whenStable();
        expect(overlay.querySelector('.dropdown-panel')).toBeNull();
        expect(overlay.querySelector('.matrix-panel')).not.toBeNull();
    });

    it('allows a CBT reserve commander toggle and omits unavailable BV values', async () => {
        delete data.preSkillBv;
        delete data.skillFacts;
        const fixture = TestBed.createComponent(EditPilotDialogComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const commander = root.querySelector<HTMLButtonElement>('[aria-label="Set as commander"]')!;
        commander.click();
        await fixture.whenStable();

        expect(commander.getAttribute('aria-pressed')).toBe('true');
        root.querySelector<HTMLButtonElement>('#classic-crew-gunnery-0')!.click();
        await fixture.whenStable();
        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        expect(overlay.querySelectorAll('.skill-option').length).toBe(9);
        expect(overlay.querySelector('.adjusted-value')).toBeNull();
        expect(overlay.querySelector('.delta')).toBeNull();

        root.querySelector<HTMLButtonElement>('[aria-label="Skill Matrix"]')!.click();
        await fixture.whenStable();
        const cells = overlay.querySelectorAll<HTMLElement>('.matrix-cell');
        expect(cells.length).toBe(81);
        expect(cells[2 * 9 + 3].textContent?.trim()).toBe('2/3');
        expect(cells[3 * 9 + 4].textContent?.trim()).toBe('3/4');
        cells[2 * 9 + 3].click();
        await fixture.whenStable();

        fixture.componentInstance.submit();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ commander: true,
            crew: [jasmine.objectContaining({ gunnery: 2, piloting: 3 })] }));
    });

    it('allows an Alpha Strike reserve commander toggle without a unit or group', async () => {
        TestBed.overrideProvider(DIALOG_DATA, { useValue: {
            unitId: 'reserve', name: 'Alex', skill: 4, abilities: [],
            personnelActions: { canUnassign: false, canDelete: true },
        } });
        const fixture = TestBed.createComponent(EditASPilotDialogComponent);
        fixture.detectChanges();
        const commander = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Set as commander"]')!;
        commander.click();
        await fixture.whenStable();

        expect(commander.getAttribute('aria-pressed')).toBe('true');
        fixture.componentInstance.submit();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({ commander: true }));
    });
});
