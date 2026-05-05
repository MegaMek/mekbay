import { DOCUMENT } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeyboardShortcutService } from './keyboard-shortcut.service';

function dispatchKey(target: EventTarget, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
}

describe('KeyboardShortcutService', () => {
    let service: KeyboardShortcutService;
    let openDialogs: unknown[];
    let testElements: HTMLElement[];

    beforeEach(() => {
        TestBed.resetTestingModule();
        openDialogs = [];
        testElements = [];

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                KeyboardShortcutService,
                {
                    provide: Dialog,
                    useValue: { openDialogs },
                },
            ],
        });

        service = TestBed.inject(KeyboardShortcutService);
    });

    afterEach(() => {
        for (const element of testElements) {
            element.remove();
        }
        testElements = [];
        TestBed.resetTestingModule();
    });

    it('dispatches to the newest matching scope first', () => {
        const backgroundHandler = jasmine.createSpy('background').and.returnValue(true);
        const foregroundHandler = jasmine.createSpy('foreground').and.returnValue(true);

        service.register({ id: 'background', handle: backgroundHandler });
        service.register({ id: 'foreground', handle: foregroundHandler });

        const event = dispatchKey(window, 'ArrowRight');

        expect(foregroundHandler).toHaveBeenCalledOnceWith(event);
        expect(backgroundHandler).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBeTrue();
    });

    it('falls back to the next eligible scope after unregistering', () => {
        const backgroundHandler = jasmine.createSpy('background').and.returnValue(true);
        const foregroundHandler = jasmine.createSpy('foreground').and.returnValue(true);

        service.register({ id: 'background', handle: backgroundHandler });
        const unregisterForeground = service.register({ id: 'foreground', handle: foregroundHandler });
        unregisterForeground();

        dispatchKey(window, 'ArrowLeft');

        expect(backgroundHandler).toHaveBeenCalledTimes(1);
        expect(foregroundHandler).not.toHaveBeenCalled();
    });

    it('ignores text entry targets unless a scope opts in', () => {
        const document = TestBed.inject(DOCUMENT);
        const input = document.createElement('input');
        document.body.appendChild(input);
        testElements.push(input);

        const skippedHandler = jasmine.createSpy('skipped').and.returnValue(true);
        const optInHandler = jasmine.createSpy('optIn').and.returnValue(true);

        service.register({ id: 'skipped', handle: skippedHandler });
        dispatchKey(input, 'ArrowRight');

        expect(skippedHandler).not.toHaveBeenCalled();

        service.register({ id: 'opt-in', allowInTextEntry: true, handle: optInHandler });
        dispatchKey(input, 'ArrowRight');

        expect(optInHandler).toHaveBeenCalledTimes(1);
    });

    it('only dispatches to scopes owned by the top dialog while dialogs are open', () => {
        const backgroundHandler = jasmine.createSpy('background').and.returnValue(true);
        const lowerDialogHandler = jasmine.createSpy('lowerDialog').and.returnValue(true);
        const topDialogHandler = jasmine.createSpy('topDialog').and.returnValue(true);
        const lowerDialogRef = {} as never;
        const topDialogRef = {} as never;

        service.register({ id: 'background', handle: backgroundHandler });
        service.register({ id: 'lower-dialog', dialogRef: lowerDialogRef, handle: lowerDialogHandler });
        service.register({ id: 'top-dialog', dialogRef: topDialogRef, handle: topDialogHandler });

        openDialogs.push(lowerDialogRef, topDialogRef);
        dispatchKey(window, 'ArrowRight');

        expect(topDialogHandler).toHaveBeenCalledTimes(1);
        expect(lowerDialogHandler).not.toHaveBeenCalled();
        expect(backgroundHandler).not.toHaveBeenCalled();
    });

    it('blocks background scopes when the top dialog has no registered shortcut scope', () => {
        const backgroundHandler = jasmine.createSpy('background').and.returnValue(true);

        service.register({ id: 'background', handle: backgroundHandler });
        openDialogs.push({});

        const event = dispatchKey(window, 'ArrowRight');

        expect(backgroundHandler).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBeFalse();
    });
});