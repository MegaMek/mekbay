// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { CBTForce } from '../../models/cbt-force.model';
import type { CriticalSlotId, LocationId } from '../../models/entity/entity-identifiers';
import { CBTForceMember, type CBTMekForceMember } from '../../models/force-member.model';
import type { MekCriticalRollPlanV2, MekCriticalRollProfileV2 } from '../../models/runtime/mek-critical-hit-v2';
import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';
import { ToastService } from '../../services/toast.service';
import { MekCriticalRollDialogComponent } from './mek-critical-roll-dialog.component';

const UNIT_ID = 'unit-1';
const LOCATION_ID = 'loc-lt' as LocationId;
const SLOT_ID = 'slot-lt-0' as CriticalSlotId;

describe('MekCriticalRollDialogComponent', () => {
    let fixture: ComponentFixture<MekCriticalRollDialogComponent>;
    let dialogRef: { close: jasmine.Spy };
    let force: jasmine.SpyObj<CBTForce>;
    let profile: MekCriticalRollProfileV2;
    let plan: MekCriticalRollPlanV2;
    let stateRevision: number;

    beforeEach(async () => {
        stateRevision = 7;
        profile = {
            sourceLocationId: LOCATION_ID,
            targetLocationId: LOCATION_ID,
            sourceLocationCode: 'LT',
            targetLocationCode: 'LT',
            diceCount: 2,
            validRolls: [[1, 1]],
            explosionProtection: 'case-ii',
            explosionProtectionNote: 'Caps internal damage at 1 point and transfers nothing.',
        };
        plan = {
            kind: 'applied',
            targetLocationId: LOCATION_ID,
            targetLocationCode: 'LT',
            slotId: SLOT_ID,
            slotNumber: 1,
            equipment: 'Medium Laser',
            armoredAbsorption: false,
        };
        force = jasmine.createSpyObj<CBTForce>('CBTForce', ['getUnitSnapshot', 'dispatchMekUnitCommand']);
        force.getUnitSnapshot.and.callFake((() => ({
            entity: { entityType: 'Mek' },
            query: {
                get stateRevision() { return stateRevision; },
                mekCriticalRollProfile: () => profile,
                mekCriticalRoll: () => plan,
            },
        })) as unknown as CBTForce['getUnitSnapshot']);
        force.dispatchMekUnitCommand.and.resolveTo({
            accepted: true,
            idempotent: false,
            currentRevision: stateRevision + 1,
        } as unknown as Awaited<ReturnType<CBTForce['dispatchMekUnitCommand']>>);
        const member = new CBTForceMember(
            UNIT_ID,
            force,
            new TestBipedMekEntity(),
        ) as CBTMekForceMember;
        dialogRef = { close: jasmine.createSpy('close') };

        await TestBed.configureTestingModule({
            imports: [MekCriticalRollDialogComponent],
            providers: [
                { provide: DialogRef, useValue: dialogRef },
                { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['showToast']) },
                {
                    provide: DIALOG_DATA,
                    useValue: { member, locationId: LOCATION_ID, requiredHits: 1, target: 'pending' },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(MekCriticalRollDialogComponent);
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('keeps the initial location protection visible after the profile changes', () => {
        const element = fixture.nativeElement as HTMLElement;
        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');

        profile = { ...profile, explosionProtection: 'none', explosionProtectionNote: null };
        fixture.componentInstance.profile.set(profile);
        fixture.detectChanges();

        expect(element.querySelector('.protection-badge')?.textContent).toContain('CASE II');
        expect(element.querySelector('.protection-note')?.textContent).toContain('Caps internal damage at 1');
    });

    it('animates to dice faces for a valid V2 critical slot', () => {
        spyOn(Math, 'random').and.returnValue(0);
        const roller = fixture.componentInstance.roller()!;
        const roll = spyOn(roller, 'roll');

        fixture.componentInstance.roll();

        expect(roll).toHaveBeenCalledOnceWith([1, 1]);
    });

    it('dispatches the atomic V2 critical command', async () => {
        await fixture.componentInstance.onFinished({ results: [1, 1] });

        expect(force.dispatchMekUnitCommand).toHaveBeenCalledOnceWith(
            UNIT_ID,
            jasmine.objectContaining({
                type: 'apply-mek-critical-roll',
                locationId: LOCATION_ID,
                results: [1, 1],
                target: 'pending',
            }),
        );
        expect(fixture.componentInstance.outcome()).toBe(
            plan as Extract<MekCriticalRollPlanV2, { readonly kind: 'applied' }>,
        );
        expect(fixture.componentInstance.appliedHits()).toBe(1);
    });

    it('automatically retries when the selected slot is no longer applicable', async () => {
        plan = {
            kind: 'not-applied',
            targetLocationId: LOCATION_ID,
            targetLocationCode: 'LT',
            slotNumber: 1,
            equipment: null,
            reason: 'empty',
        };
        const roll = spyOn(fixture.componentInstance, 'roll');

        await fixture.componentInstance.onFinished({ results: [1, 1] });

        expect(force.dispatchMekUnitCommand).not.toHaveBeenCalled();
        expect(fixture.componentInstance.outcome()).toBeNull();
        expect(roll).toHaveBeenCalledTimes(1);
    });

    it('discards and dismisses when no valid slot remains', () => {
        profile = { ...profile, validRolls: [] };
        fixture.componentInstance.profile.set(profile);
        fixture.detectChanges();

        expect(fixture.componentInstance.rollButtonLabel()).toBe('DISCARD REMAINING');
        const primaryButton = fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement;
        primaryButton.click();

        expect(fixture.componentInstance.discarded()).toBeTrue();
        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });

    it('uses the completed primary-button state as a dismiss action', () => {
        fixture.componentInstance.appliedHits.set(1);
        fixture.detectChanges();
        const primaryButton = fixture.nativeElement.querySelector('.bt-button.primary') as HTMLButtonElement;

        expect(primaryButton.textContent).toContain('CRITICALS APPLIED');
        expect(primaryButton.disabled).toBeFalse();
        primaryButton.click();

        expect(dialogRef.close).toHaveBeenCalledOnceWith({ completed: true });
    });
});
