// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { diagonalPickerGeometry, LinearPickerVerticalComponent, type DiagonalPickerGeometry } from './linear-picker-vertical.component';

describe('LinearPickerVerticalComponent diagonal layout', () => {
    it('lays out number lists diagonally and keeps word lists vertical', () => {
        const picker = TestBed.createComponent(LinearPickerVerticalComponent);
        picker.componentRef.setInput('layout', 'diagonal');
        picker.componentInstance.values.set(['0', '10', '-500', '...'].map(label => ({ label, value: label })));
        expect(picker.componentInstance.diagonal()).toBeTrue();
        picker.componentInstance.values.set(['Front', 'Front Right', 'Rear'].map(label => ({ label, value: label })));
        expect(picker.componentInstance.diagonal()).toBeFalse();
    });
});

describe('diagonalPickerGeometry', () => {
    const viewport = { width: 400, height: 700 };
    const label = { width: 14, height: 12 };
    const title = { width: 120, height: 18 };

    /** Where the strip's centre line starts and ends. */
    function ends(anchor: { x: number; y: number }, geometry: DiagonalPickerGeometry, cells: number) {
        const at = (along: number) => ({
            x: anchor.x + along * Math.cos(geometry.angle),
            y: anchor.y + along * Math.sin(geometry.angle),
        });
        return [at(geometry.start), at(geometry.start + cells * geometry.cellLength)];
    }

    function expectOnScreen(point: { x: number; y: number }, inset: number): void {
        expect(point.x).toBeGreaterThanOrEqual(inset - 1e-9);
        expect(point.x).toBeLessThanOrEqual(viewport.width - inset + 1e-9);
        expect(point.y).toBeGreaterThanOrEqual(inset - 1e-9);
        expect(point.y).toBeLessThanOrEqual(viewport.height - inset + 1e-9);
    }

    it('aims at the farthest corner with the selected value on the anchor', () => {
        const anchor = { x: 300, y: 600 };
        const geometry = diagonalPickerGeometry(anchor, viewport, label, 11, 3, 22, null);
        expect(geometry.angle).toBeCloseTo(Math.atan2(-600, -300));
        expect(geometry.start).toBeCloseTo(-3.5 * geometry.cellLength);
    });

    it('slides along its line to keep every value on screen', () => {
        for (const anchor of [{ x: 20, y: 20 }, { x: 390, y: 690 }, { x: 200, y: 680 }]) {
            for (const selected of [-1, 0, 10, 20]) {
                const geometry = diagonalPickerGeometry(anchor, viewport, label, 21, selected, 22, null);
                for (const end of ends(anchor, geometry, 21)) expectOnScreen(end, geometry.thickness / 2);
            }
        }
    });

    it('keeps the start on screen when the list is longer than the screen', () => {
        const anchor = { x: 100, y: 100 };
        const geometry = diagonalPickerGeometry(anchor, viewport, label, 200, 100, 22, null);
        const [start, end] = ends(anchor, geometry, 200);
        expectOnScreen(start, geometry.thickness / 2);
        expect(end.y).toBeGreaterThan(viewport.height);
    });

    it('puts the title on screen beside the list, clear of it', () => {
        const anchor = { x: 40, y: 60 };
        const geometry = diagonalPickerGeometry(anchor, viewport, label, 21, 10, 22, title);
        const centre = geometry.title!;
        expect(centre.x - title.width / 2).toBeGreaterThanOrEqual(0);
        expect(centre.x + title.width / 2).toBeLessThanOrEqual(viewport.width);
        expect(centre.y - title.height / 2).toBeGreaterThanOrEqual(0);
        // The title's nearest corner lies outside the strip's half thickness from its centre line.
        const [start] = ends(anchor, geometry, 21);
        const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
        const distance = (centre.x - start.x) * normal.x + (centre.y - start.y) * normal.y;
        const halfExtent = (title.width * Math.abs(normal.x) + title.height * Math.abs(normal.y)) / 2;
        expect(Math.abs(distance) - halfExtent).toBeGreaterThan(geometry.thickness / 2);
    });
});
