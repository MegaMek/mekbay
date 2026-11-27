// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { MultilineDropdownComponent, type MultilineDropdownOption } from './multiline-dropdown.component';

describe('MultilineDropdownComponent', () => {
    let overlayContainer: OverlayContainer;
    let overlayContainerElement: HTMLElement;

    const options: MultilineDropdownOption[] = [
        { value: 'standard', label: 'Standard Ammo' },
        { value: 'long', label: 'Extremely Long Prototype Specialty Ammunition With Guidance Package Ammo' },
        { value: 'slash', label: 'LRM/SRM Specialty Ammo' },
    ];

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MultilineDropdownComponent],
        }).compileComponents();

        overlayContainer = TestBed.inject(OverlayContainer);
        overlayContainerElement = overlayContainer.getContainerElement();
        overlayContainerElement.innerHTML = '';
    });

    it('scrolls the active option into view during arrow navigation', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', [
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
            { value: 'three', label: 'Three' },
        ]);
        fixture.componentRef.setInput('value', 'one');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();

        const panel = overlayContainerElement.querySelector('.multiline-dropdown-options') as HTMLElement;
        const optionButtons = overlayContainerElement.querySelectorAll('.multiline-dropdown-option') as NodeListOf<HTMLButtonElement>;
        let scrollTop = 0;
        Object.defineProperty(panel, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => scrollTop = value,
        });
        spyOnProperty(panel, 'clientHeight', 'get').and.returnValue(40);
        spyOnProperty(panel, 'scrollHeight', 'get').and.returnValue(60);
        spyOnProperty(optionButtons[0], 'offsetTop', 'get').and.returnValue(0);
        spyOnProperty(optionButtons[0], 'offsetHeight', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[1], 'offsetTop', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[1], 'offsetHeight', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[2], 'offsetTop', 'get').and.returnValue(40);
        spyOnProperty(optionButtons[2], 'offsetHeight', 'get').and.returnValue(20);

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();

        expect(scrollTop).toBe(20);
        expect(optionButtons[2].classList.contains('keyboard-active')).toBeTrue();
    });

    it('ignores stale pointer hover caused by keyboard scrolling until the pointer moves', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', [
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
            { value: 'three', label: 'Three' },
        ]);
        fixture.componentRef.setInput('value', 'one');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();

        const panel = overlayContainerElement.querySelector('.multiline-dropdown-options') as HTMLElement;
        const optionButtons = overlayContainerElement.querySelectorAll('.multiline-dropdown-option') as NodeListOf<HTMLButtonElement>;
        let scrollTop = 0;
        Object.defineProperty(panel, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => scrollTop = value,
        });
        spyOnProperty(panel, 'clientHeight', 'get').and.returnValue(40);
        spyOnProperty(panel, 'scrollHeight', 'get').and.returnValue(60);
        spyOnProperty(optionButtons[0], 'offsetTop', 'get').and.returnValue(0);
        spyOnProperty(optionButtons[0], 'offsetHeight', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[1], 'offsetTop', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[1], 'offsetHeight', 'get').and.returnValue(20);
        spyOnProperty(optionButtons[2], 'offsetTop', 'get').and.returnValue(40);
        spyOnProperty(optionButtons[2], 'offsetHeight', 'get').and.returnValue(20);

        optionButtons[0].dispatchEvent(new PointerEvent('pointerenter', { clientX: 20, clientY: 20, bubbles: true }));
        optionButtons[0].dispatchEvent(new PointerEvent('pointermove', { clientX: 24, clientY: 20, bubbles: true }));
        fixture.detectChanges();

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();

        optionButtons[0].dispatchEvent(new PointerEvent('pointerenter', { clientX: 24, clientY: 20, bubbles: true }));
        fixture.detectChanges();

        expect(scrollTop).toBe(20);
        expect(optionButtons[2].classList.contains('keyboard-active')).toBeTrue();

        optionButtons[0].dispatchEvent(new PointerEvent('pointermove', { clientX: 28, clientY: 20, bubbles: true }));
        fixture.detectChanges();

        expect(scrollTop).toBe(20);
        expect(optionButtons[0].classList.contains('keyboard-active')).toBeTrue();
    });

    it('moves the active option with arrow keys without changing the selected value', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', options);
        fixture.componentRef.setInput('value', 'standard');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        fixture.detectChanges();

        const optionButtons = overlayContainerElement.querySelectorAll('.multiline-dropdown-option') as NodeListOf<HTMLButtonElement>;
        expect(optionButtons[0].classList.contains('active')).toBeTrue();
        expect(optionButtons[1].classList.contains('keyboard-active')).toBeTrue();
        expect(fixture.componentInstance.value()).toBe('standard');
    });

    it('emits selected values and closes after selection', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        let emittedValue = '';
        fixture.componentInstance.valueChange.subscribe(value => emittedValue = value);
        fixture.componentRef.setInput('options', options);
        fixture.componentRef.setInput('value', 'standard');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();

        const optionButtons = overlayContainerElement.querySelectorAll('.multiline-dropdown-option') as NodeListOf<HTMLButtonElement>;
        optionButtons[1].click();
        fixture.detectChanges();

        expect(emittedValue).toBe('long');
        expect(fixture.componentInstance.open()).toBeFalse();
    });

    it('renders all option labels into the trigger width measure', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', options);
        fixture.componentRef.setInput('value', 'standard');
        fixture.detectChanges();

        const measureOptions = Array.from(fixture.nativeElement.querySelectorAll('.multiline-dropdown-measure-option')) as HTMLElement[];
        expect(measureOptions.map(option => option.textContent?.trim())).toEqual(options.map(option => option.label));
    });

    it('keeps leading and trailing labels semantically separate', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', [{
            value: 'heavy-gauss',
            label: '[HD] iHeavy Gauss Ammo (4/4)',
            trailingLabel: '(4/4)',
            modifierLabel: '0/+1/+2',
        }]);
        fixture.componentRef.setInput('value', 'heavy-gauss');
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('.multiline-dropdown-trigger') as HTMLButtonElement;
        const leadingLabel = trigger.querySelector('.multiline-dropdown-label-text') as HTMLElement;
        const trailingLabel = trigger.querySelector('.multiline-dropdown-trailing-label') as HTMLElement;

        expect(leadingLabel.textContent?.trim()).toBe('[HD] iHeavy Gauss Ammo');
        expect(trailingLabel.textContent?.trim()).toBe('(4/4)');
    });

    it('marks an opted-in overlay panel for content expansion', () => {
        const fixture = TestBed.createComponent(MultilineDropdownComponent);
        fixture.componentRef.setInput('options', [{
            value: 'heavy-gauss',
            label: '[HD] iHeavy Gauss Ammo (4/4)',
            trailingLabel: '(4/4)',
            modifierLabel: '0/+1/+2',
        }]);
        fixture.componentRef.setInput('value', 'heavy-gauss');
        fixture.componentRef.setInput('expandPanelToContent', true);
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('.multiline-dropdown-trigger') as HTMLButtonElement;
        trigger.click();
        fixture.detectChanges();

        const panelHost = overlayContainerElement.querySelector('multiline-dropdown-panel') as HTMLElement;
        const optionLabel = panelHost.querySelector('.multiline-dropdown-option-label') as HTMLElement;
        const optionBadge = panelHost.querySelector('.modifier-badge') as HTMLElement;
        expect(panelHost.classList.contains('expand-to-content')).toBeTrue();
        expect(optionLabel.textContent?.trim()).toBe('[HD] iHeavy Gauss Ammo (4/4)');
        expect(optionBadge.textContent?.trim()).toBe('0/+1/+2');
    });

});
