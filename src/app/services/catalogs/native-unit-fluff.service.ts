// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { inject, Injectable } from '@angular/core';
import type { UnitSummary } from '../../models/unit-summary.model';
import type { UnitFluff } from '../../models/unit-fluff.model';
import { parseNativeEntityFluff } from '../../models/entity/parsers/entity-fluff-parser';
import { entityFluffToUnitFluff } from '../../utils/entity-fluff-to-unit-fluff';
import {
  asSourceHash,
  makeUnitFileName,
  type NativeUnitFormat,
  type SourceHash,
  type UnitFileName,
  type UnitUuid,
} from '../unit-catalog/unit-catalog.types';
import { UnitsCatalogService } from './units-catalog.service';

export type NativeUnitFluffLoadFailure =
  | 'unsupported-source'
  | 'source-unavailable'
  | 'source-mismatch'
  | 'invalid-encoding'
  | 'invalid-source';

export class NativeUnitFluffLoadError extends Error {
  public constructor(readonly code: NativeUnitFluffLoadFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NativeUnitFluffLoadError';
  }
}

interface NativeFluffIdentity {
  readonly uuid: UnitUuid;
  readonly format: NativeUnitFormat;
  readonly sourceHash: SourceHash;
  readonly file: UnitFileName;
}

/**
 * Stateless, non-caching reader for the Intel tab. Each call binds to the
 * active catalog generation through UnitsCatalogService and drops source bytes
 * immediately after projecting the small presentation object.
 */
@Injectable({ providedIn: 'root' })
export class NativeUnitFluffService {
  private readonly catalog = inject(UnitsCatalogService);

  public async load(unit: UnitSummary): Promise<UnitFluff | undefined> {
    const identity = captureNativeFluffIdentity(unit);
    const source = await this.catalog.readNativeUnitSource(identity.uuid);
    if (!source) {
      throw new NativeUnitFluffLoadError('source-unavailable', 'The native unit source is unavailable');
    }

    // Capture and detach every returned field before decoding. The catalog
    // guarantees generation stability; these exact checks bind it to the Unit
    // selection which caused this request.
    const sourceFormat = source.format;
    const sourceHash = source.hash;
    const file = source.file;
    const bytes = new Uint8Array(source.bytes).slice().buffer;
    if (sourceFormat !== identity.format
      || sourceHash !== identity.sourceHash
      || file !== identity.file) {
      throw new NativeUnitFluffLoadError('source-mismatch', 'The native source does not match the selected unit');
    }

    let raw: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      throw new NativeUnitFluffLoadError('invalid-encoding', 'The native unit source is not valid UTF-8', { cause: error });
    }

    try {
      return entityFluffToUnitFluff(parseNativeEntityFluff(raw, sourceFormat));
    } catch (error) {
      throw new NativeUnitFluffLoadError('invalid-source', 'The native unit source could not be parsed', { cause: error });
    }
  }
}

function captureNativeFluffIdentity(unit: UnitSummary): NativeFluffIdentity {
  if (unit.origin !== 'megamek') {
    throw new NativeUnitFluffLoadError(
      'unsupported-source',
      'This unit does not expose an authoritative native source',
    );
  }

  const format: NativeUnitFormat = unit.entityType === 'Mek' ? 'mtf' : 'blk';
  let sourceHash: SourceHash;
  try {
    sourceHash = asSourceHash(unit.hash);
  } catch {
    throw new NativeUnitFluffLoadError('unsupported-source', 'The unit has no valid native source checksum');
  }

  return Object.freeze({
    uuid: unit.uuid,
    format,
    sourceHash,
    file: makeUnitFileName(unit.uuid, format),
  });
}
