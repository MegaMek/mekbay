/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { CommonModule } from '@angular/common';
import { Component, Input, Output, EventEmitter, OnInit, signal, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { ForceUnit } from '../../models/force-unit.model';
import { DataService } from '../../services/data.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { BaseDialogComponent } from '../base-dialog/base-dialog.component';

/*
 * Author: Drake
 */
@Component({
    selector: 'print-force-modal',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, BaseDialogComponent],
    templateUrl: './print-force-modal.component.html',
    styleUrls: ['./print-force-modal.component.css']
})
export class PrintForceModalComponent implements OnInit, OnDestroy {
    private forceBuilderService = inject(ForceBuilderService);
    private dataService = inject(DataService);

    @Output() closed = new EventEmitter<void>();

    svgStrings = signal<string[]>([]);
    loading = signal<boolean>(true);

    constructor() {}

    async ngOnInit() {
        this.loading.set(true);
        await new Promise(resolve => setTimeout(resolve, 4000)); // Allow UI to update before loading
        await this.loadAllSvgs(this.dataService, this.forceBuilderService.forceUnits());
        this.loading.set(false);
        document.body.classList.add('print-force-modal-open');
    }

    async ngOnDestroy() {
        this.svgStrings.set([]);
        document.body.classList.remove('print-force-modal-open');
    }

    async loadAllSvgs(dataService: DataService, forceUnits: ForceUnit[]) {
        if (forceUnits.length === 0) {
            return;
        }
        // Gather all SVGs as strings
        const svgStrings: string[] = [];
        for (const unit of forceUnits) {
            let svg = unit.svg();
            if (!svg) {
                svg = await dataService.getSheet(unit.getUnit().sheets[0]);
            }
            svg.querySelectorAll('[style]').forEach(el => {
                const style = el.getAttribute('style');
                if (style && /font-size\s*:\s*\d+(\.\d+)?(\s*;|;|$)/i.test(style)) {
                    // Only add px if there is no unit after the number
                    const fixed = style.replace(
                        /font-size\s*:\s*(\d+(\.\d+)?)(?!\s*[a-zA-Z%])(\s*;?)/gi,
                        (match, num, _, tail) => `font-size: ${num}px${tail || ''}`
                    );
                    if (fixed !== style) {
                        el.setAttribute('style', fixed);
                    }
                }
            });
            const serializer = new XMLSerializer();
            let svgString = serializer.serializeToString(svg);
            svgString = svgString.replace(
                /^<svg([^>]*)>/,
                (match, attrs) => {
                    // Remove width, height, and preserveAspectRatio from the outer <svg>
                    let cleanedAttrs = attrs
                        .replace(/\sclass="[^"]*"/g, '')
                        .replace(/\sstyle="[^"]*"/g, '')
                        .replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, '')
                        .replace(/\s+$/, ''); // Remove trailing whitespace
                    // Ensure viewBox is present
                    if (!/viewBox=/.test(cleanedAttrs)) {
                        cleanedAttrs += ' viewBox="0 0 612 792"';
                    }
                    return `<svg${cleanedAttrs}>`;
                }
            );
            if (svgString) {
                svgStrings.push(svgString);
            }
        }
        // this.svgStrings.set(svgStrings);
    }

    onClose() {
        this.closed.emit();
    }

    onPrint() {
        window.print();
    }
}