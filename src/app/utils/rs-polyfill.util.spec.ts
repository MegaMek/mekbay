import { RsPolyfillUtil } from './rs-polyfill.util';

describe('RsPolyfillUtil', () => {
    it('injects fluff at outer root coordinates across a nested SVG viewport', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const parent = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const nestedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const firstTable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const secondTable = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        parent.setAttribute('transform', 'translate(18 18)');
        firstTable.setAttribute('transform', 'translate(230 70)');
        secondTable.setAttribute('transform', 'translate(230 70)');
        firstTable.classList.add('referenceTable');
        secondTable.classList.add('referenceTable');
        firstTable.getBBox = () => ({ x: 0, y: 91, width: 149, height: 128 } as DOMRect);
        secondTable.getBBox = () => ({ x: 0, y: 224, width: 149, height: 81 } as DOMRect);
        const rootMatrix = svg.createSVGMatrix();
        const nestedTableMatrix = svg.createSVGMatrix();
        nestedTableMatrix.e = 248;
        nestedTableMatrix.f = 88;
        svg.getScreenCTM = () => rootMatrix;
        firstTable.getScreenCTM = () => nestedTableMatrix;
        secondTable.getScreenCTM = () => nestedTableMatrix;
        nestedSvg.append(firstTable, secondTable);
        parent.appendChild(nestedSvg);
        svg.appendChild(parent);

        (RsPolyfillUtil as unknown as {
            injectFluffImage: (unit: { fluff: { img: string } }, svg: SVGSVGElement) => void;
        }).injectFluffImage({ fluff: { img: 'Mek/Avatar.png' } }, svg);

        const foreignObject = svg.getElementById('fluff-image-fo') as SVGForeignObjectElement;
        expect(foreignObject).not.toBeNull();
        expect(foreignObject.parentNode).toBe(svg);
        expect(Number(foreignObject.getAttribute('x'))).toBeCloseTo(248);
        expect(Number(foreignObject.getAttribute('y'))).toBeCloseTo(179);
        expect(Number(foreignObject.getAttribute('width'))).toBeCloseTo(149);
        expect(Number(foreignObject.getAttribute('height'))).toBeCloseTo(214);
    });

    it('adds location NARC banners inside location condition controls', () => {
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
        const control = critGroup.querySelector('.locationConditionControl') as SVGGElement;
        expect(narcBanner).not.toBeNull();
        expect(narcBanner.parentNode).toBe(control);
        expect(narcBanner.getAttribute('transform')).toBeNull();
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
        expect((entry.querySelector('.hitMod-rect') as SVGRectElement).getAttribute('display')).toBe('none');
        expect((entry.querySelector('.hitMod-text') as SVGTextElement).textContent).toBe('');
        expect(entry.querySelector('.targetAimedShotWarning-text')).toBeNull();
        expect(entry.querySelectorAll('.hitMod-rect').length).toBe(1);
        expect(entry.querySelectorAll('.hitMod-text').length).toBe(1);
    });

    it('adds hit modifier and target TN elements to inventory rows without a name wrapper', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g class="inventoryEntry" id="AeroLaser">
                <text x="20" y="10" font-size="8">Medium Laser</text>
            </g>
        `;
        const entry = svg.querySelector('.inventoryEntry') as unknown as SVGGraphicsElement;
        entry.getBBox = () => ({ x: 20, y: 2, width: 60, height: 10 } as DOMRect);

        RsPolyfillUtil.addHitMod(svg);

        expect(entry.querySelector(':scope > .hitMod-rect')).not.toBeNull();
        expect(entry.querySelector(':scope > .hitMod-text')).not.toBeNull();
        expect(entry.querySelector(':scope > .targetTn-rect')).not.toBeNull();
        expect(entry.querySelector(':scope > .targetTn-text')).not.toBeNull();
        expect(entry.querySelector('.hitMod-rect')?.getAttribute('display')).toBe('none');
        expect(entry.querySelector('.targetTn-rect')?.getAttribute('display')).toBe('none');
    });

    it('repairs incomplete hit and target TN element pairs idempotently', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g class="inventoryEntry">
                <g class="name"><text>Laser</text></g>
                <rect class="hitMod-rect"></rect>
                <text class="targetTn-text"></text>
            </g>
        `;
        const name = svg.querySelector('.name') as unknown as SVGGraphicsElement;
        name.getBBox = () => ({ x: 0, y: 2, width: 50, height: 10 } as DOMRect);

        RsPolyfillUtil.addHitMod(svg);
        RsPolyfillUtil.addHitMod(svg);

        const entry = svg.querySelector('.inventoryEntry')!;
        expect(entry.classList.contains('eq-undefined')).toBeFalse();
        expect(entry.querySelectorAll(':scope > .hitMod-rect').length).toBe(1);
        expect(entry.querySelectorAll(':scope > .hitMod-text').length).toBe(1);
        expect(entry.querySelectorAll(':scope > .targetTn-rect').length).toBe(1);
        expect(entry.querySelectorAll(':scope > .targetTn-text').length).toBe(1);
    });

    it('discovers a ground Extreme inventory column when its header is present', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const inventoryBox = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        inventoryBox.setAttribute('id', 'gInventoryBox');
        ['Sht', 'Med', 'Lng', 'Ext'].forEach((label, index) => {
            const header = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            header.textContent = label;
            (header as unknown as { getBBox: () => DOMRect }).getBBox = () => ({
                x: 100 + index * 20,
                y: 0,
                width: 12,
                height: 8
            } as DOMRect);
            inventoryBox.appendChild(header);
        });
        svg.appendChild(inventoryBox);

        const columns = (RsPolyfillUtil as unknown as {
            findInventoryRangeButtonColumns: (svg: SVGSVGElement) => Array<{ className: string }>;
        }).findInventoryRangeButtonColumns(svg);

        expect(columns.map(column => column.className))
            .toEqual(['shrButton', 'medButton', 'lngButton', 'extButton']);
    });

    it('adds inventory hit areas and strike lines idempotently', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const entry = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const name = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        entry.setAttribute('id', 'Laser');
        entry.setAttribute('class', 'inventoryEntry');
        name.setAttribute('class', 'name');
        (entry as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 2, y: 10, width: 100, height: 10 } as DOMRect);
        (name as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 4, y: 10, width: 40, height: 10 } as DOMRect);
        entry.appendChild(name);
        svg.appendChild(entry);

        RsPolyfillUtil.addInventoryLines(svg);
        RsPolyfillUtil.addInventoryLines(svg);

        expect(entry.querySelectorAll(':scope > .inventoryEntryButton.mainButton').length).toBe(1);
        expect(entry.querySelectorAll(':scope > .damaged-strike').length).toBe(1);
    });

    it('adds heat controls idempotently', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.innerHTML = `
            <g id="heatDataPanel">
                <g><path></path><text>HEAT</text></g>
                <path></path>
                <g class="hsPips"></g>
            </g>
        `;
        svg.querySelectorAll<SVGGraphicsElement>('path, .hsPips').forEach(element => {
            element.getBBox = () => ({ x: 0, y: 0, width: 20, height: 10 } as DOMRect);
        });
        const addApplyHeatButton = (RsPolyfillUtil as unknown as {
            addApplyHeatButton: (svg: SVGSVGElement) => void;
        }).addApplyHeatButton.bind(RsPolyfillUtil);

        addApplyHeatButton(svg);
        addApplyHeatButton(svg);

        expect(svg.querySelectorAll('#applyHeatButton').length).toBe(1);
        expect(svg.querySelectorAll('#damagedEngineHeatText').length).toBe(1);
        expect(svg.querySelectorAll('.changeActiveHeatsinksCountButton').length).toBe(1);
    });
});