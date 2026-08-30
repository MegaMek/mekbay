// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { createEmptyUnit } from '../../../testing/unit-test-helpers';
import { LoggerService } from '../../../services/logger.service';
import { OptionsService } from '../../../services/options.service';
import { NativeEntityService } from '../../../services/native-entity.service';
import { TestTankEntity } from '../../../models/entity/testing/test-entities';
import { SvgViewerLiteComponent } from '../../svg-viewer-lite/svg-viewer-lite.component';
import { UnitDetailsSheetTabComponent } from './unit-details-sheet-tab.component';

describe('UnitDetailsSheetTabComponent', () => {
    let logger: jasmine.SpyObj<Pick<LoggerService, 'error'>>;
    let nativeEntities: jasmine.SpyObj<Pick<NativeEntityService, 'canLoad' | 'load'>>;
    const options = signal({ printAllOptions: { recordSheetCenterPanelContent: 'clusterTable' } });

    beforeEach(() => {
        logger = jasmine.createSpyObj<Pick<LoggerService, 'error'>>('LoggerService', ['error']);
        nativeEntities = jasmine.createSpyObj<Pick<NativeEntityService, 'canLoad' | 'load'>>(
            'NativeEntityService', ['canLoad', 'load'],
        );
        nativeEntities.canLoad.and.returnValue(true);
        nativeEntities.load.and.resolveTo({ entity: new TestTankEntity(), source: {} } as never);
        options.set({ printAllOptions: { recordSheetCenterPanelContent: 'clusterTable' } });

        TestBed.configureTestingModule({
            imports: [UnitDetailsSheetTabComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: LoggerService, useValue: logger },
                { provide: NativeEntityService, useValue: nativeEntities },
                { provide: OptionsService, useValue: { options } },
            ],
        });
    });

    async function settle(): Promise<void> {
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
        }
    }

    async function createComponent() {
        const fixture = TestBed.createComponent(UnitDetailsSheetTabComponent);
        fixture.componentRef.setInput('unit', createEmptyUnit());
        fixture.detectChanges();
        await settle();
        fixture.detectChanges();
        return fixture;
    }

    it('does not render controls inside the svg viewer', async () => {
        const fixture = await createComponent();
        const element = fixture.nativeElement as HTMLElement;
        const viewer = element.querySelector('svg-viewer-lite');

        expect(viewer).not.toBeNull();
        expect(viewer?.querySelector('.sheet-controls')).toBeNull();
        expect(viewer?.querySelector('.svgl-controls')).toBeNull();
    });

    it('proxies controls actions to the viewer instance', async () => {
        const fixture = await createComponent();
        const component = fixture.componentInstance;
        const viewer = fixture.debugElement.query(By.directive(SvgViewerLiteComponent)).componentInstance as SvgViewerLiteComponent;
        const setZoom = spyOn(viewer, 'setZoomPercent').and.stub();
        const resetZoom = spyOn(viewer, 'resetZoom').and.stub();
        const downloadPng = spyOn(viewer, 'downloadPng').and.resolveTo();

        component.setZoomPercent(150);
        component.resetZoom();
        component.downloadPng();

        expect(setZoom).toHaveBeenCalledWith(150);
        expect(resetZoom).toHaveBeenCalled();
        expect(downloadPng).toHaveBeenCalled();
    });

    it('exposes the live viewer zoom-pan state', async () => {
        const fixture = await createComponent();
        const component = fixture.componentInstance;
        const viewer = fixture.debugElement.query(By.directive(SvgViewerLiteComponent)).componentInstance as SvgViewerLiteComponent;
        spyOn(viewer, 'isZoomPanActive').and.returnValue(false);

        expect(component.isZoomPanActive()).toBeFalse();

        (viewer.isZoomPanActive as jasmine.Spy).and.returnValue(true);
        expect(component.isZoomPanActive()).toBeTrue();
    });
});
