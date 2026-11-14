// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Dialog, DialogRef } from '@angular/cdk/dialog';
import type { EquipmentRegistry } from '../models/equipment-lookup';
import { caseEquipmentKind } from '../models/case-equipment.model';
import { parseEntity } from '../models/entity/parse-entity';
import { EquipmentCatalogService } from '../services/catalogs/equipment-catalog.service';
import { buildEquipmentRegistry } from '../services/catalogs/equipment-catalog-builder';
import { CustomUnitsService } from '../services/custom-units.service';
import { DataService } from '../services/data.service';
import { DialogsService } from '../services/dialogs.service';
import { LayoutService } from '../services/layout.service';
import { NativeEntityService } from '../services/native-entity.service';
import { ToastService } from '../services/toast.service';
import { UnitNameService } from '../services/unit-name.service';
import { formatUnitChassis, formatUnitName } from '../utils/unit-display-name.util';
import { UnitSearchIndexService } from '../services/unit-search-index.service';
import { ConstructionForceService } from './construction-force.service';
import { UnitConstructionComponent } from './unit-construction.component';

describe('construction editor CASE choices', () => {
  let registry: EquipmentRegistry;
  let fixture: ComponentFixture<UnitConstructionComponent>;
  let editor: UnitConstructionComponent;

  beforeAll(async () => {
    registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json());
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
        { provide: DialogRef, useValue: { close: () => {} } },
        { provide: Dialog, useValue: { openDialogs: [] } },
        { provide: LayoutService, useValue: { windowWidth: signal(1440), windowHeight: signal(900) } },
        { provide: EquipmentCatalogService, useValue: { getEquipmentRegistry: () => registry } },
        {
          provide: CustomUnitsService,
          useValue: {
            summaries: signal([]),
            parseDraft: (source: string, format: string) => parseEntity(source, `draft.${format}`, registry).entity,
          },
        },
        { provide: DataService, useValue: { getUnitByUuid: () => undefined, searchCorpusVersion: signal(0) } },
        { provide: DialogsService, useValue: {} },
        { provide: NativeEntityService, useValue: {} },
        { provide: UnitNameService, useValue: { chassis: formatUnitChassis, name: formatUnitName } },
        { provide: UnitSearchIndexService, useValue: new UnitSearchIndexService() },
        { provide: ConstructionForceService, useValue: { damage: () => null } },
      ],
    });
    fixture = TestBed.createComponent(UnitConstructionComponent);
    editor = fixture.componentInstance;
    editor.panel.set('loadout');
  });

  const protection = () =>
    editor
      .entity()
      .getEquipmentAtLocation('RT')
      .filter((mount) => caseEquipmentKind(mount.equipment));
  const field = (id: string) => editor.fields().find((candidate) => candidate.id === id)!;
  const caseChoice = () => editor.locationCase().get('RT')!;

  /** A 3151 design with an explosive Gauss Rifle in the right torso; the editor's choices need no rendering. */
  function prepare(techBase: 'IS' | 'Clan'): void {
    editor.setField(field('year'), 3151);
    editor.setField(field('techBase'), techBase);
    editor.install(registry.equipment[techBase === 'IS' ? 'ISGaussRifle' : 'CLGaussRifle'], 'RT');
  }

  it('keeps installed CASE removable after the design technology rules it out', () => {
    prepare('IS');
    editor.setLocationCase('RT', 'case');
    expect(protection().map((mount) => mount.equipmentId)).toEqual(['ISCASE']);
    editor.setField(field('year'), 2954);
    editor.setField(field('rulesLevel'), 1);
    expect(caseChoice().selection).toBe('case');
    editor.setLocationCase('RT', 'none');
    expect(protection()).toEqual([]);
  });

  it('turns automatic Clan CASE off and on through the location choice', () => {
    prepare('Clan');
    expect(caseChoice().selection).toBe('case');
    editor.setLocationCase('RT', 'none');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeFalse();
    expect(editor.entity().clanCaseOptOutLocations().has('RT')).toBeTrue();
    editor.setLocationCase('RT', 'case');
    expect(editor.entity().automaticClanCaseLocations().has('RT')).toBeTrue();
    expect(protection()).toEqual([]);
  });

  it('keeps a manually installed slotless Clan CASE out of the unallocated tray', () => {
    prepare('Clan');
    editor.remove(editor.entity().equipment().find((mount) => mount.equipmentId === 'CLGaussRifle')!);
    editor.install(registry.equipment['CLCASE'], 'RT');
    const [mount] = protection();
    expect(editor.isMountUnallocated(mount!)).toBeFalse();
    expect(editor.unallocated()).not.toContain(mount!);
  });
});
