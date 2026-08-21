// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CBTForceUnit } from '../../models/cbt-force-unit.model';
import { MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { CriticalSlot, SerializedPendingUnitCheck } from '../../models/force-serialization';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../models/rules/game-rules';
import { MekCriticalHitAutomationService } from '../../services/mek-critical-hit-automation.service';
import { MekCriticalRollDialogComponent } from './mek-critical-roll-dialog.component';

describe('MekCriticalRollDialogComponent', () => {
    let fixture: ComponentFixture<MekCriticalRollDialogComponent>;
    let caseIISlot: CriticalSlot;
    let criticalSlots: CriticalSlot[];
    let dialogRef: { close: jasmine.Spy };
    let previewRoll: jasmine.Spy;
    let applyRoll: jasmine.Spy;
    let dialogData: {
        unit: CBTForceUnit;
        location: string;
        requiredHits: number;
        consolidateImmediately: boolean;
        locationDestroyed?: boolean;
        pendingCriticalId?: string;
        manual?: boolean;
        caseIICheckRequired?: boolean;
        caseIICheckPassed?: boolean;
        caseIICheckResult?: 'resolve' | 'discard';
        canUndoToChance?: boolean;
    };
    let getPendingCriticalHit: jasmine.Spy;
    let setPendingCriticalRoll: jasmine.Spy;
    let clearPendingCriticalRoll: jasmine.Spy;
    let resolvePendingCriticalHit: jasmine.Spy;
    let discardPendingCriticalHits: jasmine.Spy;
    let setPendingCriticalCaseIICheckResult: jasmine.Spy;
    let passPendingCriticalCaseIICheck: jasmine.Spy;
    let pendingUnitChecks: WritableSignal<SerializedPendingUnitCheck[]>;
    const slotsVersion = signal(0);

    beforeEach(async () => {
        const caseII = new MiscEquipment({
            id: 'ISCASEII',
            name: 'CASE II',
            type: 'misc',
            flags: ['F_CASE_II'],
        });
        const weapon = new WeaponEquipment({
            id: 'MediumLaser',
            name: 'Medium Laser',
            type: 'weapon',
        });
        const secondWeapon = new WeaponEquipment({
            id: 'SmallLaser',
            name: 'Small Laser',
            type: 'weapon',
        });
        const inapplicableElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        inapplicableElement.setAttribute('hittable', '0');
        caseIISlot = { id: 'caseii@LT', name: caseII.name, loc: 'LT', slot: 1, eq: caseII, el: inapplicableElement };
        criticalSlots = [
            { id: 'laser@LT', name: weapon.name, loc: 'LT', slot: 0, eq: weapon },
            caseIISlot,
            { id: 'small-laser@LT', name: secondWeapon.name, loc: 'LT', slot: 2, eq: secondWeapon },
            { id: 'destroyed-laser@LT', name: weapon.name, loc: 'LT', slot: 3, eq: weapon, hits: 1, destroyed: 1 },
        ];
        dialogRef = { close: jasmine.createSpy('close') };
        previewRoll = jasmine.createSpy('previewRoll').and.returnValue(null);
        applyRoll = jasmine.createSpy('applyRoll').and.resolveTo({
            cancelled: false,
            outcome: {
                applied: false,
                slotNumber: 2,
                equipment: 'CASE II',
                armoredAbsorption: false,
                reason: 'unhittable',
            },
        });
        getPendingCriticalHit = jasmine.createSpy('getPendingCriticalHit').and.returnValue(undefined);
        setPendingCriticalRoll = jasmine.createSpy('setPendingCriticalRoll').and.returnValue(true);
        clearPendingCriticalRoll = jasmine.createSpy('clearPendingCriticalRoll').and.returnValue(true);
        resolvePendingCriticalHit = jasmine.createSpy('resolvePendingCriticalHit').and.returnValue(true);
        discardPendingCriticalHits = jasmine.createSpy('discardPendingCriticalHits').and.returnValue(true);
        setPendingCriticalCaseIICheckResult = jasmine.createSpy('setPendingCriticalCaseIICheckResult').and.returnValue(true);
        passPendingCriticalCaseIICheck = jasmine.createSpy('passPendingCriticalCaseIICheck').and.returnValue(true);
        pendingUnitChecks = signal([]);
        const turnState = {
            getPendingCriticalHit,
            setPendingCriticalRoll,
            clearPendingCriticalRoll,
            resolvePendingCriticalHit,
            discardPendingCriticalHits,
            setPendingCriticalCaseIICheckResult,
            passPendingCriticalCaseIICheck,
            actionablePendingUnitChecks: () => pendingUnitChecks(),
        };
        const unit = {
            gameRules: CORE_2026_GAME_RULES,
            rules: { mountedCriticalDamageDestructionThreshold: () => 1 },
            turnState: () => turnState,
            getCritSlots: () => {
                slotsVersion();
                return criticalSlots;
            },
            getCritSlot: (location: string, slot: number) => {
                slotsVersion();
                return criticalSlots.find(candidate => candidate.loc === location && candidate.slot === slot) ?? null;
            },
            getUnit: () => ({ comp: [] }),
        } as unknown as CBTForceUnit;
        dialogData = {
            unit,
            location: 'LT',
            requiredHits: 1,
            consolidateImmediately: true,
            pendingCriticalId: '0198b234-7abc-7def-8123-456789abcdef',
        };

        await TestBed.configureTestingModule({
            imports: [MekCriticalRollDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: dialogRef },
                { provide: MekCriticalHitAutomationService, useValue: { previewRoll, applyRoll } },
                { provide: DIALOG_DATA, useValue: dialogData },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();
    });

    it('keeps the initial location protection visible after it is destroyed', () => {
        const element = fixture.nativeElement as HTMLElement;

        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');

        caseIISlot.destroyed = 1;
        slotsVersion.update(version => version + 1);
        fixture.detectChanges();

        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');
    });

    it('animates to dice faces for a valid critical slot', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const roller = fixture.componentInstance.roller()!;
        const roll = spyOn(roller, 'roll');

        fixture.componentInstance.roll();

        expect(roll).toHaveBeenCalledOnceWith([1, 1]);
    });

    it('omits sequence UNDO when a queued critical has no chance step to return to', () => {
        const actions = fixture.nativeElement.querySelectorAll(
            '.actions .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(Array.from(actions, action => action.textContent?.trim()))
            .toEqual(['APPLY', 'CLOSE']);
        expect(actions[0].disabled).toBeTrue();
        expect(actions[1].disabled).toBeFalse();
        expect(fixture.nativeElement.querySelector('.critical-sequence-undo')).toBeNull();
    });

    it('uses CANCEL for a transient manual critical without touching pending events', () => {
        fixture.destroy();
        dialogData.manual = true;
        dialogData.pendingCriticalId = undefined;
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        const actions = fixture.nativeElement.querySelectorAll(
            '.actions .bt-button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(Array.from(actions, action => action.textContent?.trim()))
            .toEqual(['APPLY', 'CANCEL']);
        expect(fixture.nativeElement.querySelector('.critical-sequence-undo')).toBeNull();
        actions[1].click();

        expect(setPendingCriticalRoll).not.toHaveBeenCalled();
        expect(clearPendingCriticalRoll).not.toHaveBeenCalled();
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
        expect(discardPendingCriticalHits).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: false });
    });

    it('applies a transient manual critical without creating or resolving pending work', async () => {
        fixture.destroy();
        dialogData.manual = true;
        dialogData.pendingCriticalId = undefined;
        applyRoll.and.resolveTo({
            cancelled: false,
            outcome: {
                applied: true,
                slotNumber: 1,
                equipment: 'Medium Laser',
                armoredAbsorption: false,
            },
        });
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();

        expect(applyRoll).toHaveBeenCalledOnceWith(
            dialogData.unit,
            'LT',
            [1, 1],
            true,
            jasmine.any(Object),
        );
        expect(setPendingCriticalRoll).not.toHaveBeenCalled();
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });

    it('previews explosion damage as soon as a hit target is selected and removes it on local UNDO', () => {
        previewRoll.and.returnValue({
            applied: true,
            slotNumber: 1,
            equipment: 'AC/10 Ammo',
            armoredAbsorption: false,
            explosion: {
                timing: 'immediate',
                equipment: 'AC/10 Ammo',
                rawDamage: 20,
                pilotHits: 1,
                locations: [{
                    location: 'LT',
                    internalDamage: 12,
                    armorDamage: 8,
                    armorRear: true,
                    protection: 'case-ii',
                }],
                automaticCriticalEquipment: 'Engine',
            },
        });

        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.detectChanges();

        const preview = fixture.nativeElement.querySelector('.explosion-result') as HTMLElement;
        expect(preview.textContent).toContain('AC/10 Ammo explosion: 20 damage');
        expect(preview.textContent).toContain('12 internal');
        expect(preview.textContent).toContain('8 rear armor');
        expect(preview.textContent).toContain('CASE II');
        expect(preview.textContent).toContain('MechWarrior feedback: 1 hit');
        expect(preview.textContent).toContain('Engine: automatic critical will be applied');
        expect(applyRoll).not.toHaveBeenCalled();

        const selectedRows = fixture.nativeElement.querySelectorAll(
            '.critical-slot-option',
        ) as NodeListOf<HTMLElement>;
        expect(selectedRows).toHaveSize(2);
        expect(selectedRows[0].classList).not.toContain('critical-slot-collapsed');
        expect(selectedRows[1].classList).toContain('critical-slot-collapsed');
        expect(getComputedStyle(selectedRows[1]).height).toBe('18px');
        const selectedName = selectedRows[0].querySelector('.critical-slot-name') as HTMLElement;
        const collapsedName = selectedRows[1].querySelector('.critical-slot-name') as HTMLElement;
        expect(collapsedName.textContent).toContain('Small Laser');
        expect(parseFloat(getComputedStyle(collapsedName).fontSize))
            .toBeLessThan(parseFloat(getComputedStyle(selectedName).fontSize));
        expect(fixture.nativeElement.querySelector('.critical-random-row')).toBeNull();

        (fixture.nativeElement.querySelector('.critical-slot-hit-button') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.explosion-result')).toBeNull();
        expect(fixture.nativeElement.querySelector('.critical-random-row')).not.toBeNull();
        expect(Array.from(fixture.nativeElement.querySelectorAll(
            '.critical-slot-option',
        ) as NodeListOf<HTMLElement>).every(row => !row.classList.contains('critical-slot-collapsed')))
            .toBeTrue();
    });

    it('stages a physical slot choice with only a local UNDO before applying it', async () => {
        caseIISlot.hits = 1;
        caseIISlot.destroyed = 1;
        slotsVersion.update(version => version + 1);
        fixture.detectChanges();
        applyRoll.and.resolveTo({
            cancelled: false,
            outcome: {
                applied: true,
                slotNumber: 1,
                equipment: 'Medium Laser',
                armoredAbsorption: false,
            },
        });
        const choices = fixture.nativeElement.querySelectorAll(
            '.critical-slot-option',
        ) as NodeListOf<HTMLElement>;
        const hitButtons = fixture.nativeElement.querySelectorAll(
            '.critical-slot-hit-button',
        ) as NodeListOf<HTMLButtonElement>;

        expect(choices).toHaveSize(2);
        expect(Array.from(choices, choice => choice.querySelector('.critical-slot-number')?.textContent?.trim()))
            .toEqual(['1', '3']);
        expect(Array.from(choices, choice => choice.querySelector('.critical-slot-name')?.textContent?.trim()))
            .toEqual(['Medium Laser', 'Small Laser']);
        expect(hitButtons).toHaveSize(2);
        expect(Array.from(hitButtons, button => button.textContent?.trim())).toEqual(['HIT', 'HIT']);
        expect(Array.from(choices, choice => choice.textContent).join(' ')).not.toContain('CASE II');
        const unavailableSlots = fixture.nativeElement.querySelectorAll(
            '.critical-slot-unavailable',
        ) as NodeListOf<HTMLElement>;
        expect(unavailableSlots).toHaveSize(10);
        expect(getComputedStyle(unavailableSlots[0]).height).toBe('4px');
        expect(unavailableSlots[0].classList).not.toContain('critical-slot-destroyed');
        expect(unavailableSlots[1].classList).toContain('critical-slot-destroyed');

        hitButtons[0].click();
        fixture.detectChanges();

        expect(setPendingCriticalRoll).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId, [1, 1]);
        expect(applyRoll).not.toHaveBeenCalled();
        let selectedChoices = fixture.nativeElement.querySelectorAll(
            '.critical-slot-option',
        ) as NodeListOf<HTMLElement>;
        let selectedHitButtons = fixture.nativeElement.querySelectorAll(
            '.critical-slot-hit-button',
        ) as NodeListOf<HTMLButtonElement>;
        expect(selectedChoices).toHaveSize(2);
        expect(selectedHitButtons).toHaveSize(1);
        expect(selectedHitButtons[0].textContent).toContain('UNDO');
        expect(selectedChoices[0].classList).toContain('critical-slot-hit');
        expect(selectedChoices[0].classList).not.toContain('critical-slot-dimmed');
        expect(selectedChoices[1].classList).toContain('critical-slot-dimmed');
        expect(selectedChoices[1].classList).toContain('critical-slot-collapsed');
        expect(getComputedStyle(selectedChoices[1]).height).toBe('18px');
        expect(selectedChoices[1].classList).not.toContain('critical-slot-hit');
        const selectedUnavailableSlots = fixture.nativeElement.querySelectorAll(
            '.critical-slot-unavailable',
        ) as NodeListOf<HTMLElement>;
        expect(Array.from(selectedUnavailableSlots)
            .every(line => line.classList.contains('critical-slot-dimmed'))).toBeTrue();
        expect((fixture.nativeElement.querySelector('.actions .bt-button.primary') as HTMLButtonElement)
            .textContent).toContain('APPLY');

        selectedHitButtons[0].click();
        fixture.detectChanges();

        expect(clearPendingCriticalRoll).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId);
        expect(applyRoll).not.toHaveBeenCalled();
        expect(Array.from(fixture.nativeElement.querySelectorAll(
            '.critical-slot-option',
        ) as NodeListOf<HTMLElement>).every(row => !row.classList.contains('critical-slot-collapsed')))
            .toBeTrue();
        expect(Array.from(fixture.nativeElement.querySelectorAll('.critical-slot-hit-button') as NodeListOf<HTMLButtonElement>,
            button => button.textContent?.trim())).toEqual(['HIT', 'HIT']);

        (fixture.nativeElement.querySelector('.critical-slot-hit-button') as HTMLButtonElement).click();
        fixture.detectChanges();
        (fixture.nativeElement.querySelector('.actions .bt-button.primary') as HTMLButtonElement).click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(applyRoll).toHaveBeenCalledOnceWith(
            dialogData.unit,
            'LT',
            [1, 1],
            true,
            jasmine.any(Object),
        );
        expect(fixture.nativeElement.querySelector('.critical-result')?.textContent).toContain('Medium Laser');
    });

    it('stages a dice result through the same row-level UNDO path', () => {
        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.detectChanges();

        let hitButtons = fixture.nativeElement.querySelectorAll(
            '.critical-slot-hit-button',
        ) as NodeListOf<HTMLButtonElement>;
        expect(hitButtons).toHaveSize(1);
        expect(hitButtons[0].textContent).toContain('UNDO');
        expect(applyRoll).not.toHaveBeenCalled();
        expect((fixture.nativeElement.querySelector('.actions .bt-button.primary') as HTMLButtonElement)
            .textContent).toContain('APPLY');

        hitButtons[0].click();
        fixture.detectChanges();

        hitButtons = fixture.nativeElement.querySelectorAll(
            '.critical-slot-hit-button',
        ) as NodeListOf<HTMLButtonElement>;
        expect(clearPendingCriticalRoll).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId);
        expect(Array.from(hitButtons, button => button.textContent?.trim())).toEqual(['HIT', 'HIT']);
    });

    it('automatically retries if a selected slot becomes invalid before the roll finishes', async () => {
        const roll = spyOn(fixture.componentInstance, 'roll');

        fixture.componentInstance.onFinished({ results: [1, 2] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.critical-result')).toBeNull();
        expect(fixture.componentInstance.appliedHits()).toBe(0);
        expect(roll).toHaveBeenCalledTimes(1);
    });

    it('discards a non-explosive result instead of rerolling it for a destroyed location', async () => {
        dialogData.locationDestroyed = true;
        applyRoll.and.resolveTo({
            cancelled: false,
            outcome: {
                applied: false,
                slotNumber: 2,
                equipment: 'Heat Sink',
                armoredAbsorption: false,
                reason: 'non-explosive',
            },
        });
        const roll = spyOn(fixture.componentInstance, 'roll');

        fixture.componentInstance.onFinished({ results: [1, 2] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.componentInstance.appliedHits()).toBe(0);
        expect(fixture.componentInstance.discardedHits()).toBe(1);
        expect(fixture.componentInstance.complete()).toBeTrue();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
        expect(fixture.nativeElement.querySelector('.critical-result')?.textContent)
            .toContain('not explosive — critical discarded');
        const unavailableSlots = fixture.nativeElement.querySelectorAll(
            '.critical-slot-unavailable',
        ) as NodeListOf<HTMLElement>;
        expect(unavailableSlots[0].classList).toContain('critical-slot-hit');
        expect(unavailableSlots[0].classList).not.toContain('critical-slot-dimmed');
        expect(Array.from(unavailableSlots)
            .filter((_, index) => index !== 0)
            .every(line => line.classList.contains('critical-slot-dimmed'))).toBeTrue();
        expect(roll).not.toHaveBeenCalled();
    });

    it('keeps a cancelled explosion review available without applying the critical hit', async () => {
        applyRoll.and.resolveTo({ cancelled: true, outcome: null });

        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.componentInstance.appliedHits()).toBe(0);
        expect(fixture.componentInstance.primaryLabel()).toBe('APPLY');
        expect(fixture.nativeElement.querySelector('.critical-result')?.textContent)
            .toContain('rolled hit has not been applied');
    });

    it('omits zero-valued explosion effects while preserving armor-only and no-damage results', async () => {
        applyRoll.and.resolveTo({
            cancelled: false,
            outcome: {
                applied: true,
                slotNumber: 1,
                equipment: 'Ammo',
                armoredAbsorption: false,
                explosion: {
                    equipment: 'Ammo',
                    rawDamage: 20,
                    pilotHits: 0,
                    locations: [
                        {
                            location: 'LT',
                            internalDamage: 0,
                            armorDamage: 5,
                            armorRear: true,
                            protection: 'case-ii',
                        },
                        {
                            location: 'CT',
                            internalDamage: 0,
                            armorDamage: 0,
                            armorRear: false,
                            protection: 'none',
                        },
                    ],
                },
            },
        });

        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();
        fixture.detectChanges();

        const summary = fixture.nativeElement.querySelector('.explosion-result')?.textContent ?? '';
        expect(summary).toContain('5 rear armor');
        expect(summary).toContain('No damage');
        expect(summary).not.toContain('0 internal');
        expect(summary).not.toContain('MechWarrior feedback');
    });

    it('persists a rolled hit and leaves it pending when review is cancelled', async () => {
        dialogData.pendingCriticalId = 'critical:1';
        applyRoll.and.resolveTo({ cancelled: true, outcome: null });

        fixture.componentInstance.onFinished({ results: [2, 5] });
        fixture.componentInstance.close();

        expect(setPendingCriticalRoll).toHaveBeenCalledOnceWith('critical:1', [2, 5]);
        expect(applyRoll).not.toHaveBeenCalled();
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: false });
    });

    it('cannot be dismissed while critical dice are rolling', () => {
        const roller = fixture.componentInstance.roller()!;
        spyOn(roller, 'isRolling').and.returnValue(true);

        fixture.componentInstance.close();

        expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('pauses a Total Warfare critical chain for immediate consciousness', () => {
        (dialogData.unit as unknown as { gameRules: typeof TW_GAME_RULES }).gameRules = TW_GAME_RULES;
        pendingUnitChecks.set([{
            type: 'unit-check',
            id: 'consciousness:1',
            kind: 'consciousness',
            crewId: 0,
            pilotDamageGroup: 'immediate:test',
            target: 5,
        }]);
        fixture.componentInstance.outcome.set({
            applied: true,
            slotNumber: 1,
            equipment: 'Medium Laser',
            armoredAbsorption: false,
        });
        fixture.componentInstance.appliedHits.set(1);
        fixture.detectChanges();

        const primary = fixture.nativeElement.querySelector('.actions .bt-button.primary') as HTMLButtonElement;
        expect(primary.textContent).toContain('CONTINUE');

        fixture.componentInstance.primaryAction();

        expect(dialogRef.close).toHaveBeenCalledOnceWith({
            completed: true,
            interruptedForConsciousness: true,
        });
    });

    it('offers physical CASE II outcomes before exposing critical slots', () => {
        fixture.destroy();
        dialogData.caseIICheckRequired = true;
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        const options = fixture.nativeElement.querySelectorAll(
            '.case-ii-manual-options .bt-button',
        ) as NodeListOf<HTMLButtonElement>;
        expect(Array.from(options, button => button.textContent?.trim())).toEqual([
            '2–7 · RESOLVE CRITICAL',
            '8+ · DISCARD CRITICAL',
        ]);
        expect(options[1].classList).toContain('danger');
        expect(fixture.nativeElement.querySelector('.critical-slot-options')).toBeNull();

        options[0].click();
        fixture.detectChanges();

        expect(passPendingCriticalCaseIICheck).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId);
        expect(fixture.nativeElement.querySelector('.critical-slot-options')).not.toBeNull();
    });

    it('persists a virtual CASE II result until it is explicitly applied', () => {
        fixture.destroy();
        dialogData.caseIICheckRequired = true;
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        fixture.componentInstance.onCaseIIFinished({ results: [4, 4] });
        fixture.detectChanges();

        expect(setPendingCriticalCaseIICheckResult).toHaveBeenCalledOnceWith(
            dialogData.pendingCriticalId,
            'discard',
        );
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('.actions .bt-button.danger')?.textContent)
            .toContain('DISCARD');

        fixture.componentInstance.close();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: false });
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
    });

    it('records a physical CASE II discard as one resolved pending critical', () => {
        fixture.destroy();
        dialogData.caseIICheckRequired = true;
        dialogData.requiredHits = 2;
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        fixture.componentInstance.applyCaseIICheck('discard');
        fixture.detectChanges();

        expect(resolvePendingCriticalHit).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId);
        expect(fixture.componentInstance.discardedHits()).toBe(1);
        expect(fixture.componentInstance.complete()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.critical-result')?.textContent)
            .toContain('CASE II discarded');
        expect(fixture.componentInstance.primaryLabel()).toBe('NEXT');
    });

    it('decrements persisted work only after the critical is applied', async () => {
        dialogData.pendingCriticalId = 'critical:1';
        applyRoll.and.resolveTo({
            cancelled: false,
            outcome: {
                applied: true,
                slotNumber: 1,
                equipment: 'Medium Laser',
                armoredAbsorption: false,
            },
        });

        fixture.componentInstance.onFinished({ results: [1, 1] });
        fixture.componentInstance.primaryAction();
        await fixture.whenStable();

        expect(setPendingCriticalRoll).toHaveBeenCalledOnceWith('critical:1', [1, 1]);
        expect(resolvePendingCriticalHit).toHaveBeenCalledOnceWith('critical:1');
        expect(clearPendingCriticalRoll).not.toHaveBeenCalled();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });

    it('restores an unresolved roll for review without rerolling it', () => {
        fixture.destroy();
        dialogData.pendingCriticalId = 'critical:1';
        getPendingCriticalHit.and.returnValue({
            id: 'critical:1',
            location: 'LT',
            remainingHits: 1,
            roll: [3, 4],
        });
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        expect(fixture.componentInstance.primaryLabel()).toBe('APPLY');
        expect(fixture.nativeElement.querySelector('.critical-result')?.textContent)
            .toContain('rolled hit has not been applied');
    });

    it('offers in-memory sequence UNDO only before the first manual critical is committed', () => {
        fixture.destroy();
        dialogData.manual = true;
        dialogData.pendingCriticalId = undefined;
        dialogData.canUndoToChance = true;
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();

        const undo = fixture.nativeElement.querySelector('.critical-sequence-undo') as HTMLButtonElement;
        expect(undo.textContent).toContain('UNDO');
        expect(undo.classList).not.toContain('danger');

        undo.click();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: false, undoToChance: true });
        expect(resolvePendingCriticalHit).not.toHaveBeenCalled();
        expect(discardPendingCriticalHits).not.toHaveBeenCalled();

        fixture.componentInstance.appliedHits.set(1);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.critical-sequence-undo')).toBeNull();
    });

    it('discards remaining criticals and dismisses when no valid slot remains', () => {
        criticalSlots[0].destroyed = 1;
        criticalSlots[2].destroyed = 1;
        slotsVersion.update(version => version + 1);
        fixture.detectChanges();

        expect(fixture.componentInstance.primaryLabel()).toBe('DISCARD');
        expect(fixture.componentInstance.complete()).toBeFalse();

        const primaryButton = fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement;
        expect(primaryButton.disabled).toBeFalse();
        primaryButton.click();
        fixture.detectChanges();

        expect(discardPendingCriticalHits).toHaveBeenCalledOnceWith(dialogData.pendingCriticalId);
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });

    it('displays critical-slot dice as separate selectors without sum notation', () => {
        const element = fixture.nativeElement as HTMLElement;

        expect(fixture.componentInstance.roller()?.showSum()).toBeFalse();
        expect(element.querySelector('.critical-dice-trigger .plus-sign')).toBeNull();
        expect(element.querySelector('.critical-dice-trigger .sum')).toBeNull();
    });
});
