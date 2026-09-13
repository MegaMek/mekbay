// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestAeroSpaceFighterEntity, TestBattleArmorEntity, TestBipedMekEntity,
    TestInfantryEntity, TestLamEntity, TestProtoMekEntity, TestVtolEntity, TestWarShipEntity,
} from '../../models/entity/testing/test-entities';
import { addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { CapitalShipPipRenderer } from './capital-ship-pip-renderer';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';
import { createRoot } from './record-sheet-svg-rendering';

describe('generated record-sheet styles', () => {
    let stage: HTMLDivElement;
    let hoverStyle: HTMLStyleElement;

    beforeEach(() => {
        stage = document.createElement('div');
        document.body.appendChild(stage);
        // Synthetic mouse events cannot activate :hover. Reuse the browser-parsed
        // rules with a controllable state class, preserving their media/specificity.
        hoverStyle = document.createElement('style');
        hoverStyle.textContent = [...document.styleSheets]
            .map(sheet => controllableHoverRules(sheet.cssRules)).join('\n');
        document.head.appendChild(hoverStyle);
    });

    afterEach(() => {
        hoverStyle.remove();
        stage.remove();
    });

    for (const Factory of [TestBipedMekEntity, TestAeroSpaceFighterEntity,
        TestBattleArmorEntity, TestInfantryEntity, TestVtolEntity, TestWarShipEntity]) {
        it(`themes an imperatively mounted ${Factory.name} and its cloned preview`, async () => {
            const svg = await RecordSheetSvgGenerator.generate(new Factory());
            const preview = svg.cloneNode(true) as SVGSVGElement;
            stage.append(svg, preview);
            for (const sheet of [svg, preview]) {
                expect(getComputedStyle(sheet).backgroundColor).toBe('rgb(255, 255, 255)');
            }
            stage.classList.add('night-mode');
            for (const sheet of [svg, preview]) {
                expect(getComputedStyle(sheet).backgroundColor).toBe('rgb(20, 20, 20)');
            }
        });
    }

    it('preserves heat-scale colors in both themes through generation and cloning', async () => {
        const generated = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        const svg = generated.cloneNode(true) as SVGSVGElement;
        stage.appendChild(svg);
        const checkpoints = [
            [0, 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
            [14, 'rgb(255, 255, 17)', 'rgb(127, 127, 0)'],
            [15, 'rgb(255, 255, 0)', 'rgb(136, 136, 0)'],
            [30, 'rgb(255, 0, 0)', 'rgb(255, 0, 0)'],
        ] as const;
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            for (const [heat, dayColor, nightColor] of checkpoints) {
                const cell = svg.querySelector<SVGRectElement>(`.heat[heat="${heat}"]`)!;
                cell.classList.remove('hot');
                expect(getComputedStyle(cell).fill).withContext(`inactive ${heat}, night=${night}`)
                    .toBe(night ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
                cell.classList.add('hot');
                expect(getComputedStyle(cell).fill).withContext(`active ${heat}, night=${night}`)
                    .toBe(night ? nightColor : dayColor);
            }
        }
    });

    it('keeps damage and repair colors above authored fills and night recoloring', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        stage.appendChild(svg);
        const pip = svg.querySelector<SVGElement>('.pip')!;
        const originalClass = pip.getAttribute('class')!;
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            for (const [state, color] of [
                ['damaged', 'rgb(255, 0, 0)'],
                ['disabled damaged', 'rgb(255, 0, 0)'],
                ['damaged pending', 'rgb(255, 165, 0)'],
                ['damaged pending fresh', 'rgb(255, 255, 0)'],
                ['pending', 'rgb(3, 169, 244)'],
            ]) {
                pip.setAttribute('class', `${originalClass} ${state}`);
                pip.setAttribute('fill', '#fff');
                expect(getComputedStyle(pip).fill).withContext(`${state}, night=${night}`).toBe(color);
            }
        }
    });

    it('distinguishes custom ammo while keeping damage color dominant', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        stage.appendChild(svg);
        const slot = svg.querySelector('.critSlot[hittable]')!;
        const label = slot.querySelector('text')!;
        slot.classList.add('customAmmoLoadout');
        expect(getComputedStyle(label).fill).toBe('rgb(0, 0, 255)');
        stage.classList.add('night-mode');
        expect(getComputedStyle(label).fill).toBe('rgb(187, 187, 255)');
        slot.classList.add('damaged');
        expect(getComputedStyle(label).fill).toBe('rgb(255, 0, 0)');
    });

    it('enables pointer targets and cursors only on bound controls in live sheets', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        stage.style.cursor = 'grab';
        stage.appendChild(svg);
        const row = svg.querySelector('.inventoryEntry')!;
        const location = svg.querySelector('.unitLocation')!;
        const crew = svg.querySelector('.crewHit')!;
        row.classList.add('interactive');
        location.classList.add('selectable');
        for (const control of [row, location, crew]) {
            expect(getComputedStyle(control).cursor).toBe('grab');
            expect(getComputedStyle(control).pointerEvents).toBe('none');
        }
        svg.classList.add('interactive-sheet');
        expect(getComputedStyle(row.querySelector('.inventoryEntryButton')!).pointerEvents).toBe('all');
        expect(getComputedStyle(row.querySelector('text')!).pointerEvents).toBe('none');
        expect(getComputedStyle(svg.querySelector('.unitConditionBanner')!).pointerEvents).toBe('none');
        for (const control of [row, location]) {
            expect(getComputedStyle(control).cursor).toBe('pointer');
        }
        expect(getComputedStyle(crew).cursor).toBe('grab');
        // Read-only viewers can still bind presentation actions.
        svg.classList.add('read-only');
        for (const control of [row, location]) {
            expect(getComputedStyle(control).cursor).toBe('pointer');
        }
        svg.classList.add('print-preview');
        for (const control of [row, location, crew]) {
            expect(getComputedStyle(control).cursor).toBe('grab');
            expect(getComputedStyle(control).pointerEvents).toBe('none');
        }
    });

    it('keeps every generated hit target passive until a live viewer opts in', async () => {
        for (const Factory of [TestBipedMekEntity, TestAeroSpaceFighterEntity,
            TestBattleArmorEntity, TestInfantryEntity, TestVtolEntity, TestWarShipEntity]) {
            const svg = await RecordSheetSvgGenerator.generate(new Factory());
            stage.appendChild(svg);
            for (const element of [svg, ...svg.querySelectorAll('*')]) {
                expect(getComputedStyle(element).pointerEvents)
                    .withContext(`${Factory.name}: ${element.tagName}.${element.getAttribute('class')}`)
                    .toBe('none');
            }
            svg.remove();
        }
    });

    it('gates inventory and paperdoll hover effects while preserving their runtime state', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        stage.appendChild(svg);
        const row = svg.querySelector('.inventoryEntry')!;
        const button = row.querySelector('.inventoryEntryButton')!;
        const location = svg.querySelector<SVGElement>('.unitLocation')!;
        location.style.transition = 'none';
        row.classList.add('interactive', 'style-test-hover');
        location.classList.add('selectable', 'damaged', 'style-test-hover');
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            expect(getComputedStyle(button).fill).toBe('rgba(0, 0, 0, 0)');
            expect(getComputedStyle(location).fill).toBe('rgb(255, 0, 0)');
            svg.classList.add('interactive-sheet');
            expect(getComputedStyle(button).fill).not.toBe('rgba(0, 0, 0, 0)');
            expect(getComputedStyle(location).fill).toBe('rgb(255, 105, 105)');
            svg.classList.remove('interactive-sheet');
        }
    });

    it('keeps selected weapon ranges visible when their live controls are hovered', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        svg.classList.add('interactive-sheet');
        stage.style.setProperty('--inventory-control-selection-color', '#123456');
        stage.appendChild(svg);
        const row = svg.querySelector('.inventoryEntry:has(.mainButton)')!;
        const main = row.querySelector('.mainButton')!;
        row.classList.add('interactive', 'selected-range-short');
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            expect(getComputedStyle(main).fill).toBe('rgb(18, 52, 86)');
            row.classList.add('style-test-hover');
            expect(getComputedStyle(main).fill).toBe('rgb(18, 52, 86)');
            row.classList.remove('style-test-hover');
        }
    });

    it('keeps ProtoMek crew-hit numbers readable against live damage colors', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestProtoMekEntity());
        stage.appendChild(svg);
        const hit = svg.querySelector('.crewHit')!;
        const label = hit.nextElementSibling!;
        hit.classList.add('damaged');
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            expect(getComputedStyle(hit).fill).toBe('rgb(255, 0, 0)');
            expect(getComputedStyle(label).fill).toBe('rgb(255, 255, 255)');
        }
    });

    it('underlines the generated heading when its location control is hovered', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        svg.classList.add('interactive-sheet');
        stage.appendChild(svg);
        const control = svg.querySelector('.locationConditionControl')!;
        const heading = control.querySelector('.locationConditionText')!;
        expect(getComputedStyle(heading).textDecorationLine).toBe('none');
        control.classList.add('interactive');
        expect(getComputedStyle(heading).textDecorationStyle).toBe('dotted');
        control.classList.add('style-test-hover');
        expect(getComputedStyle(heading).textDecorationStyle).toBe('solid');
        svg.classList.remove('interactive-sheet');
        expect(getComputedStyle(heading).textDecorationLine).toBe('none');
    });

    it('uses the damaged highlight when hovering a damaged location in night mode', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestBipedMekEntity());
        svg.classList.add('interactive-sheet');
        stage.classList.add('night-mode');
        stage.appendChild(svg);
        const location = svg.querySelector<SVGElement>('.unitLocation')!;
        location.style.transition = 'none';
        location.classList.add('selectable', 'damaged', 'style-test-hover');
        expect(getComputedStyle(location).fill).toBe('rgb(255, 105, 105)');
    });

    it('colors the generated VTOL rotor preview for both damage and repair', async () => {
        const svg = await RecordSheetSvgGenerator.generate(new TestVtolEntity());
        stage.appendChild(svg);
        const rotor = svg.querySelector<SVGElement>('.critLoc[critId="rotor"]')!;
        const frame = rotor.matches('rect') ? rotor : rotor.querySelector('rect')!;
        for (const night of [false, true]) {
            stage.classList.toggle('night-mode', night);
            rotor.classList.add('rotorHitsPendingPositive');
            expect(getComputedStyle(frame).stroke).toBe('rgb(255, 165, 0)');
            rotor.classList.replace('rotorHitsPendingPositive', 'rotorHitsPendingNegative');
            expect(getComputedStyle(frame).stroke).toBe('rgb(3, 169, 244)');
            rotor.classList.remove('rotorHitsPendingNegative');
        }
    });
});

describe('standalone record-sheet styles', () => {
    let frame: HTMLIFrameElement;
    let isolatedDocument: Document;
    let view: Window;

    beforeEach(() => {
        frame = document.createElement('iframe');
        document.body.appendChild(frame);
        isolatedDocument = frame.contentDocument!;
        view = frame.contentWindow!;
        expect(isolatedDocument.styleSheets.length).toBe(0);
    });

    afterEach(() => frame.remove());

    function mountExport(svg: SVGSVGElement): SVGSVGElement {
        // Exercise both preview cloning and SVG export without the app stylesheet.
        const serialized = new XMLSerializer().serializeToString(svg.cloneNode(true));
        const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml');
        const sheet = isolatedDocument.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
        isolatedDocument.body.appendChild(sheet);
        return sheet;
    }

    it('preserves pip geometry and damage after cloning and serialization', async () => {
        const entity = new TestLamEntity();
        entity.setTonnage(50);
        entity.setArmorValue('CT', 'front', 3);
        addTestEquipmentWithFlags(entity, 'F_HEAT_SINK', { location: 'CT' });
        const sheet = mountExport(await RecordSheetSvgGenerator.generate(entity));
        for (const [selector, fill, width] of [
            ['.pip.armor[data-loc="CT"]', 'rgb(255, 255, 255)', '0.5px'],
            ['.systemHitPip', 'none', '1.72px'],
            ['.structuralIntegrityPip', 'none', '1.72px'],
            ['.hsPip', 'rgb(255, 255, 255)', '0.9px'],
        ]) {
            const pip = sheet.querySelector(selector)!;
            const style = view.getComputedStyle(pip);
            expect(style.fill).withContext(selector).toBe(fill);
            expect(style.stroke).withContext(selector).toBe('rgb(0, 0, 0)');
            expect(style.strokeWidth).withContext(selector).toBe(width);
            expect(style.vectorEffect).withContext(selector).toBe('non-scaling-stroke');
            pip.classList.add('damaged', 'disabled');
            expect(view.getComputedStyle(pip).fill).withContext(selector).toBe('rgb(17, 17, 17)');
            expect(view.getComputedStyle(pip).opacity).withContext(selector).toBe('0.38');
        }
        expect(view.getComputedStyle(sheet.querySelector('text')!).fontFamily)
            .toBe('Roboto, Arial, sans-serif');
    });

    it('preserves battle-armor status shading and its damage override', async () => {
        const entity = new TestBattleArmorEntity();
        entity.setArmorValue('Squad', 'front', 6);
        const sheet = mountExport(await RecordSheetSvgGenerator.generate(entity));
        const pip = sheet.querySelector('.trooperStatusPip')!;
        expect(view.getComputedStyle(pip).strokeWidth).toBe('0.9px');
        expect(view.getComputedStyle(pip).fill).toBe('rgb(63, 63, 63)');
        pip.classList.add('damaged');
        expect(view.getComputedStyle(pip).fill).toBe('rgb(17, 17, 17)');
        pip.classList.remove('damaged');
        expect(view.getComputedStyle(pip).fill).toBe('rgb(63, 63, 63)');
    });

    it('preserves crew-hit label contrast without the live damage theme', async () => {
        const sheet = mountExport(await RecordSheetSvgGenerator.generate(new TestProtoMekEntity()));
        const hit = sheet.querySelector('.crewHit')!;
        const label = hit.nextElementSibling!;
        hit.classList.add('damaged');
        expect(view.getComputedStyle(hit).fill).toBe('rgb(17, 17, 17)');
        expect(view.getComputedStyle(label).fill).toBe('rgb(255, 255, 255)');
        hit.classList.remove('damaged');
        expect(view.getComputedStyle(hit).fill).toBe('rgb(255, 255, 255)');
        expect(view.getComputedStyle(label).fill).toBe('rgb(0, 0, 0)');
    });

    it('preserves capital damage colors and transparent hit targets through their attributes', () => {
        const source = createRoot(200, 200, 'warship');
        source.appendChild(CapitalShipPipRenderer.createPips(10, 100, 100, 'armor', 'NOSE')!);
        const sheet = mountExport(source);
        for (const [state, color] of [
            ['damaged', 'rgb(17, 17, 17)'],
            ['pending-damage', 'rgb(255, 165, 0)'],
            ['fresh-damage', 'rgb(255, 255, 0)'],
            ['pending-repair', 'rgb(3, 169, 244)'],
            ['fresh-repair', 'rgb(128, 222, 234)'],
        ]) {
            const path = sheet.querySelector(`.capital-pip-state-${state}`);
            expect(path).withContext(state).not.toBeNull();
            if (!path) continue;
            expect(view.getComputedStyle(path).fill).withContext(state).toBe(color);
        }
        const target = sheet.querySelector('.capital-pip-interaction');
        expect(target).not.toBeNull();
        if (!target) return;
        expect(view.getComputedStyle(target).fill).toBe('rgba(0, 0, 0, 0)');
        expect(view.getComputedStyle(target).stroke).toBe('rgba(0, 0, 0, 0)');
        expect(view.getComputedStyle(target).pointerEvents).toBe('none');
        sheet.classList.add('interactive-sheet');
        expect(view.getComputedStyle(target).pointerEvents).toBe('all');
        sheet.classList.add('print-preview');
        expect(view.getComputedStyle(target).pointerEvents).toBe('none');
    });

    it('preserves print visibility in serialized previews without changing live sheets or unrelated SVGs', async () => {
        isolatedDocument.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
            <text font-family="monospace">Unrelated</text>
            <circle class="pip" fill="purple" stroke="green" stroke-width="3" />
            <rect class="hidden screen-only" />
        </svg>`;
        const unrelated = isolatedDocument.querySelector('svg')!;
        const originalOverflow = view.getComputedStyle(unrelated).overflow;
        const sheet = mountExport(await RecordSheetSvgGenerator.generate(new TestBipedMekEntity()));
        expect(view.getComputedStyle(unrelated).overflow).toBe(originalOverflow);
        expect(view.getComputedStyle(unrelated.querySelector('text')!).fontFamily).toBe('monospace');
        expect(view.getComputedStyle(unrelated.querySelector('.pip')!).fill).toBe('rgb(128, 0, 128)');
        expect(view.getComputedStyle(unrelated.querySelector('.pip')!).strokeWidth).toBe('3px');
        expect(view.getComputedStyle(unrelated.querySelector('.hidden')!).display).not.toBe('none');
        const screenOnly = sheet.querySelector('.unitConditionButton.screen-only')!;
        const printOnly = sheet.querySelector('text')!;
        printOnly.classList.add('hidden', 'print-show');
        expect(view.getComputedStyle(screenOnly).display).not.toBe('none');
        expect(view.getComputedStyle(printOnly).display).toBe('none');
        sheet.classList.add('print-preview');
        const preview = mountExport(sheet);
        sheet.classList.remove('print-preview');
        for (const control of preview.querySelectorAll('.screen-only, .edit-only')) {
            expect(view.getComputedStyle(control).display).withContext(control.outerHTML).toBe('none');
        }
        expect(view.getComputedStyle(preview.querySelector('.print-show')!).display).not.toBe('none');
        expect(view.getComputedStyle(preview.querySelector('.inventoryEntry')!).display).not.toBe('none');
        expect(view.getComputedStyle(preview.querySelector('.pip')!).display).not.toBe('none');
        expect(view.getComputedStyle(screenOnly).display).not.toBe('none');
        expect(view.getComputedStyle(printOnly).display).toBe('none');
        // Activate the browser-parsed print rules without copying their declarations.
        const style = sheet.querySelector<SVGStyleElement>('#mekbay-svg-style')!;
        for (const rule of style.sheet!.cssRules) {
            if (rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).conditionText === 'print') {
                (rule as CSSMediaRule).media.mediaText = 'all';
            }
        }
        expect(view.getComputedStyle(screenOnly).display).toBe('none');
        expect(view.getComputedStyle(printOnly).display).not.toBe('none');
        expect(view.getComputedStyle(unrelated.querySelector('.screen-only')!).display).not.toBe('none');
    });
});

function controllableHoverRules(rules: CSSRuleList): string {
    return [...rules].map(rule => {
        if (rule instanceof CSSMediaRule) {
            return `@media ${rule.conditionText} {${controllableHoverRules(rule.cssRules)}}`;
        }
        if (rule instanceof CSSStyleRule && rule.selectorText.includes('.mekbay-sheet')
            && rule.selectorText.includes(':hover')) {
            return rule.cssText.replaceAll(':hover', '.style-test-hover');
        }
        return '';
    }).join('\n');
}
