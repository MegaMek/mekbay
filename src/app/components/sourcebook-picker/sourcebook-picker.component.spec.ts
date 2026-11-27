// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { SourcebookPickerDialogComponent } from './sourcebook-picker.component';
import { SourcebooksCatalogService } from '../../services/catalogs/sourcebooks-catalog.service';
import { DialogsService } from '../../services/dialogs.service';
import { SourcebookInfoDialogComponent } from '../sourcebook-info-dialog/sourcebook-info-dialog.component';
import type { Sourcebook } from '../../models/sourcebook.model';

describe('sourcebook catalog picker', () => {
  const books: Sourcebook[] = [
    { id: 1, sku: '35000', abbrev: 'TM', title: 'TechManual', canon: true },
    { id: 2, sku: '35003', abbrev: 'TW', title: 'Total Warfare', canon: true },
  ];
  let close: jasmine.Spy, inspect: jasmine.Spy;
  beforeEach(() => {
    close = jasmine.createSpy('close'); inspect = jasmine.createSpy('inspect');
    TestBed.configureTestingModule({ providers: [
      { provide: DIALOG_DATA, useValue: { title: 'Published', selected: [books[0]] } },
      { provide: DialogRef, useValue: { close } },
      { provide: DialogsService, useValue: { createDialog: inspect } },
      { provide: SourcebooksCatalogService, useValue: { getSourcebooks: () => new Map(books.map(book => [book.abbrev, book])) } },
    ] });
  });

  it('searches title and product code while keeping selected sources visible', () => {
    const picker = TestBed.createComponent(SourcebookPickerDialogComponent).componentInstance;
    picker.query.set('total warfare');
    expect(picker.books()).toEqual(books);
    picker.toggle(books[0]);
    expect(picker.books()).toEqual([books[1]]);
    picker.query.set('35000');
    expect(picker.books()).toEqual([books[0]]);
  });

  it('uses the existing sourcebook inspector and commits catalog objects with custom references only on Apply', () => {
    const fixture = TestBed.createComponent(SourcebookPickerDialogComponent);
    const picker = fixture.componentInstance;
    picker.inspect(books[1]);
    expect(inspect).toHaveBeenCalledWith(SourcebookInfoDialogComponent, jasmine.objectContaining({ data: jasmine.objectContaining({ sourcebooks: [jasmine.objectContaining({ title: 'Total Warfare' })] }) }));
    picker.manual.set('tw, Local notes p. 7');
    picker.apply();
    expect(close).toHaveBeenCalledWith([books[0], books[1], { abbrev: 'Local notes p. 7', canon: false, unresolved: true }]);
    expect(picker.data.selected).toEqual([books[0]]);
  });
});
