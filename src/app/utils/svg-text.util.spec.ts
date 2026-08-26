import { getSvgTextLines, measureSvgTextCanvas, writeSvgTextLines } from './svg-text.util';

describe('svg text utilities', () => {
    function svg(markup: string): SVGSVGElement {
        return new DOMParser().parseFromString(
            `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
            'image/svg+xml',
        ).documentElement as unknown as SVGSVGElement;
    }

    it('finds direct text rows and direct tspans', () => {
        const root = svg('<g id="textRows"><text>First</text><text>Second</text></g><text id="tspanRows"><tspan>First</tspan><tspan>Second</tspan></text>');

        expect(getSvgTextLines(root.getElementById('textRows'))).toHaveSize(2);
        expect(getSvgTextLines(root.getElementById('tspanRows')).map(line => line.textContent)).toEqual(['First', 'Second']);
    });

    it('caches canvas metrics by font and text', () => {
        const root = svg('<text id="metricLine" font-size="8" font-family="Roboto"></text>');
        const line = root.getElementById('metricLine') as SVGTextContentElement;
        spyOnProperty(document.fonts, 'status', 'get').and.returnValue('loaded');
        const measureText = spyOn(CanvasRenderingContext2D.prototype, 'measureText').and.callThrough();
        const text = 'svg-metric-cache-sentinel';

        const firstWidth = measureSvgTextCanvas(line, text);
        const secondWidth = measureSvgTextCanvas(line, text);

        expect(secondWidth).toBe(firstWidth);
        expect(measureText.calls.allArgs().filter(([value]) => value === text)).toHaveSize(1);
    });

    it('wraps between rows and clears stale rows', () => {
        const root = svg('<g id="name"><text>Old first</text><text>Old second</text></g>');
        const measure = (_line: SVGTextContentElement, text: string) => text.length;

        writeSvgTextLines(root.getElementById('name'), 'Alpha Beta Gamma', { maxWidth: 10, measure });
        expect(getSvgTextLines(root.getElementById('name')).map(line => line.textContent)).toEqual(['Alpha Beta', 'Gamma']);

        writeSvgTextLines(root.getElementById('name'), 'Alpha', { maxWidth: 10, measure });
        expect(getSvgTextLines(root.getElementById('name')).map(line => line.textContent)).toEqual(['Alpha', '']);
    });

    it('uses an ellipsis when the final row cannot fit the remaining text', () => {
        const root = svg('<g id="name"><text>Old</text></g>');
        const measure = (_line: SVGTextContentElement, text: string) => text.length;

        writeSvgTextLines(root.getElementById('name'), 'Alpha Beta Gamma', { maxWidth: 10, measure });

        expect(root.getElementById('name')?.textContent).toBe('Alpha B...');
    });

    it('ellipsizes an unbroken word instead of showing later text after it', () => {
        const root = svg('<g id="name"><text>Old first</text><text>Old second</text></g>');
        const measure = (_line: SVGTextContentElement, text: string) => text.length;

        writeSvgTextLines(root.getElementById('name'), 'abcdefghijklmnop later', { maxWidth: 10, measure });

        expect(getSvgTextLines(root.getElementById('name')).map(line => line.textContent)).toEqual(['abcdefg...', '']);
    });

    it('keeps very long text bounded and stable across repeated writes', () => {
        const root = svg('<g id="name"><text>Old first</text><text>Old second</text><text>Old third</text></g>');
        const measure = (_line: SVGTextContentElement, text: string) => text.length;
        const value = 'a b c d e f g h i l m n o p q r s t u v z a b c d e f g h i l m n o p q r s t u v z';
        const options = { maxWidth: 10, measure };

        writeSvgTextLines(root.getElementById('name'), value, options);
        const firstWrite = getSvgTextLines(root.getElementById('name')).map(line => line.textContent ?? '');

        expect(firstWrite).toEqual(['a b c d e', 'f g h i l', 'm n o p...']);
        expect(firstWrite.every(line => line.length <= 10)).toBeTrue();

        writeSvgTextLines(root.getElementById('name'), value, options);
        expect(getSvgTextLines(root.getElementById('name')).map(line => line.textContent ?? '')).toEqual(firstWrite);
    });
});
