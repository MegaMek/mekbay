// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { GameSystem } from '../../models/common.model';
import { OptionsService } from '../../services/options.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { getFormationDefinition } from '../../utils/formation/formation-definitions';
import { RenameGroupDialogComponent } from './rename-group-dialog.component';
import type { FormationUnitLike } from '../../utils/formation/formation-facts.util';

describe('Rename group formation diagnostics', () => {
    let members: WritableSignal<readonly FormationUnitLike[]>;
    beforeEach(() => {
        const formation = getFormationDefinition('aerospace-superiority-squadron', GameSystem.AS)!;
        const force = {
            gameSystem: GameSystem.AS,
            groups: () => [],
            faction: () => null,
            techBase: () => 'Inner Sphere',
            era: () => null,
        };
        const units = Array.from({ length: 5 }, (_, index) => {
            const summary = createEmptyUnit({ name: `AF_Internal_${index + 1}`, chassis: `Fighter ${index + 1}`, model: '',
                role: index < 3 ? 'Interceptor' : 'Attack Fighter', as: { TP: 'AF' } });
            return { force, getFormationSummary: () => summary };
        });
        members = signal(units);
        TestBed.configureTestingModule({
            imports: [RenameGroupDialogComponent],
            providers: [
                { provide: OptionsService, useValue: { options: () => ({ ASUseHex: false }) } },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: jasmine.createSpy('closeManagedOverlay') } },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                { provide: DIALOG_DATA, useValue: { group: {
                    force,
                    name: () => '',
                    formation: () => formation,
                    activeFormation: () => formation,
                    formationLock: true,
                    formationUnits: members,
                    organizationalName: () => 'Squadron',
                    organizationalResult: () => ({ groups: [] }),
                } } },
            ],
        });
    });

    it('lists only unmet checks in the warning while keeping the full details collapsed', () => {
        const fixture = TestBed.createComponent(RenameGroupDialogComponent);
        fixture.detectChanges();
        const details = fixture.nativeElement.querySelector('.selected-formation-accordion') as HTMLDetailsElement;
        expect(details.open).toBeFalse();
        const warning = fixture.nativeElement.querySelector('.formation-warning')!;
        expect(warning.textContent).toContain('Missing requirements:');
        expect(warning.textContent).toContain('Minimum unit count');
        expect(warning.textContent).toContain('(5 / 6)');
        expect(warning.textContent).not.toContain('All aerospace or conventional fighters');
        expect(warning.textContent).not.toContain('Strict majority');
        expect(details.textContent).toContain('(5 / 5)');
        expect(details.textContent).toContain('(3 / 3)');
    });

    it('updates conflicting unit details when selecting another nonmatching formation', () => {
        const fixture = TestBed.createComponent(RenameGroupDialogComponent);
        fixture.detectChanges();
        fixture.componentInstance.selectedFormation.set(getFormationDefinition('anti-mech-lance', GameSystem.AS)!);
        fixture.detectChanges();
        const diagnostics = fixture.nativeElement.querySelector('.formation-warning .formation-diagnostics')!;
        expect(diagnostics.textContent).toContain('All infantry units');
        expect(diagnostics.textContent).toContain('Conflicting units:');
        expect(diagnostics.textContent).toContain('Fighter 1');
        expect(diagnostics.textContent).toContain('Fighter 5');
        fixture.componentInstance.selectedFormation.set(getFormationDefinition('support-lance', GameSystem.AS)!);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.formation-warning')).toBeNull();
    });

    it('refreshes missing requirements when the roster changes while the dialog is open', () => {
        const fixture = TestBed.createComponent(RenameGroupDialogComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.formation-warning').textContent).toContain('(5 / 6)');
        const original = members();
        members.set([...original, original[0]]);
        fixture.detectChanges();
        expect(fixture.componentInstance.isSelectedFormationValid()).toBeTrue();
        expect(fixture.nativeElement.querySelector('.formation-warning')).toBeNull();

        members.set(original);
        fixture.detectChanges();
        expect(fixture.componentInstance.isSelectedFormationValid()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.formation-warning').textContent).toContain('(5 / 6)');
    });
});
