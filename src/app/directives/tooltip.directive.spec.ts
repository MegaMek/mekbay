import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TooltipDirective } from './tooltip.directive';

@Component({
    standalone: true,
    imports: [TooltipDirective],
    template: `
        <div class="parent" [tooltip]="'Parent tooltip'" [tooltipDelay]="0">
            <span class="parent-label">Parent</span>
            <button class="child" type="button" [tooltip]="'Child tooltip'" [tooltipDelay]="0">Child</button>
        </div>
    `,
})
class TestHostComponent {}

async function flushTooltipTasks(fixture: ComponentFixture<TestHostComponent>): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    fixture.detectChanges();
    await Promise.resolve();
}

function dispatchPointerOver(target: HTMLElement, relatedTarget: EventTarget | null = null): void {
    target.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        relatedTarget,
    }));
}

describe('TooltipDirective', () => {
    let overlayContainer: OverlayContainer;
    let overlayContainerElement: HTMLElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TestHostComponent],
            providers: [provideZonelessChangeDetection()],
        }).compileComponents();

        overlayContainer = TestBed.inject(OverlayContainer);
        overlayContainerElement = overlayContainer.getContainerElement();
        overlayContainerElement.innerHTML = '';
    });

    it('shows only the nested tooltip when hovering a nested tooltip host', async () => {
        const fixture = TestBed.createComponent(TestHostComponent);
        fixture.detectChanges();

        const element = fixture.nativeElement as HTMLElement;
        const parent = element.querySelector('.parent') as HTMLElement | null;
        const child = element.querySelector('.child') as HTMLElement | null;

        expect(parent).withContext('parent tooltip host').not.toBeNull();
        expect(child).withContext('child tooltip host').not.toBeNull();

        dispatchPointerOver(parent!);
        await flushTooltipTasks(fixture);

        expect(getTooltipTexts()).toEqual(['Parent tooltip']);

        dispatchPointerOver(child!, parent);
        await flushTooltipTasks(fixture);

        expect(getTooltipTexts()).toEqual(['Child tooltip']);
    });

    function getTooltipTexts(): string[] {
        return Array.from(overlayContainerElement.querySelectorAll('.tooltip-content'))
            .map((tooltip) => tooltip.textContent?.trim() ?? '')
            .filter((tooltip) => tooltip.length > 0);
    }
});