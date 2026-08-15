// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../models/rules/game-rules';
import { TnCalculatorDialogComponent, type TnCalculatorDialogData, type TnCalculatorDialogResult } from './tn-calculator-dialog.component';

const DATA: TnCalculatorDialogData = {
    target: {
        id: 'A',
        letter: 'A',
        name: 'Target A',
        color: '#1565C0',
        distance: 15,
        c3Distance: 12,
        useC3: true,
        tnModifier: 0
    },
    gameRules: CORE_2026_GAME_RULES,
    showC3Distance: true,
    c3Degraded: true
};

describe('TnCalculatorDialogComponent C3 degradation', () => {
    let fixture: ComponentFixture<TnCalculatorDialogComponent>;
    let component: TnCalculatorDialogComponent;
    let close: jasmine.Spy<(result: TnCalculatorDialogResult | null) => void>;

    beforeEach(async () => {
        close = jasmine.createSpy('close');
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: DATA },
                { provide: DialogRef, useValue: { close } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('shows an overlay without blocking interaction while degraded', () => {
        expect(fixture.nativeElement.querySelector('.c3-distance-control').classList).toContain('c3-degraded');
        expect(fixture.nativeElement.querySelector('.c3-distance-title .c3-status-label')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.c3-distance-title').textContent.trim()).toBe('C³ Distance (DEGRADED)');
        expect(fixture.nativeElement.querySelector('.use-c3-toggle input').disabled).toBeFalse();
        expect(component.c3Enabled()).toBeTrue();
    });

    it('shows JAMMED under Total Warfare rules', () => {
        component.gameRules.set(TW_GAME_RULES);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.c3-distance-title').textContent.trim()).toBe('C³ Distance (JAMMED)');
    });

    it('preserves the stored C3 choice when applying while jammed', () => {
        component.apply();

        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            targetId: 'A',
            patch: jasmine.objectContaining({ c3Distance: 12, useC3: true })
        }));
    });

    it('adds and saves a custom per-unit TN modifier', () => {
        component.setCustomModifierValue(2);
        fixture.detectChanges();

        const value = fixture.nativeElement.querySelector('#tnCustomModifier') as HTMLOutputElement;
        expect(value.textContent?.trim()).toBe('+2');
        expect(fixture.nativeElement.querySelector('#tnCustomModifier[type="number"]')).toBeNull();

        component.setCustomModifierValue('-2');
        fixture.detectChanges();

        const output = fixture.nativeElement.querySelector('#tnCustomModifier') as HTMLOutputElement;
        const footer = fixture.nativeElement.querySelector('.tn-actions') as HTMLElement;
        const summary = footer.querySelector('.tn-summary') as HTMLElement;
        const custom = summary.querySelector('.custom-modifier-row') as HTMLElement;
        const total = summary.querySelector('.total-box') as HTMLElement;
        expect(output.textContent?.trim()).toBe('-2');
        expect(summary.contains(output)).toBeTrue();
        expect(fixture.nativeElement.querySelector('.other-section')?.contains(output)).toBeFalse();
        expect(getComputedStyle(custom).flexGrow).toBe('1');
        expect(getComputedStyle(total).flexGrow).toBe('1');
        expect(getComputedStyle(output).width).toBe('36px');
        expect(output.classList).toContain('selected');
        expect(getComputedStyle(output).borderTopColor).toBe('rgb(255, 255, 255)');
        expect(getComputedStyle(output).backgroundColor).toBe('rgb(234, 174, 63)');
        expect([...footer.children].map(child => child.classList.contains('tn-summary')
            ? 'summary'
            : child.textContent?.trim())).toEqual(['summary', 'APPLY', '', 'CANCEL']);
        expect(component.totalModifier()).toBe(-2);

        component.apply();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            targetId: 'A',
            patch: jasmine.objectContaining({
                tnModifier: -2,
                tnCalculator: jasmine.objectContaining({ customModifier: -2 }),
            }),
        }));
    });

    it('resets editable calculator values to neutral defaults', () => {
        component.selectUnitType('vehicle');
        component.setTargetMovementBracketIndex(3);
        component.toggleAirborne();
        component.toggleProne();
        component.selectInterveningWoods('light2');
        component.toggleIndirectFire();
        component.toggleSecondaryTarget();
        component.setCustomModifierValue(4);
        component.setRangeValue(12);

        component.reset();
        fixture.detectChanges();

        expect(component.unitType()).toBe('mek-biped');
        expect(component.targetMovementBracketIndex()).toBe(0);
        expect(component.isAirborne()).toBeFalse();
        expect(component.prone()).toBeFalse();
        expect(component.interveningWoods()).toBe('none');
        expect(component.indirectFire()).toBeFalse();
        expect(component.secondaryTarget()).toBeFalse();
        expect(component.customModifier()).toBe(0);
        expect(component.range()).toBe(1);
        expect(component.totalModifier()).toBe(0);
        expect((fixture.nativeElement.querySelector('#tnCustomModifier') as HTMLOutputElement).classList).not.toContain('selected');
    });

    it('clamps the custom modifier to one signed digit', () => {
        component.setCustomModifierValue(10);
        fixture.detectChanges();

        const buttons = fixture.nativeElement.querySelectorAll('.custom-modifier-control button') as NodeListOf<HTMLButtonElement>;
        expect(component.customModifier()).toBe(9);
        expect((fixture.nativeElement.querySelector('#tnCustomModifier') as HTMLOutputElement).textContent?.trim()).toBe('+9');
        expect(buttons[1].disabled).toBeTrue();

        component.stepCustomModifier(-20);
        fixture.detectChanges();

        expect(component.customModifier()).toBe(-9);
        expect((fixture.nativeElement.querySelector('#tnCustomModifier') as HTMLOutputElement).textContent?.trim()).toBe('-9');
        expect(buttons[0].disabled).toBeTrue();
    });

    it('clears and disables ordinary partial cover outside the spotter-LOS group for Core indirect fire', () => {
        component.togglePartialCover();
        expect(component.partialCover()).toBeTrue();

        component.toggleIndirectFire();
        fixture.detectChanges();

        const partialCover = fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement;
        const terrainGroup = fixture.nativeElement.querySelector('.terrain-group') as HTMLElement;
        expect(component.partialCover()).toBeFalse();
        expect(partialCover.disabled).toBeTrue();
        expect(terrainGroup.contains(partialCover)).toBeFalse();

        component.togglePartialCover();
        expect(component.partialCover()).toBeFalse();
    });

    it('allows spotter-LOS partial cover at adjacent attacker range for TW indirect fire', () => {
        component.gameRules.set(TW_GAME_RULES);
        component.toggleIndirectFire();
        component.togglePartialCover();
        component.setRangeValue(1);
        fixture.detectChanges();

        const partialCover = fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement;
        const terrainGroup = fixture.nativeElement.querySelector('.terrain-group') as HTMLElement;
        expect(component.partialCover()).toBeTrue();
        expect(partialCover.disabled).toBeFalse();
        expect(terrainGroup.contains(partialCover)).toBeTrue();

        component.togglePartialCover();
        expect(component.partialCover()).toBeFalse();
        component.togglePartialCover();
        fixture.detectChanges();

        expect(component.partialCover()).toBeTrue();
        expect(component.totalModifier()).toBe(2);
    });

    it('retains water partial cover for indirect fire', () => {
        component.selectWaterDepth('underwater-depth-1');
        component.toggleIndirectFire();
        fixture.detectChanges();

        expect(component.waterPartialCover()).toBeTrue();
        expect(component.partialCoverSelected()).toBeTrue();
        expect(component.totalModifier()).toBe(2);
        expect((fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement).textContent).toContain('Partial Cover (water)');
    });

    it('always exposes manual guidance-state controls and saves their values', () => {
        const guidanceState = fixture.nativeElement.querySelector('.guidance-state-group') as HTMLElement;
        const tagged = guidanceState.querySelector('.tagged-state') as HTMLButtonElement;
        const narc = guidanceState.querySelector('.narc-above-water-state') as HTMLButtonElement;
        const ecmShielded = guidanceState.querySelector('.ecm-shielded-state') as HTMLButtonElement;

        expect(guidanceState).not.toBeNull();
        expect(tagged.textContent?.trim()).toBe('TAGGED');
        expect(narc.textContent?.trim()).toBe('NARC');
        expect(ecmShielded.textContent?.trim()).toBe('ECM SHIELDED');

        tagged.click();
        narc.click();
        ecmShielded.click();
        component.apply();

        const result = close.calls.mostRecent().args[0] as TnCalculatorDialogResult;
        expect(result.patch.tnCalculator).toEqual(jasmine.objectContaining({
            tagged: true,
            narcAboveWater: true,
            narcUnderwater: false,
            ecmShielded: true,
        }));
    });

    it('clears and disables TAGGED for infantry under Total Warfare rules', () => {
        component.gameRules.set(TW_GAME_RULES);
        component.toggleTagged();
        expect(component.tagged()).toBeTrue();

        component.selectUnitType('infantry');
        fixture.detectChanges();

        const tagged = fixture.nativeElement.querySelector('.tagged-state') as HTMLButtonElement;
        expect(component.tagged()).toBeFalse();
        expect(tagged.disabled).toBeTrue();

        component.toggleTagged();
        component.apply();
        const result = close.calls.mostRecent().args[0] as TnCalculatorDialogResult;
        expect(result.patch.tnCalculator?.tagged).toBeFalse();
    });

    it('offers separate NARC water layers for a partially submerged manual target', () => {
        component.selectWaterDepth('underwater-depth-1');
        fixture.detectChanges();

        const aboveWater = fixture.nativeElement.querySelector('.narc-above-water-state') as HTMLButtonElement;
        const underwater = fixture.nativeElement.querySelector('.narc-underwater-state') as HTMLButtonElement;
        expect(aboveWater.textContent?.trim()).toBe('NARC (ABOVE WATER)');
        expect(underwater.textContent?.trim()).toBe('NARC (UNDERWATER)');
    });

    it('toggles selected cover and intervening woods without explicit none buttons', () => {
        const coverGroup = fixture.nativeElement.querySelector('[aria-label="Target hex cover"]') as HTMLElement;
        const coverButtons = coverGroup.querySelectorAll<HTMLButtonElement>(':scope > button');
        const woodsGroup = fixture.nativeElement.querySelector('[aria-label="Intervening woods"]') as HTMLElement;
        const woodsButtons = woodsGroup.querySelectorAll<HTMLButtonElement>(':scope > button');

        expect(coverButtons.length).toBe(2);
        expect(woodsButtons.length).toBe(2);
        expect(fixture.nativeElement.querySelector('.none-choice')).toBeNull();

        coverButtons[0].click();
        expect(component.targetHexCover()).toBe('light');
        coverButtons[0].click();
        expect(component.targetHexCover()).toBe('none');

        woodsButtons[0].click();
        expect(component.interveningWoods()).toBe('light1');
        woodsButtons[0].click();
        expect(component.interveningWoods()).toBe('none');
    });

    it('allows the C3 distance to change while degraded', () => {
        component.setC3DistanceValue(5);

        expect(component.c3Distance()).toBe(5);
    });

    it('removes the overlay when degradation clears', () => {
        component.setC3Degraded(false);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.c3-distance-control').classList).not.toContain('c3-degraded');
    });
});

describe('TnCalculatorDialogComponent indirect-fire availability', () => {
    it('hides indirect controls without discarding existing state when the unit has no capable weapon', async () => {
        const data: TnCalculatorDialogData = {
            ...DATA,
            target: {
                ...DATA.target,
                tnCalculator: { indirectFire: true, spotterMoveMode: 'run' },
            },
            indirectFireAvailable: false,
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        fixture.detectChanges();

        expect(fixture.componentInstance.indirectFire()).toBeTrue();
        expect(fixture.nativeElement.textContent).not.toContain('Indirect Fire');
        expect(fixture.nativeElement.querySelector('.spotter-section')).toBeNull();
    });
});

describe('TnCalculatorDialogComponent read-only target identity', () => {
    let fixture: ComponentFixture<TnCalculatorDialogComponent>;
    let component: TnCalculatorDialogComponent;

    beforeEach(async () => {
        const data: TnCalculatorDialogData = {
            target: {
                id: 'opfor:enemy-1',
                letter: 'A',
                name: 'Achileus Light Battle Armor',
                color: '#1565C0',
                unitType: 'battle-armor',
                distance: 1,
                tnModifier: 1
            },
            gameRules: CORE_2026_GAME_RULES,
            targetStateReadOnly: true
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } }
            ]
        }).compileComponents();
        fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('uses the styled disabled dropdown and retains the unit modifier', () => {
        const targetType = fixture.nativeElement.querySelector('multiline-dropdown.identity-choice');
        const trigger = targetType.querySelector('.multiline-dropdown-trigger') as HTMLButtonElement;

        expect(targetType).not.toBeNull();
        expect(targetType.classList).toContain('selected');
        expect(targetType.classList).toContain('derived-target-control');
        expect(getComputedStyle(targetType).opacity).toBe('0.7');
        expect(trigger.disabled).toBeTrue();
        expect(trigger.querySelector('.multiline-dropdown-label')?.textContent?.trim()).toBe('Battle Armor');
        expect(trigger.querySelector('.modifier-badge')?.textContent?.trim()).toBe('+1');
        expect(fixture.nativeElement.querySelector('.derived-target-value')).toBeNull();
    });

    it('marks synchronized movement controls as disabled while preserving their state', () => {
        component.isAirborne.set(true);
        fixture.detectChanges();
        const movementSection = fixture.nativeElement.querySelector('.target-movement-section');
        const movementButtons = [...movementSection.querySelectorAll('.move-button')] as HTMLButtonElement[];

        expect(movementSection.classList).toContain('derived-target-state');
        expect(movementButtons.every(button => button.disabled)).toBeTrue();
        expect(movementButtons[0].classList).toContain('selected');
        expect(movementButtons[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('locks synchronized defender cover while leaving local LOS choices editable', () => {
        const coverGroup = fixture.nativeElement.querySelector('[aria-label="Target hex cover"]');
        const coverRow = coverGroup.closest('.choice-line');
        const coverButtons = [...coverGroup.querySelectorAll('button')] as HTMLButtonElement[];
        const woodsButtons = [...fixture.nativeElement.querySelectorAll('[aria-label="Intervening woods"] button')] as HTMLButtonElement[];

        expect(coverRow.classList).toContain('derived-target-state');
        expect(coverButtons.every(button => button.disabled)).toBeTrue();
        expect(woodsButtons.every(button => !button.disabled)).toBeTrue();

        component.selectTargetHexCover('light');

        expect(component.targetHexCover()).toBe('none');

        component.setRangeValue(2);
        fixture.detectChanges();
        const partialCover = fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement;
        expect(partialCover.disabled).toBeFalse();

        partialCover.click();
        expect(component.partialCover()).toBeTrue();
    });

    it('exposes but locks the water control for a read-only non-Mek target', () => {
        const picker = fixture.nativeElement.querySelector('cover-level-picker[data-kind="water"]');

        expect(picker).not.toBeNull();
        expect((picker.querySelector('.cover-trigger') as HTMLButtonElement).disabled).toBeTrue();

        component.selectWaterDepth('underwater-depth-1');
        expect(component.waterDepth()).toBeUndefined();
    });

    it('rejects programmatic target-type changes while read-only', () => {
        component.selectUnitType('mek-biped');

        expect(component.unitType()).toBe('battle-armor');
    });

    it('does not expose manual guidance-state controls for synchronized OPFOR targets', () => {
        expect(fixture.nativeElement.querySelector('.guidance-state-group')).toBeNull();
    });

    it('resets local choices without clearing synchronized target facts', () => {
        component.isAirborne.set(true);
        component.targetMovementBracketIndex.set(3);
        component.prone.set(true);
        component.narcAboveWater.set(true);
        component.selectInterveningWoods('light2');
        component.toggleIndirectFire();
        component.setCustomModifierValue(3);
        component.setRangeValue(12);

        component.reset();

        expect(component.unitType()).toBe('battle-armor');
        expect(component.isAirborne()).toBeTrue();
        expect(component.targetMovementBracketIndex()).toBe(3);
        expect(component.prone()).toBeTrue();
        expect(component.narcAboveWater()).toBeTrue();
        expect(component.interveningWoods()).toBe('none');
        expect(component.indirectFire()).toBeFalse();
        expect(component.customModifier()).toBe(0);
        expect(component.range()).toBe(1);
    });
});

describe('TnCalculatorDialogComponent movement and stance', () => {
    it('stores water depth for an editable non-Mek using shared height geometry', async () => {
        const close = jasmine.createSpy('close');
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A', letter: 'A', name: 'Non-Mek target', color: '#1565C0',
                unitType: 'battle-armor', distance: 1, tnModifier: 1,
                tnCalculator: { waterDepth: 'underwater-depth-2' },
            },
            gameRules: CORE_2026_GAME_RULES,
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;

        expect(component.waterDepth()).toBe('underwater-depth-2');

        component.selectWaterDepth('underwater-depth-1');
        fixture.detectChanges();

        expect(component.waterDepth()).toBe('underwater-depth-1');
        expect(component.waterPartialCover()).toBeFalse();
        expect(component.targetWaterState().submerged).toBeTrue();
        expect(component.totalModifier()).toBe(1);

        component.apply();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            patch: jasmine.objectContaining({
                tnCalculator: jasmine.objectContaining({ waterDepth: 'underwater-depth-1' }),
            }),
        }));
    });

    it('maps the water cover choice to adjacent partial cover', async () => {
        const close = jasmine.createSpy('close');
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A',
                letter: 'A',
                name: 'Target A',
                color: '#1565C0',
                unitType: 'mek-biped',
                distance: 1,
                tnModifier: 0,
            },
            gameRules: TW_GAME_RULES,
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;

        component.selectWaterDepth('underwater-depth-1');
        fixture.detectChanges();

        expect(component.targetHexCover()).toBe('none');
        expect(component.waterPartialCover()).toBeTrue();
        expect(component.partialCoverSelected()).toBeTrue();
        expect(component.totalModifier()).toBe(1);
        expect((fixture.nativeElement.querySelector('.partial-cover') as HTMLElement).textContent).toContain('Partial Cover (water)');
        expect(fixture.nativeElement.querySelector('cover-level-picker[data-kind="water"] cover-level-indicator span')?.textContent?.trim()).toBe('1');

        component.apply();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            patch: jasmine.objectContaining({
                tnModifier: 1,
                tnCalculator: jasmine.objectContaining({
                    targetHexCover: 'none',
                    partialCover: false,
                    waterDepth: 'underwater-depth-1',
                }),
            }),
        }));
    });

    it('maps building cover to derived partial cover at adjacent range and for indirect fire', async () => {
        const close = jasmine.createSpy('close');
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A', letter: 'A', name: 'Target A', color: '#1565C0',
                unitType: 'mek-biped', distance: 1, tnModifier: 0,
            },
            gameRules: TW_GAME_RULES,
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;

        component.selectBuildingLevel('building-1');
        fixture.detectChanges();

        const partialCover = fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement;
        const buildingTrigger = fixture.nativeElement.querySelector('button[aria-label="Building level"]') as HTMLButtonElement;
        const coverRow = fixture.nativeElement.querySelector('[aria-label="Target hex cover"]') as HTMLElement;
        const coverButtons = [
            ...coverRow.querySelectorAll<HTMLButtonElement>(':scope > button'),
            ...coverRow.querySelectorAll<HTMLButtonElement>(':scope > cover-level-picker .cover-trigger'),
        ];
        expect(component.targetHexCover()).toBe('none');
        expect(component.buildingPartialCover()).toBeTrue();
        expect(component.partialCoverSelected()).toBeTrue();
        expect(coverButtons.map(button => getComputedStyle(button).width)).toEqual(Array(4).fill('40px'));
        expect(partialCover.disabled).toBeTrue();
        expect(partialCover.textContent).toContain('Partial Cover (building)');
        expect(getComputedStyle(partialCover).backgroundColor).toBe('rgb(209, 209, 209)');
        expect(getComputedStyle(buildingTrigger).backgroundColor).toBe('rgb(209, 209, 209)');
        expect(component.totalModifier()).toBe(1);

        component.toggleIndirectFire();
        expect(component.totalModifier()).toBe(2);

        component.apply();
        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            patch: jasmine.objectContaining({
                tnModifier: 2,
                tnCalculator: jasmine.objectContaining({
                    targetHexCover: 'none',
                    partialCover: false,
                    buildingCover: 'building-1',
                }),
            }),
        }));
    });

    it('uses the superheavy depth offset for water partial cover', async () => {
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A', letter: 'A', name: 'Target A', color: '#1565C0',
                unitType: 'mek-biped', distance: 5, tnModifier: 0,
            },
            gameRules: CORE_2026_GAME_RULES,
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;

        component.selectWaterDepth('underwater-depth-2');
        expect(component.targetWaterState()).toEqual({ partiallyUnderwater: false, submerged: true });
        expect(component.totalModifier()).toBe(0);

        component.toggleLargeTarget();
        expect(component.targetWaterState()).toEqual({ partiallyUnderwater: true, submerged: false });
        expect(component.totalModifier()).toBe(0);
    });

    it('retains independent movement, jump, and prone state', async () => {
        const close = jasmine.createSpy('close');
        const data: TnCalculatorDialogData = {
            target: {
                id: 'A',
                letter: 'A',
                name: 'Target A',
                color: '#1565C0',
                distance: 8,
                tnModifier: 0,
                tnCalculator: {
                    prone: true,
                    targetMovementBracket: '7-9',
                    isAirborne: true,
                    skidding: true
                }
            },
            gameRules: TW_GAME_RULES
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close } }
            ]
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.prone()).toBeTrue();
        expect(component.targetMovementBracket().id).toBe('7-9');
        expect(component.isAirborne()).toBeTrue();
        expect(component.skidding()).toBeTrue();
        expect(component.totalModifier()).toBe(7);

        component.apply();

        expect(close).toHaveBeenCalledWith(jasmine.objectContaining({
            patch: jasmine.objectContaining({
                tnModifier: 7,
                tnCalculator: jasmine.objectContaining({
                    prone: true,
                    targetMovementBracket: '7-9'
                })
            })
        }));
    });

    it('shows both linked-target stance flags', async () => {
        const data: TnCalculatorDialogData = {
            target: {
                id: 'opfor:enemy-1',
                letter: 'A',
                name: 'Enemy',
                color: '#1565C0',
                distance: 8,
                tnModifier: 0,
                tnCalculator: { prone: true, immobile: true }
            },
            gameRules: TW_GAME_RULES,
            targetStateReadOnly: true
        };
        await TestBed.configureTestingModule({
            imports: [TnCalculatorDialogComponent],
            providers: [
                { provide: DIALOG_DATA, useValue: data },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } }
            ]
        }).compileComponents();
        const fixture = TestBed.createComponent(TnCalculatorDialogComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();

        expect(component.prone()).toBeTrue();
        expect(component.immobile()).toBeTrue();
        expect(fixture.nativeElement.querySelectorAll('[aria-label="Target stance"] .selected').length).toBe(2);
        expect((fixture.nativeElement.querySelector('.partial-cover') as HTMLButtonElement).disabled).toBeTrue();
    });
});
