import { RsPolyfillUtil } from './rs-polyfill.util';

describe('RsPolyfillUtil', () => {
    it('adds location NARC banners outside critical location groups', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const parent = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const critGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        critGroup.setAttribute('class', 'critGroup');
        critGroup.setAttribute('loc', 'LA');
        critGroup.setAttribute('transform', 'translate(4 6)');
        (label as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 20, y: 30, width: 12, height: 8 } as DOMRect);
        critGroup.appendChild(label);
        parent.appendChild(critGroup);
        svg.appendChild(parent);

        (RsPolyfillUtil as unknown as { addCriticalSectionsButtons: (unit: { type: string }, svg: SVGSVGElement) => void }).addCriticalSectionsButtons({ type: 'Mek' }, svg);

        const narcBanner = svg.querySelector('.locationNarcBanner') as SVGGElement;
        expect(narcBanner).not.toBeNull();
        expect(critGroup.querySelector('.locationNarcBanner')).toBeNull();
        expect(narcBanner.parentNode).toBe(parent);
        expect(narcBanner.getAttribute('transform')).toBe('translate(4 6)');
    });

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
        expect(svg.querySelector('.unitConditionBanner[condition="crippled"]')).not.toBeNull();
        expect(svg.querySelector('.unitConditionBanner[condition="disconnected"]')).not.toBeNull();
    });

    it('adds only one disconnected banner when disconnected is also a unit condition control', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 612 792');
        const forceUnit = {
            rules: {
                conditionControls: [
                    { key: 'disconnected', label: 'DISCONNECTED', color: '#455a64', placement: 'menu' },
                ],
            },
            getUnit: () => ({ type: 'Aero' }),
        };

        (RsPolyfillUtil as unknown as { addConditionsButtons: (unit: unknown, svg: SVGSVGElement) => void }).addConditionsButtons(forceUnit, svg);

        expect(svg.querySelectorAll('.unitConditionBanner[condition="disconnected"]').length).toBe(1);
    });

    it('adds missing condition buttons to existing right-aligned unit condition wrappers', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g id="unit_condition_wrapper" class="unitConditionWrapper">
                <g id="unit_condition_button_shutdown" class="unitConditionButton" condition="shutdown"><rect x="10" y="20" width="45" height="12"></rect><text></text></g>
                <g id="unit_condition_button_prone" class="unitConditionButton" condition="prone"><rect x="57" y="20" width="30" height="12"></rect><text></text></g>
                <g id="unit_condition_button_menu" class="unitConditionButton" condition="menu"><rect x="89" y="20" width="14" height="12"></rect><text></text></g>
            </g>
            <g id="condition_banner_wrapper" class="unitConditionBannerWrapper"></g>
        `;
        const forceUnit = {
            rules: {
                conditionControls: [
                    { key: 'shutdown', label: 'SHUTDOWN', color: '#840000', placement: 'button' },
                    { key: 'prone', label: 'PRONE', color: '#666', placement: 'button' },
                    { key: 'disconnected', label: 'DISCONNECTED', color: '#455a64', placement: 'button' },
                    { key: 'jammed', label: 'JAMMED', color: '#ff6be6', placement: 'menu' },
                ],
            },
            getUnit: () => ({ type: 'Mek' }),
        };

        (RsPolyfillUtil as unknown as { addConditionsButtons: (unit: unknown, svg: SVGSVGElement) => void }).addConditionsButtons(forceUnit, svg);

        const disconnectedButton = svg.querySelector('.unitConditionButton[condition="disconnected"]') as SVGElement;
        expect(disconnectedButton).not.toBeNull();
        expect(disconnectedButton.getAttribute('active-color')).toBe('#455a64');
        expect(disconnectedButton.querySelector('text')?.textContent).toBe('DISCONNECTED');
        expect(disconnectedButton.querySelector('rect')?.getAttribute('x')).toBe('21');
        expect(disconnectedButton.querySelector('rect')?.getAttribute('y')).toBe('20');

        const menuRect = svg.querySelector('.unitConditionButton[condition="menu"] rect') as SVGRectElement;
        expect(menuRect.getAttribute('x')).toBe('89');
        expect(menuRect.getAttribute('y')).toBe('20');
    });

    it('syncs drone-only condition buttons after unit inventory initialization', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g id="unit_condition_wrapper" class="unitConditionWrapper">
                <g id="unit_condition_button_shutdown" class="unitConditionButton" condition="shutdown"><rect x="10" y="20" width="45" height="12"></rect><text></text></g>
                <g id="unit_condition_button_prone" class="unitConditionButton" condition="prone"><rect x="57" y="20" width="30" height="12"></rect><text></text></g>
            </g>
            <g id="condition_banner_wrapper" class="unitConditionBannerWrapper"></g>
        `;
        const conditionControls = [
            { key: 'shutdown', label: 'SHUTDOWN', color: '#840000', placement: 'button' },
            { key: 'prone', label: 'PRONE', color: '#666', placement: 'button' },
        ];
        const forceUnit = {
            rules: { conditionControls },
            getUnit: () => ({ type: 'Mek' }),
        };

        RsPolyfillUtil.syncConditionButtons(forceUnit as never, svg);
        expect(svg.querySelector('.unitConditionButton[condition="disconnected"]')).toBeNull();

        conditionControls.push({ key: 'disconnected', label: 'DISCONNECTED', color: '#455a64', placement: 'button' });
        RsPolyfillUtil.syncConditionButtons(forceUnit as never, svg);

        expect(svg.querySelector('.unitConditionButton[condition="disconnected"]')).not.toBeNull();
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