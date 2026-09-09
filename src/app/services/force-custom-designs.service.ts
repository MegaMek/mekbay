// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, Injector, inject } from '@angular/core';
import type { CBTForce } from '../models/cbt-force.model';
import { pinnedCustomSourceForHandle, type NativeUnitSourceHandle } from '../models/native-unit-source-handle';
import { CustomDesignCapacityError, planEmbeddedDesigns, type EmbeddedCustomDesign } from '../models/custom-design-policy';
import type { UnitUuid } from './unit-catalog/unit-catalog.types';
import { DialogsService } from './dialogs.service';

@Injectable({ providedIn: 'root' })
export class ForceCustomDesignsService {
    private readonly injector = inject(Injector);

    /** Check the complete proposed force before adding, cloning, transferring, or refitting a unit. */
    async check(force: CBTForce, addition?: EmbeddedCustomDesign, replacedId?: string): Promise<boolean> {
        const sources = force.getRuntimeInstanceIds().flatMap(id => {
            if (id === replacedId) return addition ? [addition] : [];
            const snapshot = force.getUnitSnapshot(id);
            const source = pinnedCustomSourceForHandle(snapshot?.nativeSource);
            return source && snapshot ? [{ uuid: snapshot.uuid, source }] : [];
        });
        if (addition && !replacedId) sources.push(addition);
        try { planEmbeddedDesigns(sources); return true; }
        catch (error) {
            if (!(error instanceof CustomDesignCapacityError)) throw error;
            await this.injector.get(DialogsService).showNotice(error.message, 'Custom design limit');
            return false;
        }
    }

    checkNative(force: CBTForce, uuid: UnitUuid, native: NativeUnitSourceHandle | undefined, replacedId?: string): Promise<boolean> {
        const source = pinnedCustomSourceForHandle(native);
        return this.check(force, source ? { uuid, source } : undefined, replacedId);
    }
}
