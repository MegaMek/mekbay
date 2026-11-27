// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBipedMekEntity as BipedMekEntity } from '../models/entity/testing/test-entities';
import type { ForceMember } from '../models/force-member.model';
import { recordSheetPageProfile } from './sheets/record-sheet-layout';
import { printUnitTiles } from './unit-tiles-print.util';

const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=';

describe('unit tile printing', () => {
    afterEach(() => window.dispatchEvent(new Event('afterprint')));

    for (const paperSize of ['letter', 'a4'] as const) {
        it(`prints every instance in strips with 0.5 mm gaps across ${paperSize} pages`, async () => {
            const members = Array.from({ length: 81 }, (_, i) => asMember(`unit-${i}`));
            const print = spyOn(window, 'print').and.stub();
            await printUnitTiles(members, sprites(), { paperSize, printMargin: 'browserDefined' });

            const overlay = document.getElementById('record-sheet-print-container')!;
            const pages = [...overlay.querySelectorAll<SVGSVGElement>('.record-sheet-print-page > svg')];
            const tiles = [...overlay.querySelectorAll<SVGGElement>('.unit-tile')];
            expect(print).toHaveBeenCalledOnceWith();
            expect(pages.map(page => page.querySelectorAll('.unit-tile').length))
                .toEqual([40, 40, 1]);
            expect(tiles.map(tile => tile.getAttribute('data-unit-id'))).toEqual(members.map(member => member.id));
            expect(pages.every(page => page.parentElement!.classList.contains('record-sheet-template-page'))).toBeTrue();

            const profile = recordSheetPageProfile(paperSize);
            for (const page of pages) {
                expect(page.style.width).toBe(`${profile.width}pt`);
                expect(page.style.height).toBe(`${profile.height}pt`);
                for (const strip of page.querySelectorAll<SVGGElement>('.unit-tile-strip')) {
                    const position = strip.transform.baseVal.getItem(0).matrix;
                    const stripTiles = [...strip.querySelectorAll<SVGGElement>('.unit-tile')];
                    expect(position.e).toBeGreaterThanOrEqual(profile.margin);
                    expect(position.f).toBeGreaterThanOrEqual(profile.margin);
                    const lastTileY = stripTiles.at(-1)!.transform.baseVal.getItem(0).matrix.f;
                    expect(position.f + lastTileY + 45).toBeLessThanOrEqual(profile.height - profile.margin);
                    expect(position.e + 180 / Math.sqrt(3))
                        .toBeLessThanOrEqual(profile.width - profile.margin);
                    for (let i = 1; i < stripTiles.length; i++) {
                        const previous = stripTiles[i - 1], current = stripTiles[i];
                        const a = previous.transform.baseVal.getItem(0).matrix;
                        const b = current.transform.baseVal.getItem(0).matrix;
                        // The facing flat sides remain aligned, with 0.5 mm between their cut lines.
                        for (const [bottom, top] of [[1, 5], [2, 4]]) {
                            const p = previous.querySelector('polygon')!.points.getItem(bottom);
                            const q = current.querySelector('polygon')!.points.getItem(top);
                            expect(a.e + p.x).toBeCloseTo(b.e + q.x, 5);
                            const gapMm = (b.f + q.y - a.f - p.y) * 25.4 / 72;
                            expect(gapMm).toBeCloseTo(0.5, 4);
                        }
                    }
                }
            }
            for (const tile of tiles) {
                const points = tile.querySelector('polygon')!.points;
                const ys = Array.from({ length: points.numberOfItems }, (_, i) => points.getItem(i).y);
                expect(Math.max(...ys) - Math.min(...ys)).toBe(90);
                expect([...tile.querySelectorAll('text')].every(text => Number(text.getAttribute('y')) > 0)).toBeTrue();
                expect(tile.querySelector('image')!.getAttribute('href')).toBe(ICON);
            }
        });
    }

    for (const nameFormat of ['innerSphereClan', 'clanInnerSphere'] as const) {
        it(`uses ${nameFormat} names from native entities and AS summaries, with labels below the icon`, async () => {
            const entity = new BipedMekEntity();
            entity.chassis.set('Mad Cat');
            entity.clanName.set('Timber Wolf');
            entity.model.set('Prime');
            entity.iconPath.set('meks/TimberWolf.png');
            const members = [{ kind: 'cbt', id: 'cbt', entity } as unknown as ForceMember, asMember('as')];
            const spriteService = sprites();
            await printUnitTiles(members, spriteService, { paperSize: 'letter', printMargin: 'none' }, nameFormat, false);

            const tiles = [...document.querySelectorAll('.unit-tile')];
            const expectedChassis = nameFormat === 'innerSphereClan' ? 'Mad Cat (Timber Wolf)' : 'Timber Wolf (Mad Cat)';
            for (const tile of tiles) {
                const texts = [...tile.querySelectorAll('text')];
                expect(texts[0].textContent).toBe('Prime');
                expect(texts.slice(1).map(text => text.textContent).join(' ')).toBe(expectedChassis);
                expect(texts.every(text => Number(text.getAttribute('y')) > 19)).toBeTrue();
            }
            expect(spriteService.getVerifiedAssignmentContext).toHaveBeenCalledTimes(1);
            expect(spriteService.getExtractedIconUrl.calls.allArgs()).toEqual([
                ['meks/TimberWolf.png'], ['meks/MadCat.png'],
            ]);
        });
    }

    it('keeps a tile for units with missing artwork and treats names as text', async () => {
        const member = asMember('missing', '<img src=x onerror=alert(1)>', '');
        await printUnitTiles([member], sprites(), { paperSize: 'letter', printMargin: 'none' }, 'innerSphereClan', false);
        const tile = document.querySelector('.unit-tile')!;
        expect(tile.querySelector('img')).toBeNull();
        expect(tile.querySelector('image')!.getAttribute('href')).toBe('/images/unknown.png');
        expect([...tile.querySelectorAll('text')].map(text => text.textContent).join(' '))
            .toContain('<img src=x onerror=alert(1)>');
    });

    it('does not open a print job for an empty force', async () => {
        const print = spyOn(window, 'print').and.stub();
        const spriteService = sprites();
        await printUnitTiles([], spriteService, { paperSize: 'letter', printMargin: 'none' });
        expect(print).not.toHaveBeenCalled();
        expect(spriteService.getVerifiedAssignmentContext).not.toHaveBeenCalled();
        expect(document.getElementById('record-sheet-print-container')).toBeNull();
    });
});

function sprites() {
    return {
        getVerifiedAssignmentContext: jasmine.createSpy('getVerifiedAssignmentContext').and.resolveTo(null),
        getExtractedIconUrl: jasmine.createSpy('getExtractedIconUrl').and.resolveTo(ICON),
    };
}

function asMember(id: string, chassis = 'Mad Cat', icon = 'meks/MadCat.png'): ForceMember {
    return { id, getSummary: () => ({ chassis, clanName: 'Timber Wolf', model: 'Prime', icon }) } as ForceMember;
}
