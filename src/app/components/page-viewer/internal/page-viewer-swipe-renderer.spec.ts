// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { buildSwipeRenderUpdate } from './page-viewer-swipe-renderer';

function createSvg(): SVGSVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('page-viewer swipe-renderer', () => {
    it('shows only the dominant single-page toolbar when a swipe changes direction', () => {
        const slots = [0, 1].map(index => {
            const element = document.createElement('div');
            const svg = createSvg();
            element.appendChild(svg);
            return { slotIndex: index, slotOffset: index, slotLeft: index * 1000,
                slotRight: (index + 1) * 1000, unitIndex: index, element, attachedSvg: svg };
        });
        const options: Parameters<typeof buildSwipeRenderUpdate>[0] = {
            slots, resolveUnit: index => ({ unitId: `u${index}`, svg: slots[index].attachedSvg }),
            visibleLeft: 0, visibleRight: 1000, scaledPageWidth: 1000,
            visiblePages: 1, addOnly: false, translateX: 0, lastTranslateX: 0,
            currentDirection: 'none', selectedUnitId: 'u0',
        };

        for (const left of [400, 600, 400]) {
            const update = buildSwipeRenderUpdate({ ...options, visibleLeft: left, visibleRight: left + 1000 });
            expect(update.slotInstructions.filter(instruction => instruction.decision.showTopRightControls)
                .map(instruction => instruction.unitId)).toEqual([left < 500 ? 'u0' : 'u1']);
            expect(update.slotInstructions.every(instruction => instruction.decision.action === 'reuse-existing')).toBeTrue();
        }
    });

    it('keeps toolbars on every active sheet but excludes neighbors and preloaded incoming sheets', () => {
        const slots = [-1, 0, 1, 2, 3].map((offset, index) => ({
            slotIndex: index, slotOffset: offset, slotLeft: offset * 1000,
            slotRight: (offset + 1) * 1000, unitIndex: index,
            element: document.createElement('div'), attachedSvg: null,
        }));
        const options: Parameters<typeof buildSwipeRenderUpdate>[0] = {
            slots, resolveUnit: index => ({ unitId: `u${index}`, svg: createSvg() }),
            visibleLeft: -200, visibleRight: 3200, scaledPageWidth: 1000,
            visiblePages: 3, addOnly: false, translateX: 0, lastTranslateX: 0,
            currentDirection: 'none', selectedUnitId: 'u1',
        };
        expect(buildSwipeRenderUpdate(options).slotInstructions
            .filter(instruction => instruction.decision.showTopRightControls)
            .map(instruction => instruction.unitId)).toEqual(['u1', 'u2', 'u3']);
        expect(buildSwipeRenderUpdate({ ...options, addOnly: true }).slotInstructions
            .some(instruction => instruction.decision.showTopRightControls)).toBeFalse();
    });

    it('resolves only visible slots and picks up a sheet that loads between frames', () => {
        const element = document.createElement('div');
        let svg: SVGSVGElement | null = null;
        const resolveUnit = jasmine.createSpy('resolveUnit').and.callFake((index: number) => ({ unitId: `u${index}`, svg }));
        const options: Parameters<typeof buildSwipeRenderUpdate>[0] = {
            slots: [{ slotIndex: 0, slotOffset: 0, slotLeft: 0, slotRight: 1000, unitIndex: 500,
                element, attachedSvg: null }],
            resolveUnit, visibleLeft: 0, visibleRight: 1000, scaledPageWidth: 1000,
            visiblePages: 1, addOnly: false, translateX: 0, lastTranslateX: 0,
            currentDirection: 'none', selectedUnitId: 'u500',
        };
        expect(buildSwipeRenderUpdate(options).slotInstructions[0].svg).toBeNull();
        expect(resolveUnit).toHaveBeenCalledOnceWith(500);
        svg = createSvg();
        expect(buildSwipeRenderUpdate(options).slotInstructions[0].svg).toBe(svg);
    });

    it('turns a losing attachment into a winning attach instruction after virtual clears', () => {
        const offscreenSlot = document.createElement('div');
        const visibleSlot = document.createElement('div');
        const desiredSvg = createSvg();
        offscreenSlot.appendChild(desiredSvg);

        const update = buildSwipeRenderUpdate({
            slots: [
                {
                    slotIndex: 0,
                    slotOffset: -1,
                    slotLeft: 0,
                    slotRight: 1000,
                    unitIndex: 1,
                    element: offscreenSlot,
                    attachedSvg: desiredSvg
                },
                {
                    slotIndex: 1,
                    slotOffset: 0,
                    slotLeft: 1000,
                    slotRight: 2000,
                    unitIndex: 1,
                    element: visibleSlot,
                    attachedSvg: null
                }
            ],
            resolveUnit: (index) => [
                { unitId: 'u0', svg: null },
                { unitId: 'u1', svg: desiredSvg }
            ][index],
            visibleLeft: 1000,
            visibleRight: 2000,
            scaledPageWidth: 1000,
            visiblePages: 1,
            addOnly: false,
            translateX: -1000,
            lastTranslateX: 0,
            currentDirection: 'none',
            selectedUnitId: 'u1'
        });

        expect(update.clearSlotIndices).toEqual([0]);
        expect(update.attachedUnitToSlotMap.has(1)).toBeFalse();
        expect(update.slotInstructions).toEqual([
            jasmine.objectContaining({
                slotIndex: 1,
                unitIndex: 1,
                unitId: 'u1',
                decision: jasmine.objectContaining({ action: 'attach', isSelected: true })
            })
        ]);
    });

    it('keeps fixed overlay mode when the dominant single visible slot already has the right svg', () => {
        const slot = document.createElement('div');
        const desiredSvg = createSvg();
        slot.appendChild(desiredSvg);

        const update = buildSwipeRenderUpdate({
            slots: [{
                slotIndex: 0,
                slotOffset: 0,
                slotLeft: 0,
                slotRight: 1000,
                unitIndex: 0,
                element: slot,
                attachedSvg: desiredSvg
            }],
            resolveUnit: () => ({ unitId: 'u0', svg: desiredSvg }),
            visibleLeft: 0,
            visibleRight: 1000,
            scaledPageWidth: 1000,
            visiblePages: 1,
            addOnly: false,
            translateX: 0,
            lastTranslateX: 0,
            currentDirection: 'none',
            selectedUnitId: 'u0'
        });

        expect(update.clearSlotIndices).toEqual([]);
        expect(update.slotInstructions).toEqual([
            jasmine.objectContaining({
                slotIndex: 0,
                unitIndex: 0,
                unitId: 'u0',
                decision: jasmine.objectContaining({ action: 'reuse-existing', overlayMode: 'fixed' })
            })
        ]);
    });
});
