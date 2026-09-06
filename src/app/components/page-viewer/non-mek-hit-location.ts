// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../models/entity/base-entity';
import {
    isAeroEntity,
    isProtoMekEntity,
    isVehicleEntity,
} from '../../models/entity/utils/entity-type-guards';
import type { NonMekRecordSheetSnapshot } from '../../models/runtime/non-mek-record-sheet';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';

export type NonMekHitArc = MekHitArc | 'front-left' | 'front-right' | 'rear-left' | 'rear-right';

export interface NonMekHitLocation {
    readonly locationCode: string;
    readonly transferredFrom?: string;
}

const FRONT_BACK_ARCS: readonly NonMekHitArc[] = ['front', 'right', 'rear', 'left'];
const SIX_ARCS: readonly NonMekHitArc[] = ['front', 'front-right', 'rear-right', 'rear', 'rear-left', 'front-left'];

export function nonMekHitArcs(entity: BaseEntity): readonly NonMekHitArc[] {
    return isVehicleEntity(entity) && entity.locationOrder.includes('Front Left')
        ? SIX_ARCS : FRONT_BACK_ARCS;
}

/** Normal attacks, using MegaMek's Tank/VTOL/ProtoMek/Aero/SmallCraft/Jumpship rollHitLocation tables. */
export function resolveNonMekHitLocation(
    entity: BaseEntity,
    snapshot: NonMekRecordSheetSnapshot,
    arc: NonMekHitArc,
    roll: number,
    d6: () => number,
): NonMekHitLocation | null {
    let code: string | null = null;
    if (isVehicleEntity(entity)) {
        const facing = ({ front: 'Front', rear: 'Rear', left: 'Left', right: 'Right',
            'front-left': 'Front Left', 'front-right': 'Front Right',
            'rear-left': 'Rear Left', 'rear-right': 'Rear Right' })[arc];
        const side = arc === 'left' || arc === 'right';
        code = facing;
        if (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL') {
            if ([3, 10, 11, 12].includes(roll)) code = 'Rotor';
            if (roll === 4) code = entity.hasTurret() ? 'Turret' : 'Rotor';
            if (roll === 5) code = side ? 'Front' : 'Right';
            if (roll === 9) code = side ? 'Rear' : 'Left';
        } else {
            if (nonMekHitArcs(entity).length === 6) {
                if (roll === 3) {
                    if (arc === 'front-left' || arc === 'front-right') code = 'Front';
                    else if (arc === 'rear') code = 'Rear Left';
                    else if (arc === 'front') code = 'Front Right';
                }
            } else {
                if (roll === 5) code = side ? 'Front' : 'Left';
                if (roll === 9) code = side ? 'Rear' : arc === 'rear' ? 'Right' : 'Left';
            }
            if (roll >= 10 && entity.hasTurret()) {
                code = entity.hasDualTurret()
                    ? d6() + (arc === 'front' ? -2 : arc === 'rear' ? 2 : 0) <= 3
                        ? 'Front Turret' : 'Rear Turret'
                    : 'Turret';
            }
        }
    } else if (isProtoMekEntity(entity)) {
        if (roll === 3 || roll === 11) return { locationCode: 'MISS' };
        code = ({ 2: 'Main Gun', 4: entity.isQuad() ? 'Legs' : 'Right Arm', 5: 'Legs',
            6: 'Torso', 7: 'Torso', 8: 'Torso', 9: 'Legs',
            10: entity.isQuad() ? 'Legs' : 'Left Arm', 12: 'Head' } as Record<number, string>)[roll];
        const source = snapshot.locations.find(location => location.code === code);
        if (code !== 'Torso' && (!source || source.previewRemainingInternal === 0)) {
            const torso = snapshot.locations.find(location => location.code === 'Torso');
            return torso ? { locationCode: torso.sheetCode, transferredFrom: source?.sheetCode
                ?? entity.componentLocationLabel(code) } : null;
        }
    } else if (isAeroEntity(entity)) {
        const capital = ['JumpShip', 'WarShip', 'SpaceStation'].includes(entity.entityType);
        const smallCraft = entity.entityType === 'SmallCraft' || entity.entityType === 'DropShip';
        const left = capital ? 'FLS' : smallCraft ? 'Left Side' : 'Left Wing';
        const right = capital ? 'FRS' : smallCraft ? 'Right Side' : 'Right Wing';
        if (arc === 'front' || arc === 'rear') {
            code = roll === 4 || roll === 5 ? capital && arc === 'rear' ? 'ARS' : right
                : roll === 9 || roll === 10 ? capital && arc === 'rear' ? 'ALS' : left
                    : arc === 'front' ? 'Nose' : 'Aft';
        } else if (arc === 'left' || arc === 'right') {
            const wing = arc === 'left' ? left : right;
            if (capital) {
                code = roll === 2 ? 'Nose' : roll <= 6 ? wing
                    : roll <= 10 ? arc === 'left' ? 'ALS' : 'ARS' : 'Aft';
            } else if (smallCraft) {
                code = roll <= 4 ? 'Nose' : roll <= 9 ? wing : 'Aft';
            } else {
                code = [2, 4, 5].includes(roll) ? 'Nose' : [9, 10, 12].includes(roll) ? 'Aft' : wing;
            }
        }
    }
    const location = snapshot.locations.find(candidate => candidate.code === code);
    return location?.sheetCode ? { locationCode: location.sheetCode } : null;
}
