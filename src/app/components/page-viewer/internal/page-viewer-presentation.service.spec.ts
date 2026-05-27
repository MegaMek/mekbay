import { TestBed } from '@angular/core/testing';

import { PageViewerPresentationService } from './page-viewer-presentation.service';

describe('PageViewerPresentationService', () => {
    let service: PageViewerPresentationService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [PageViewerPresentationService]
        });

        service = TestBed.inject(PageViewerPresentationService);
    });

    it('updates selected wrapper classes using the current unit id', () => {
        const selectedWrapper = document.createElement('div');
        selectedWrapper.dataset['unitId'] = 'unit-a';
        const otherWrapper = document.createElement('div');
        otherWrapper.dataset['unitId'] = 'unit-b';
        otherWrapper.classList.add('selected');

        service.updateSelectedPageHighlight([selectedWrapper, otherWrapper], 'unit-a');

        expect(selectedWrapper.classList.contains('selected')).toBeTrue();
        expect(otherWrapper.classList.contains('selected')).toBeFalse();
    });

    it('toggles fluff visibility on displayed unit svgs', () => {
        const svg = createSheetSvg();
        const displayedUnits = [{ svg: () => svg }] as never[];

        service.setDisplayedFluffImageVisibility(displayedUnits, true);

        expect(getFluffElement(svg)?.style.display).toBe('block');
        expect(getReferenceTable(svg)?.style.display).toBe('none');

        service.setDisplayedFluffImageVisibility(displayedUnits, false);

        expect(getFluffElement(svg)?.style.display).toBe('none');
        expect(getReferenceTable(svg)?.style.display).toBe('block');
    });

    it('applies fluff visibility to shadow wrapper svgs', () => {
        const wrapper = document.createElement('div');
        const svg = createSheetSvg();
        wrapper.appendChild(svg);

        service.setShadowFluffImageVisibility([wrapper as HTMLDivElement], true);

        expect(getFluffElement(svg)?.style.display).toBe('block');
        expect(getReferenceTable(svg)?.style.display).toBe('none');
    });
});

function createSheetSvg(): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const xhtmlNs = 'http://www.w3.org/1999/xhtml';
    const svg = document.createElementNS(svgNs, 'svg');
    const foreignObject = document.createElementNS(svgNs, 'foreignObject');
    foreignObject.setAttribute('id', 'fluff-image-fo');
    const fluffContainer = document.createElementNS(xhtmlNs, 'div');
    foreignObject.appendChild(fluffContainer);
    svg.appendChild(foreignObject);

    const referenceTable = document.createElementNS(svgNs, 'g');
    referenceTable.classList.add('referenceTable');
    svg.appendChild(referenceTable);

    return svg as SVGSVGElement;
}

function getFluffElement(svg: SVGSVGElement): HTMLElement | null {
    return svg.getElementById('fluff-image-fo') as HTMLElement | null;
}

function getReferenceTable(svg: SVGSVGElement): SVGGraphicsElement | null {
    return svg.querySelector('.referenceTable');
}