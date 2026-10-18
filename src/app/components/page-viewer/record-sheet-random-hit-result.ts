// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

const RANDOM_HIT_RESULT_DURATION_MS = 4000;

/** Shared paperdoll hit highlight and badge, scoped to one displayed unit. */
export class RecordSheetRandomHitResult {
    private randomHitResult: Readonly<{ unitId: string; svg: SVGSVGElement; timeout: number }> | null = null;

    get unitId(): string | undefined { return this.randomHitResult?.unitId; }

    show(
        unitId: string,
        svg: SVGSVGElement,
        button: SVGElement,
        locationCode: string,
        rear: boolean,
        throughArmorCritical: boolean,
        transferredFrom?: string,
    ): void {
        this.clear();
        // The hit location's contours on the armor paperdolls: its armor and, where that diagram draws them inside
        // the location (vehicles, ProtoMeks), its internal structure bands. A separate structure diagram stays unmarked.
        const zones = [...svg.querySelectorAll<SVGElement>(
            '[data-mekbay-paperdoll][data-type="armor"] .unitLocation:is(.armor, .structure)[data-loc]',
        )].filter(element => element.dataset['loc'] === locationCode);
        const matchingZones = zones.filter(element => element.hasAttribute('data-rear') === rear);
        const highlighted = matchingZones.length > 0 ? matchingZones : zones;
        highlighted.forEach(element => element.classList.add('random-hit-location-highlight'));

        const result = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        result.setAttribute('class', 'mek-random-hit-result');
        result.setAttribute('role', 'status');
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badge.setAttribute('class', 'mek-random-hit-result-badge');
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        background.setAttribute('class', 'mek-random-hit-result-background');
        background.setAttribute('r', '17');
        badge.appendChild(background);
        const locationText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        locationText.setAttribute('class', 'mek-random-hit-result-location');
        locationText.setAttribute('y', transferredFrom ? '-4' : '0');
        locationText.setAttribute('dy', '.35em');
        locationText.textContent = locationCode;
        badge.appendChild(locationText);
        if (transferredFrom) {
            const transferText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            transferText.setAttribute('class', 'mek-random-hit-result-transferred-from');
            transferText.setAttribute('y', '7');
            transferText.textContent = `from ${transferredFrom}`;
            badge.appendChild(transferText);
        }
        const buttonMatrix = button instanceof SVGGraphicsElement ? button.getCTM() : null;
        const svgMatrix = svg.getCTM();
        if (buttonMatrix && svgMatrix) {
            // The badge replaces the button in place, so it is centred on the button's own geometry.
            const bounds = (button as SVGGraphicsElement).getBBox();
            const center = buttonMatrix.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            badge.setAttribute('transform', this.rootRelativeTransform(svgMatrix, center));
        }
        result.appendChild(badge);
        const armorLayer = svg.querySelector<SVGGraphicsElement>('[data-mekbay-paperdoll-view="front"]')
            ?? svg.querySelector<SVGGraphicsElement>('[data-mekbay-paperdoll][data-type="armor"]');
        if (throughArmorCritical && armorLayer) {
            const criticalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            criticalText.setAttribute('class', 'mek-random-hit-result-through-armor');
            const artX = Number(armorLayer.dataset['artX']);
            const artY = Number(armorLayer.dataset['artY']);
            const artWidth = Number(armorLayer.dataset['artWidth']);
            const artHeight = Number(armorLayer.dataset['artHeight']);
            criticalText.setAttribute('x', String(artX + artWidth / 2));
            criticalText.setAttribute('y', String(artY + artHeight * 2 / 5));
            criticalText.setAttribute('text-anchor', 'middle');
            criticalText.setAttribute('dominant-baseline', 'central');
            const armorMatrix = armorLayer.getCTM();
            if (armorMatrix && svgMatrix) {
                criticalText.setAttribute('transform', this.rootRelativeTransform(svgMatrix, armorMatrix));
            }
            criticalText.setAttribute('role', 'button');
            criticalText.setAttribute('tabindex', '0');
            criticalText.textContent = 'THROUGH ARMOR';
            const dismissResult = (event: Event): void => {
                event.preventDefault();
                event.stopPropagation();
                this.clear();
            };
            criticalText.addEventListener('pointerdown', dismissResult, { passive: false });
            criticalText.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') dismissResult(event);
            });
            result.appendChild(criticalText);
        }
        svg.appendChild(result);
        const timeout = window.setTimeout(() => this.clear(), RANDOM_HIT_RESULT_DURATION_MS);
        this.randomHitResult = Object.freeze({ unitId, svg, timeout });
    }

    private rootRelativeTransform(svgMatrix: DOMMatrix, elementMatrix: DOMMatrix): string {
        const matrix = svgMatrix.inverse().multiply(elementMatrix);
        return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
    }

    clear(): void {
        if (!this.randomHitResult) return;
        window.clearTimeout(this.randomHitResult.timeout);
        this.randomHitResult.svg.querySelectorAll('.random-hit-location-highlight')
            .forEach(element => element.classList.remove('random-hit-location-highlight'));
        this.randomHitResult.svg.querySelector('.mek-random-hit-result')?.remove();
        this.randomHitResult = null;
    }

}
