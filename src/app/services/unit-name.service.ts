// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import { OptionsService } from './options.service';
import { formatUnitChassis, formatUnitName, type UnitNameSource } from '../utils/unit-display-name.util';

/** Reactive presentation only: catalog names, keys and native exports stay canonical. */
@Injectable({ providedIn: 'root' })
export class UnitNameService {
    private readonly optionsService = inject(OptionsService);

    chassis(unit: UnitNameSource | null | undefined): string {
        return formatUnitChassis(unit, this.optionsService.options().displayUnitNameFormat);
    }

    name(unit: UnitNameSource | null | undefined): string {
        return formatUnitName(unit, this.optionsService.options().displayUnitNameFormat);
    }

    applyToRecordSheet(svg: SVGSVGElement, unit: UnitNameSource): void {
        const name = this.name(unit);
        svg.querySelectorAll<SVGElement>(
            '[data-mekbay-field="display-name"], #type, #unitName, #unit-name, .compact-infantry-frame > .svg-frame-title',
        ).forEach(element => { element.textContent = name; });
    }
}
