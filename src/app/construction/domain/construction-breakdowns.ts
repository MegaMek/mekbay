// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { MekEntity } from '../../models/entity/entities/mek/mek-entity';
import { calculateMekEquipmentWeightDetails } from '../../models/entity/utils/weight/mek-weight';
import type { BattleValueDetail } from '../../models/entity/utils/battle-value/bv-calculator';
import { calculateEntityWeightBreakdown } from '../../models/entity/utils/weight/entity-weight';
export interface ConstructionBreakdownRow {
    readonly label: string;
    readonly calculation?: string;
    readonly value?: number;
    readonly depth?: number;
}
export interface ConstructionBreakdownData {
    readonly title: string;
    readonly unit: string;
    readonly total: number;
    readonly rows: readonly ConstructionBreakdownRow[];
}


export function constructionBreakdown(entity: BaseEntity, kind: 'bv' | 'weight' | 'cost'): ConstructionBreakdownData {
    if (kind === 'bv') {
        const rows: ConstructionBreakdownRow[] = [];
        const append = (details: readonly BattleValueDetail[], depth: number) => {
            for (const detail of details) {
                rows.push({ label: detail.type, calculation: detail.calculation, value: detail.total ?? detail.delta, depth });
                if (detail.details) append(detail.details, depth + 1);
            }
        };
        append(entity.battleValueDetails(), 0);
        return { title: 'Battle Value breakdown', unit: 'BV', total: entity.battleValue(), rows };
    }
    if (kind === 'cost') {
        const cost = entity.costDetails();
        return { title: 'Construction cost breakdown', unit: 'C-Bills', total: cost.total,
            rows: cost.steps.map(step => ({ label: step.type, value: step.subtotal,
                calculation: step.amount === undefined ? `× ${step.factor}` : `+ ${step.amount.toLocaleString('en-US')}` })) };
    }
    const weight = calculateEntityWeightBreakdown(entity);
    const rows: ConstructionBreakdownRow[] = [];
    const append = (values: object, depth = 0) => {
        for (const [key, value] of Object.entries(values)) {
            if (key === 'rounded' || key === 'exact' || key === 'trooper') continue;
            if (typeof value === 'number') rows.push({ label: key.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()), value, depth });
            else if (Array.isArray(value)) for (const suit of value) {
                rows.push({ label: `Trooper ${suit.trooper + 1}`, value: suit.exact, depth });
                append(suit, depth + 1);
            }
        }
    };
    append(weight);
    rows.push({ label: 'Rounding', value: weight.rounded - weight.exact });
    if (entity instanceof MekEntity) {
        rows.push({ label: 'Equipment subtotal details' });
        for (const { mount, tonnage } of calculateMekEquipmentWeightDetails(entity)) {
            rows.push({ label: `${mount.displayName(true)} · ${mount.location}`, value: tonnage, depth: 1 });
        }
        rows.push({ label: 'Heat sinks', calculation: `${entity.heatSinkCount()} installed; ${entity.mountedEngine().weightFreeHeatSinks} weight-free with engine` });
    }
    return { title: 'Weight breakdown', unit: 't', total: weight.rounded, rows };
}
