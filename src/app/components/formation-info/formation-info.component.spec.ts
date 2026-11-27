// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { OptionsService } from '../../services/options.service';
import { GameSystem } from '../../models/common.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { getFormationDefinition } from '../../utils/formation/formation-definitions';
import { FormationSolver } from '../../utils/formation/formation-solver.util';
import { FormationInfoComponent } from './formation-info.component';
import { FormationDiagnosticsComponent } from './formation-diagnostics.component';
import type { DisplayUnitNameFormat } from '../../models/options.model';
import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';

describe('formation diagnostics', () => {
    const displayUnitNameFormat = signal<DisplayUnitNameFormat>('innerSphereClan');
    beforeEach(() => TestBed.configureTestingModule({ imports: [FormationInfoComponent, FormationDiagnosticsComponent], providers: [
        { provide: OptionsService, useValue: { options: () => ({ ASUseHex: false, displayUnitNameFormat: displayUnitNameFormat() }) } },
    ] }));

    it('shows an undersized group and names its conflicting unit', () => {
        const def = getFormationDefinition('anti-mech-lance', GameSystem.AS)!;
        const unit = { force: { faction: () => null }, getFormationSummary: () => createEmptyUnit({ chassis: 'Panther', as: { TP: 'BM' } }) };
        const fixture = TestBed.createComponent(FormationInfoComponent);
        fixture.componentRef.setInput('formation', def);
        fixture.componentRef.setInput('evaluation', FormationSolver.evaluateDefinition(def, [unit], GameSystem.AS));
        fixture.componentRef.setInput('units', [unit]);
        fixture.detectChanges();
        const panel = fixture.nativeElement.querySelector('.requirements-section') as HTMLElement;
        expect(panel.querySelector('.requirements-text')?.textContent).toContain(def.requirements!);
        const text = panel.querySelector('.formation-diagnostics')!.textContent as string;
        expect(text).toContain('Minimum unit count');
        expect(text).toContain('All infantry units');
        expect(text).toContain('Conflicting units:');
        expect(text).toContain('Panther');
    });

    it('does not highlight failures in an unused ideal-role alternative', () => {
        const def = getFormationDefinition('assault-lance', GameSystem.AS)!;
        const summary = createEmptyUnit({ role: 'Juggernaut', as: { TP: 'BM', SZ: 1, Arm: 1 } });
        const unit = { force: { faction: () => null }, getFormationSummary: () => summary };
        const fixture = TestBed.createComponent(FormationInfoComponent);
        fixture.componentRef.setInput('formation', def);
        fixture.componentRef.setInput('evaluation', FormationSolver.evaluateDefinition(def, [unit, unit, unit], GameSystem.AS));
        fixture.detectChanges();
        const diagnostics = fixture.nativeElement.querySelector('.formation-diagnostics') as HTMLElement;
        expect(diagnostics.textContent).toContain('All Juggernaut units');
        expect(diagnostics.querySelectorAll('.requirement-failed').length).toBe(0);
    });

    it('shows only irreparable requirements in search diagnostics, keeping their conflicting unit names', () => {
        const def = getFormationDefinition('aerospace-superiority-squadron', GameSystem.CBT)!;
        const summary = createEmptyUnit({ chassis: 'Mustang Fighter', model: '', type: 'Aero', subtype: 'Fixed Wing Support Vehicle', role: 'Attack Fighter' });
        const unit = { force: { faction: () => null }, getFormationSummary: () => summary };
        const fixture = TestBed.createComponent(FormationDiagnosticsComponent);
        fixture.componentRef.setInput('evaluation', FormationSolver.evaluateDefinition(def, [unit], GameSystem.CBT));
        fixture.componentRef.setInput('units', [unit]);
        fixture.componentRef.setInput('filter', 'blocked');
        fixture.detectChanges();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('All aerospace or conventional fighters');
        expect(text).toContain('Conflicting units:');
        expect(text).toContain('Mustang Fighter');
        expect(text).not.toContain('Minimum unit count');
        expect(text).not.toContain('Strict majority');
        expect(fixture.nativeElement.querySelectorAll('li').length).toBe(1);
    });

    it('uses display names for summaries and entities and follows the naming preference', () => {
        displayUnitNameFormat.set('innerSphereClan');
        const definition = getFormationDefinition('aerospace-superiority-squadron', GameSystem.CBT)!;
        const summary = createEmptyUnit({ name: 'BMCrab_CRB20', chassis: 'Crab', model: 'CRB-20' });
        const entity = new TestBipedMekEntity();
        entity.chassis.set('Mad Cat');
        entity.clanName.set('Timber Wolf');
        entity.model.set('Prime');
        const force = { faction: () => null };
        const units = [{ force, getFormationSummary: () => summary }, { force, getFormationEntity: () => entity }];
        const fixture = TestBed.createComponent(FormationDiagnosticsComponent);
        fixture.componentRef.setInput('evaluation', FormationSolver.evaluateDefinition(definition, units, GameSystem.CBT));
        fixture.componentRef.setInput('units', units);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Crab CRB-20');
        expect(fixture.nativeElement.textContent).not.toContain('BMCrab_CRB20');
        expect(fixture.nativeElement.textContent).toContain('Mad Cat (Timber Wolf) Prime');
        displayUnitNameFormat.set('clanInnerSphere');
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Timber Wolf (Mad Cat) Prime');
        displayUnitNameFormat.set('innerSphereClan');
    });
});
