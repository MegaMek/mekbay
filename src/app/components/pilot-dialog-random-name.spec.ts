/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 */

import { signal } from '@angular/core';

import { EditASPilotDialogComponent } from './edit-as-pilot-dialog/edit-as-pilot-dialog.component';

interface RandomNameDialogHarness {
    data: {
        factionId?: number | null;
        isAerospace?: boolean;
        era?: { years: { from?: number; to?: number } };
        unit?: { type: 'Aero'; subtype: 'WarShip' };
        unitType?: 'Aero';
        unitSubtype?: 'WarShip';
        group?: null;
    };
    generatingName: ReturnType<typeof signal<boolean>>;
    nameHasText: ReturnType<typeof signal<boolean>>;
    pilotNameGenerator: { generate: jasmine.Spy };
    logger: { warn: jasmine.Spy };
    nameInput: () => { nativeElement: HTMLInputElement };
    selectedGroupCommander: () => boolean;
    selectedFormationCommander: () => boolean;
}

function createHarness(generatedName: string | null, error?: Error): RandomNameDialogHarness {
    const input = document.createElement('input');
    input.maxLength = 80;
    const generate = error
        ? jasmine.createSpy('generate').and.rejectWith(error)
        : jasmine.createSpy('generate').and.resolveTo(generatedName);
    return {
        data: {
            factionId: 27, isAerospace: true, group: null,
            era: { years: { from: 3050, to: 3061 } },
            unit: { type: 'Aero', subtype: 'WarShip' },
            unitType: 'Aero', unitSubtype: 'WarShip',
        },
        generatingName: signal(false),
        nameHasText: signal(false),
        pilotNameGenerator: { generate },
        logger: { warn: jasmine.createSpy('warn') },
        nameInput: () => ({ nativeElement: input }),
        selectedGroupCommander: () => true,
        selectedFormationCommander: () => true,
    };
}

async function invokeFillRandomName(
    component: typeof EditASPilotDialogComponent,
    harness: RandomNameDialogHarness,
): Promise<void> {
    await component.prototype.fillRandomName.call(harness as never);
}

describe('pilot dialog random name behavior', () => {
    for (const [label, component] of [['Alpha Strike', EditASPilotDialogComponent]] as const) {
        it(`${label} passes all generation context and updates the input`, async () => {
            const harness = createHarness('Jane "Specter" Smith');

            await invokeFillRandomName(component, harness);

            expect(harness.pilotNameGenerator.generate).toHaveBeenCalledOnceWith({
                factionId: 27,
                isAerospace: true,
                isCommander: true,
                unitType: 'Aero',
                unitSubtype: 'WarShip',
                era: { from: 3050, to: 3061 },
            });
            expect(harness.nameInput().nativeElement.value).toBe('Jane "Specter" Smith');
            expect(harness.nameHasText()).toBeTrue();
            expect(harness.generatingName()).toBeFalse();
            expect(harness.logger.warn).not.toHaveBeenCalled();
        });

        it(`${label} preserves the input and reports generation failures`, async () => {
            const harness = createHarness(null, new Error('offline'));
            harness.nameInput().nativeElement.value = 'Existing Name';

            await invokeFillRandomName(component, harness);

            expect(harness.nameInput().nativeElement.value).toBe('Existing Name');
            expect(harness.generatingName()).toBeFalse();
            expect(harness.logger.warn).toHaveBeenCalledOnceWith('Pilot name generation failed: offline');
        });

        it(`${label} prevents duplicate generation while busy`, async () => {
            const harness = createHarness('Ignored');
            harness.generatingName.set(true);

            await invokeFillRandomName(component, harness);

            expect(harness.pilotNameGenerator.generate).not.toHaveBeenCalled();
        });
    }
});
