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
        const armorZones = [...svg.querySelectorAll<SVGElement>('.unitLocation.armor[data-loc]')]
            .filter(element => element.dataset['loc'] === locationCode);
        const matchingZones = armorZones.filter(element => element.hasAttribute('data-rear') === rear);
        const highlighted = matchingZones.length > 0 ? matchingZones : armorZones;
        highlighted.forEach(element => element.classList.add('random-hit-location-highlight'));

        const result = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        result.setAttribute('class', 'mek-random-hit-result');
        result.setAttribute('role', 'status');
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badge.setAttribute('class', 'mek-random-hit-result-badge');
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        background.setAttribute('class', 'mek-random-hit-result-background');
        background.setAttribute('cx', '11');
        background.setAttribute('cy', '11');
        background.setAttribute('r', '17');
        badge.appendChild(background);
        const locationText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        locationText.setAttribute('class', 'mek-random-hit-result-location');
        locationText.setAttribute('x', '11');
        locationText.setAttribute('y', transferredFrom ? '7' : '11');
        locationText.setAttribute('dy', '.35em');
        locationText.textContent = locationCode;
        badge.appendChild(locationText);
        if (transferredFrom) {
            const transferText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            transferText.setAttribute('class', 'mek-random-hit-result-transferred-from');
            transferText.setAttribute('x', '11');
            transferText.setAttribute('y', '18');
            transferText.textContent = `from ${transferredFrom}`;
            badge.appendChild(transferText);
        }
        const buttonMatrix = button instanceof SVGGraphicsElement ? button.getCTM() : null;
        const svgMatrix = svg.getCTM();
        if (buttonMatrix && svgMatrix) {
            badge.setAttribute('transform', this.rootRelativeTransform(svgMatrix, buttonMatrix));
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
