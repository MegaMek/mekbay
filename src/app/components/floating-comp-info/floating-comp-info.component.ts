// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Component, input, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

import type { UnitComponent } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service';
import type { UnitSummary } from '../../models/unit-summary.model';
import { type Equipment, formatEquipmentRulesRefs, WeaponEquipment } from '../../models/equipment.model';
import { equipmentHeat, equipmentTechnologyGroups, equipmentToHitModifier, equipmentTypeLabel, type EquipmentInfoGroup } from './equipment-info';
import { getWeaponTypeCSSClass } from '../../utils/equipment.util';
import { OptionsService } from '../../services/options.service';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../models/rules/game-rules';


@Component({
    selector: 'floating-comp-info',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './floating-comp-info.component.html',
    styleUrls: ['./floating-comp-info.component.css', './equipment-info.css'],
    host: { '[class.modal]': '!!dialogRef' },
})
export class FloatingCompInfoComponent {
    private dataService = inject(DataService);
    private optionsService = inject(OptionsService);
    readonly dialogRef = inject<DialogRef<void>>(DialogRef, { optional: true });
    unit = input.required<UnitSummary>();
    comp = input<UnitComponent | null>(null);

    positioned = false;

    equipment = computed<Equipment | null>(() => {
        const currentComp = this.comp();
        const currentUnit = this.unit();
        if (currentUnit && currentComp?.id && currentUnit?.type) {
            return this.dataService.findEquipment(currentComp.id) || null;
        }
        return null;
    });

    equipmentDisplay = computed(() => this.computeEquipmentDisplay());

    get name(): string {
        return this.equipment()?.name ?? this.comp()?.n ?? '';
    }

    get typeClass(): string {
        const currentComp = this.comp();
        return getWeaponTypeCSSClass(currentComp?.t ?? '', this.equipment() ?? currentComp?.eq);
    }

    get typeLabel(): string {
        const currentComp = this.comp();
        return equipmentTypeLabel(this.typeClass, this.equipment() ?? currentComp?.eq);
    }

    get toHitModifier(): string | null {
        const equipment = this.equipment() ?? this.comp()?.eq;
        if (!equipment) return null;

        const rules = this.optionsService.options().CBTRules === 'total-warfare'
            ? TW_GAME_RULES
            : CORE_2026_GAME_RULES;
        return equipmentToHitModifier(equipment, rules);
    }

    get rackSize(): number | null {
        if (this.equipment() instanceof WeaponEquipment) {
            return (this.equipment() as WeaponEquipment).rackSize;
        }
        return null;
    }

    get range(): string | null {
        if (this.comp()?.r) {
            const eq = this.equipment();
            if (eq instanceof WeaponEquipment) {
                const ranges = eq.ranges; 
                // Ranges has 4 entries: 0: short, 1: medium, 2: long, 3: extreme
                return `${ranges[0]}/${ranges[1]}/${ranges[2]}`;
            }
        }
        return null;
    }

    get minRange(): number {
        const eq = this.equipment();
        if (eq instanceof WeaponEquipment) {
            return eq.minRange;
        }
        return 0;
    }

    get damage(): string | null {
        const currentComp = this.comp();
        const eq = this.equipment();
        if (currentComp?.d && eq instanceof WeaponEquipment) {
            return currentComp.md && Number(currentComp.md) !== Number(currentComp.d)
                ? `${currentComp.d} (${currentComp.md})`
                : currentComp.d;
        }
        return null;
    }

    get heat(): string | null {
        return equipmentHeat(this.equipment());
    }

    get hasHeat(): boolean {
        const eq = this.equipment();
        return eq instanceof WeaponEquipment && eq.heat > 0;
    }

    computeEquipmentDisplay(): EquipmentInfoGroup[] {
        const unit = this.unit();
        if (!unit) return [];
        const eq = this.equipment();
        if (!eq) return [];

        return [
            {
                group: 'General',
                items: [
                    { label: 'BV', value: eq.bv },
                    { label: 'Cost', value: eq.cost },
                    { label: 'Tonnage', value: eq.tonnage },
                    { label: 'Criticals', value: eq.critSlots },
                    { label: 'Reference', value: formatEquipmentRulesRefs(eq.rulesRefs) }
                ]
            },
            ...equipmentTechnologyGroups(eq, unit.techBase === 'Clan' ? 'Clan' : 'IS', unit.mixed),
        ];
    }
}
