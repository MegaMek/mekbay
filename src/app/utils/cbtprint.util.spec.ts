import { CBTPrintUtil } from './cbtprint.util';

describe('CBTPrintUtil', () => {
    it('keeps the injected HTML fluff image visible when it loads successfully', async () => {
        const svg = createSheetSvg();
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('id', 'fluff-image-fo');
        foreignObject.style.display = 'block';

        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('src', 'https://example.invalid/fluff.png');
        foreignObject.appendChild(image);
        svg.appendChild(foreignObject);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('load'));

        await wait;

        expect(foreignObject.style.display).toBe('block');
        expect(getReferenceTable(svg).style.display).toBe('none');
    });

    it('restores reference tables when the injected HTML fluff image fails to load', async () => {
        const svg = createSheetSvg();
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('id', 'fluff-image-fo');
        foreignObject.style.display = 'block';

        const image = document.createElementNS('http://www.w3.org/1999/xhtml', 'img') as HTMLImageElement;
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('src', 'https://example.invalid/fluff.png');
        foreignObject.appendChild(image);
        svg.appendChild(foreignObject);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('error'));

        await wait;

        expect(foreignObject.style.display).toBe('none');
        expect(getReferenceTable(svg).style.display).toBe('block');
    });

    it('restores reference tables when an injected SVG fluff image fails to load', async () => {
        const svg = createSheetSvg();
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('id', 'fluff-image-injected');
        image.setAttribute('href', 'https://example.invalid/fluff.png');
        image.style.display = 'block';
        svg.appendChild(image);

        const wait = waitForSvgImagesToLoad(svg);
        image.dispatchEvent(new Event('error'));

        await wait;

        expect(image.style.display).toBe('none');
        expect(getReferenceTable(svg).style.display).toBe('block');
    });
});

function createSheetSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const referenceTable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    referenceTable.classList.add('referenceTable');
    referenceTable.style.display = 'none';
    svg.appendChild(referenceTable);
    return svg;
}

function getReferenceTable(svg: SVGSVGElement): SVGGraphicsElement {
    return svg.querySelector('.referenceTable') as SVGGraphicsElement;
}

function waitForSvgImagesToLoad(root: ParentNode): Promise<void> {
    return (CBTPrintUtil as unknown as {
        waitForSvgImagesToLoad(root: ParentNode): Promise<void>;
    }).waitForSvgImagesToLoad(root);
}