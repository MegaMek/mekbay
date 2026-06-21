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
});