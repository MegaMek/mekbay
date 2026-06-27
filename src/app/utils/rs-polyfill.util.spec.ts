import { RsPolyfillUtil } from './rs-polyfill.util';

describe('RsPolyfillUtil', () => {
    it('adds unit condition banners when the sheet has no unit data panel', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 612 792');
        const forceUnit = {
            rules: {
                conditionControls: [
                    { key: 'swarmed', label: 'SWARMED', color: '#b35c00', placement: 'menu' },
                ],
            },
            getUnit: () => ({ type: 'ProtoMek' }),
        };

        (RsPolyfillUtil as unknown as { addConditionsButtons: (unit: unknown, svg: SVGSVGElement) => void }).addConditionsButtons(forceUnit, svg);

        expect(svg.getElementById('unit_condition_wrapper')).toBeNull();
        expect(svg.getElementById('condition_banner_wrapper')).not.toBeNull();
        expect(svg.querySelector('.unitConditionBanner[condition="abandoned"]')).not.toBeNull();
        expect(svg.querySelector('.unitConditionBanner[condition="immobile"]')).not.toBeNull();
    });

    it('adds hidden 3x3 motive hit pip overlays below repeatable motive hit controls', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const motiveHit2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        motiveHit2.setAttribute('id', 'motive_system_hit_2');
        const motiveHit3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        motiveHit3.setAttribute('id', 'motive_system_hit_3');
        (motiveHit2 as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 10, y: 20, width: 9, height: 9 } as DOMRect);
        (motiveHit3 as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 30, y: 20, width: 9, height: 9 } as DOMRect);
        svg.append(motiveHit2, motiveHit3);

        (RsPolyfillUtil as unknown as { addMotiveHitPips: (svg: SVGSVGElement) => void }).addMotiveHitPips(svg);

        const pips2 = svg.querySelectorAll('#motive_system_hit_2_pips .motiveHitPip');
        const pips3 = svg.querySelectorAll('#motive_system_hit_3_pips .motiveHitPip');
        expect(pips2.length).toBe(9);
        expect(pips3.length).toBe(9);
        expect(Array.from(pips2).every(pip => pip.classList.contains('hidden'))).toBeTrue();
        expect((pips2[0] as SVGCircleElement).getAttribute('cx')).toBe('11.5');
        expect((pips2[0] as SVGCircleElement).getAttribute('cy')).toBe('31.5');
    });

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