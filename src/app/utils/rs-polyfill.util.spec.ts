import { RsPolyfillUtil } from './rs-polyfill.util';

describe('RsPolyfillUtil', () => {
    it('adds target TN overlay elements beside existing hit modifier elements', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g class="inventoryEntry" id="Laser">
                <rect class="hitMod-rect" x="1" y="2" width="10" height="8" fill="#000"></rect>
                <text class="hitMod-text" x="6" y="8" fill="#fff">+1</text>
            </g>
        `;

        RsPolyfillUtil.addHitMod(svg);

        const entry = svg.querySelector('.inventoryEntry')!;
        const targetTnRect = entry.querySelector('.targetTn-rect') as SVGRectElement;
        const targetTnText = entry.querySelector('.targetTn-text') as SVGTextElement;
        expect(targetTnRect).not.toBeNull();
        expect(targetTnRect.getAttribute('display')).toBe('none');
        expect(targetTnRect.getAttribute('fill')).toBe('#fff');
        expect(targetTnRect.getAttribute('stroke')).toBe('#000');
        expect(targetTnText).not.toBeNull();
        expect(targetTnText.getAttribute('display')).toBe('none');
        expect(targetTnText.textContent).toBe('');
        expect(entry.querySelector('.targetAimedShotWarning-text')).toBeNull();
        expect(entry.querySelectorAll('.hitMod-rect').length).toBe(1);
        expect(entry.querySelectorAll('.hitMod-text').length).toBe(1);
    });

    it('adds the aimed shot warning element to the right side of inventory rows', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g id="armorPanel"></g>
            <g id="unitDataPanel"><path></path><path class="frame"></path></g>
            <g class="inventoryEntry" id="Laser">
                <g class="name"><text>Laser</text></g>
            </g>
            <g id="heatPanel"></g>
        `;
        const unitDataFrame = svg.querySelector('#unitDataPanel .frame') as SVGGraphicsElement;
        const entry = svg.querySelector('.inventoryEntry') as SVGGraphicsElement;
        const name = svg.querySelector('.name') as SVGGraphicsElement;
        const nameText = svg.querySelector('.name text') as SVGGraphicsElement;
        spyOn(unitDataFrame, 'getBBox').and.returnValue({ x: 0, y: 0, width: 120, height: 30 } as DOMRect);
        spyOn(entry, 'getBBox').and.returnValue({ x: 10, y: 20, width: 80, height: 8 } as DOMRect);
        spyOn(name, 'getBBox').and.returnValue({ x: 10, y: 20, width: 35, height: 8 } as DOMRect);
        spyOn(nameText, 'getBBox').and.returnValue({ x: 10, y: 20, width: 35, height: 8 } as DOMRect);

        RsPolyfillUtil.addInventoryLines(svg);

        const warningText = entry.querySelector('.targetAimedShotWarning-text') as SVGTextElement;
        expect(warningText).not.toBeNull();
        expect(warningText.getAttribute('x')).toBe('116');
        expect(warningText.getAttribute('text-anchor')).toBe('end');
        expect(warningText.getAttribute('display')).toBe('none');
        expect(warningText.textContent).toBe('');
        expect(svg.lastElementChild?.id).toBe('unitDataPanel');
    });
});