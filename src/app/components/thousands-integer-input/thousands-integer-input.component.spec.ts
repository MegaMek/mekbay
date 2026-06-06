import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ThousandsIntegerInputComponent } from './thousands-integer-input.component';

describe('ThousandsIntegerInputComponent', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ThousandsIntegerInputComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();
    });

    it('formats the initial value with thousands separators', () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        fixture.componentRef.setInput('value', 8000);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);

        expect(input.value).toBe('8,000');
    });

    it('keeps the caret after an inserted digit instead of moving it to the end', async () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        const values: number[] = [];
        fixture.componentInstance.valueChange.subscribe((value) => values.push(value));
        fixture.componentRef.setInput('value', 8000);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);
        input.dispatchEvent(new Event('focus'));
        input.value = '85,000';
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new Event('input'));
        await settleCaret();

        expect(input.value).toBe('85,000');
        expect(input.selectionStart).toBe(2);
        expect(values[values.length - 1]).toBe(85000);
    });

    it('treats backspace after a separator like backspace after the preceding digit', async () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        const values: number[] = [];
        fixture.componentInstance.valueChange.subscribe((value) => values.push(value));
        fixture.componentRef.setInput('value', 18000);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);
        input.dispatchEvent(new Event('focus'));
        input.setSelectionRange(3, 3);
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Backspace',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('1,000');
        expect(input.selectionStart).toBe(1);
        expect(values[values.length - 1]).toBe(1000);
    });

    it('preserves leading zeros during editing and normalizes them on blur', async () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        const values: number[] = [];
        const commits: number[] = [];
        fixture.componentInstance.valueChange.subscribe((value) => values.push(value));
        fixture.componentInstance.valueCommit.subscribe((value) => commits.push(value));
        fixture.componentRef.setInput('value', 8000);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);
        input.dispatchEvent(new Event('focus'));
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Backspace',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('000');
        expect(input.selectionStart).toBe(0);
        expect(values[values.length - 1]).toBe(0);

        input.value = '1000';
        input.setSelectionRange(1, 1);
        input.dispatchEvent(new Event('input'));
        await settleCaret();

        expect(input.value).toBe('1,000');
        expect(input.selectionStart).toBe(1);
        expect(values[values.length - 1]).toBe(1000);

        input.dispatchEvent(new Event('blur'));
        fixture.componentRef.setInput('value', commits[commits.length - 1]);
        fixture.detectChanges();

        expect(commits[commits.length - 1]).toBe(1000);
        expect(input.value).toBe('1,000');
    });

    it('increments and decrements with arrow keys while focused', async () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        const values: number[] = [];
        fixture.componentInstance.valueChange.subscribe((value) => values.push(value));
        fixture.componentRef.setInput('value', 8000);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);
        input.dispatchEvent(new Event('focus'));
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('8,001');
        expect(input.selectionStart).toBe(input.value.length);
        expect(values[values.length - 1]).toBe(8001);

        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('8,000');
        expect(input.selectionStart).toBe(input.value.length);
        expect(values[values.length - 1]).toBe(8000);
    });

    it('honors step and min max bounds when stepping with arrow keys', async () => {
        const fixture = TestBed.createComponent(ThousandsIntegerInputComponent);
        fixture.componentRef.setInput('value', 10);
        fixture.componentRef.setInput('step', 5);
        fixture.componentRef.setInput('min', 10);
        fixture.componentRef.setInput('max', 15);
        fixture.detectChanges();

        const input = getInput(fixture.nativeElement);
        input.dispatchEvent(new Event('focus'));
        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('10');

        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('15');

        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
            cancelable: true,
        }));
        await settleCaret();

        expect(input.value).toBe('15');
    });
});

function getInput(element: HTMLElement): HTMLInputElement {
    return element.querySelector('input') as HTMLInputElement;
}

function settleCaret(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}