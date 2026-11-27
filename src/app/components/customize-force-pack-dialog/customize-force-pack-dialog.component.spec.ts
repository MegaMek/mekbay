// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { output, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { GameSystem } from '../../models/common.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { TaggingService } from '../../services/tagging.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { CustomizeForcePackDialogComponent } from './customize-force-pack-dialog.component';

describe('CustomizeForcePackDialogComponent identity', () => {
    it('detects a same-name custom replacement and opens its exact variant details', async () => {
        const original = createEmptyUnit({ name: 'Custom collision', isCustom: true });
        const replacement = createEmptyUnit({ name: original.name, isCustom: true });
        const createDialog = jasmine.createSpy('createDialog');
        TestBed.configureTestingModule({
            imports: [CustomizeForcePackDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: { pack: { name: 'Pack', units: [{ unit: original }] } } },
                { provide: DialogRef, useValue: {} },
                { provide: DataService, useValue: {} },
                { provide: DialogsService, useValue: { createDialog } },
                { provide: ForceBuilderService, useValue: {} },
                { provide: GameService, useValue: { currentGameSystem: () => GameSystem.CBT } },
                { provide: LayoutService, useValue: {} },
                { provide: OverlayManagerService, useValue: { closeManagedOverlay: () => undefined } },
                { provide: TaggingService, useValue: {} },
            ],
        }).overrideComponent(CustomizeForcePackDialogComponent, { set: { imports: [], template: '' } });
        const selection = TestBed.runInInjectionContext(() => output<UnitSummary>());
        createDialog.and.returnValue({ componentInstance: { select: selection }, close: () => undefined });
        const fixture = TestBed.createComponent(CustomizeForcePackDialogComponent);
        const component = fixture.componentInstance;
        expect(component.hasChanges()).toBeFalse();
        await component['showVariantInfo']({ ...replacement }, [original, replacement], 0);
        expect(createDialog.calls.mostRecent().args[1].data.unitIndex).toBe(1);
        selection.emit(replacement);
        expect(component.hasChanges()).toBeTrue();
        component.customizableUnits.update(units => units.map(unit => ({ ...unit, unit: { ...original, name: 'Renamed' } })));
        expect(component.hasChanges()).toBeFalse();
        fixture.destroy();
    });
});
