// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';

import type { AimedShotChoice, AimedShotChoices } from '../../models/runtime/aimed-shot-choices';
import { PaperdollGenerator } from '../../utils/sheets/paperdoll-generator';

export interface AimedShotDialogData {
    readonly weapon: string;
    readonly target: string;
    /** The side of the target the attack strikes. */
    readonly direction: string;
    /** The target's armor diagram. */
    readonly assetUrl: string;
    /** A 'Mech's rear armor diagram, shown beside the front one while the attack strikes its rear. */
    readonly rearAssetUrl?: string;
    readonly choices: AimedShotChoices;
}

const WIDTH = 320;
const HEIGHT = 380;
const REAR_WIDTH = 200;
const REAR_HEIGHT = 170;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * The target's paperdoll: each location shows what is left of it and the target number of an aimed shot there, lit
 * where the weapon may aim and dimmed where it may not. An attack from behind strikes a 'Mech's torsos on their rear
 * armor, so the rear diagram stands beside the front one and takes them. Closes with the location picked, null for a
 * normal attack, or nothing when dismissed.
 */
@Component({
    selector: 'aimed-shot-dialog',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './aimed-shot-dialog.component.html',
    styleUrl: './aimed-shot-dialog.component.scss',
})
export class AimedShotDialogComponent {
    private readonly dialogRef = inject<DialogRef<string | null>>(DialogRef);
    protected readonly data = inject<AimedShotDialogData>(DIALOG_DATA);
    protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
    protected readonly rearViewBox = `0 0 ${REAR_WIDTH} ${REAR_HEIGHT}`;
    /** Locations struck on their rear armor go to the rear diagram. */
    protected readonly rear = this.data.rearAssetUrl !== undefined
        && this.data.choices.locations.some(choice => choice.rearFace);
    private readonly doll = viewChild.required<ElementRef<SVGSVGElement>>('doll');
    private readonly rearDoll = viewChild<ElementRef<SVGSVGElement>>('rearDoll');

    constructor() {
        afterNextRender(() => {
            void this.draw(this.doll().nativeElement, this.data.assetUrl, WIDTH, HEIGHT, false);
            const rear = this.rearDoll()?.nativeElement;
            if (rear) void this.draw(rear, this.data.rearAssetUrl!, REAR_WIDTH, REAR_HEIGHT, true);
        });
    }

    /** A target number as the doll shows it: `11+`; other texts (`M?`) as they are. */
    protected rollText(targetNumber: string): string {
        return /^-?\d+$/u.test(targetNumber) ? `${targetNumber}+` : targetNumber;
    }

    protected choose(location: string | null): void {
        this.dialogRef.close(location);
    }

    protected dismiss(): void {
        this.dialogRef.close();
    }

    private async draw(
        svg: SVGSVGElement,
        assetUrl: string,
        width: number,
        height: number,
        rearDoll: boolean,
    ): Promise<void> {
        const art = await PaperdollGenerator.createPaperdoll(assetUrl, width, height, {}, {
            centeredHorizontally: true, centeredVertically: true, pipOptions: { inset: 8 },
        });
        // The sheet's random-hit die has no use here.
        art.querySelectorAll('.mek-random-hit-button').forEach(button => button.remove());
        svg.appendChild(art);
        const regions = new Map<string, SVGGraphicsElement[]>();
        for (const region of art.querySelectorAll<SVGGraphicsElement>('.unitLocation.armor[data-loc]')) {
            const code = region.getAttribute('data-loc')!;
            regions.set(code, [...regions.get(code) ?? [], region]);
        }
        const choices = new Map(this.data.choices.locations.map(choice => [choice.code, choice]));
        const toSvg = svg.getScreenCTM()?.inverse();
        for (const [code, elements] of regions) {
            const choice = choices.get(code);
            // With the rear diagram shown, each location is taken by the diagram of the armor the shot strikes.
            const taken = choice !== undefined && (!this.rear || choice.rearFace === rearDoll);
            const aimable = taken && choice.targetNumber !== null;
            for (const element of elements) {
                element.classList.add('aim-region');
                element.classList.toggle('aimable', aimable);
                element.classList.toggle('aimed', aimable && code === this.data.choices.current);
                if (aimable) element.addEventListener('click', () => this.choose(code));
            }
            if (!choice) continue;
            if (aimable) this.makeButton(elements[0], choice);
            if (toSvg) this.label(svg, elements, toSvg, choice, taken);
        }
    }

    private makeButton(region: SVGGraphicsElement, choice: AimedShotChoice): void {
        region.setAttribute('tabindex', '0');
        region.setAttribute('role', 'button');
        region.setAttribute('aria-label', [
            choice.rearFace ? `${choice.label} (rear)` : choice.label,
            ...(choice.remaining === null ? [] : [`armor ${choice.remaining}`]),
            this.rollText(choice.targetNumber!),
        ].join(', '));
        region.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            this.choose(choice.code);
        });
    }

    /**
     * What is left of the location, and under it the target number, centred on the location's art. A location the
     * other diagram takes keeps only its own armor, dimmed.
     */
    private label(
        svg: SVGSVGElement,
        regions: readonly SVGGraphicsElement[],
        toSvg: DOMMatrix,
        choice: AimedShotChoice,
        taken: boolean,
    ): void {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const region of regions) {
            const box = region.getBBox();
            const matrix = toSvg.multiply(region.getScreenCTM() ?? new DOMMatrix());
            for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height],
                [box.x + box.width, box.y + box.height]]) {
                const point = new DOMPoint(x, y).matrixTransform(matrix);
                left = Math.min(left, point.x);
                right = Math.max(right, point.x);
                top = Math.min(top, point.y);
                bottom = Math.max(bottom, point.y);
            }
        }
        if (!Number.isFinite(left)) return;
        const aimable = taken && choice.targetNumber !== null;
        const remaining = taken ? choice.remaining : choice.frontRemaining;
        const lines = [
            ...(remaining === null ? [] : [{
                text: remaining,
                className: `aim-label${aimable ? '' : ' unavailable'}${remaining.startsWith('(') ? ' exposed' : ''}`,
            }]),
            ...(!taken ? [] : [choice.targetNumber === null
                ? { text: '—', className: 'aim-label unavailable' }
                : {
                    text: this.rollText(choice.targetNumber),
                    className: `aim-label target-number${Number(choice.targetNumber) > 12 ? ' unavailable' : ''}`,
                }]),
        ];
        const size = Math.max(9, Math.min(15, (right - left) * 0.42));
        const centre = (top + bottom) / 2 - (lines.length - 1) * size * 0.55;
        lines.forEach((line, index) => {
            const text = document.createElementNS(SVG_NAMESPACE, 'text');
            text.setAttribute('class', line.className);
            text.setAttribute('x', String((left + right) / 2));
            text.setAttribute('y', String(centre + index * size * 1.1 + size * 0.35));
            text.setAttribute('font-size', String(size));
            text.textContent = line.text;
            svg.appendChild(text);
        });
    }
}
