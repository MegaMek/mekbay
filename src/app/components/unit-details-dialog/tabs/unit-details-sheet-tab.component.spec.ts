import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { SheetService } from '../../../services/sheet.service';
import { SvgViewerLiteComponent } from '../../svg-viewer-lite/svg-viewer-lite.component';
import { UnitDetailsSheetTabComponent } from './unit-details-sheet-tab.component';

function makeSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 200');
    return svg;
}

describe('UnitDetailsSheetTabComponent', () => {
    let sheetService: jasmine.SpyObj<Pick<SheetService, 'getSheet'>>;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'error'>>;
    const options = signal({ recordSheetCenterPanelContent: 'clusterTable' });

    beforeEach(() => {
        sheetService = jasmine.createSpyObj<Pick<SheetService, 'getSheet'>>('SheetService', ['getSheet']);
        logger = jasmine.createSpyObj<Pick<LoggerService, 'error'>>('LoggerService', ['error']);
        options.set({ recordSheetCenterPanelContent: 'clusterTable' });
        sheetService.getSheet.and.resolveTo(makeSvg());

        TestBed.configureTestingModule({
            imports: [UnitDetailsSheetTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: SheetService, useValue: sheetService },
                { provide: LoggerService, useValue: logger },
                { provide: OptionsService, useValue: { options } },
            ],
        });
    });

    async function settle(): Promise<void> {
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
        }
    }

    async function createComponent() {
        const fixture = TestBed.createComponent(UnitDetailsSheetTabComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit({ sheets: ['atlas.svg'] }));
        fixture.detectChanges();
        await settle();
        fixture.detectChanges();
        return fixture;
    }

    it('renders controls outside the svg viewer', async () => {
        const fixture = await createComponent();
        const element = fixture.nativeElement as HTMLElement;
        const viewer = element.querySelector('svg-viewer-lite');
        const controls = element.querySelector('.sheet-controls');

        expect(viewer).not.toBeNull();
        expect(controls).not.toBeNull();
        expect(viewer?.querySelector('.sheet-controls')).toBeNull();
        expect(viewer?.querySelector('.svgl-controls')).toBeNull();
    });

    it('wires detached controls to the viewer instance', async () => {
        const fixture = await createComponent();
        const element = fixture.nativeElement as HTMLElement;
        const viewer = fixture.debugElement.query(By.directive(SvgViewerLiteComponent)).componentInstance as SvgViewerLiteComponent;
        const slider = element.querySelector<HTMLInputElement>('.zoom-control input')!;
        const reset = Array.from(element.querySelectorAll<HTMLButtonElement>('.sheet-controls button'))
            .find((button) => button.textContent?.trim() === 'RESET')!;
        const exportButton = Array.from(element.querySelectorAll<HTMLButtonElement>('.sheet-controls button'))
            .find((button) => button.textContent?.trim() === 'EXPORT PNG')!;
        const setZoom = spyOn(viewer, 'setZoomPercent').and.stub();
        const resetZoom = spyOn(viewer, 'resetZoom').and.stub();
        const exportPng = spyOn(viewer, 'exportPng').and.resolveTo();

        slider.value = '150';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        reset.click();
        exportButton.click();

        expect(setZoom).toHaveBeenCalledWith(150);
        expect(resetZoom).toHaveBeenCalled();
        expect(exportPng).toHaveBeenCalled();
    });
});
