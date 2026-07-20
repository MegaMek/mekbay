import { EquipmentRegistry } from '../../equipment-lookup';
import { AeroSpaceFighterEntity } from '../entities/aero/aero-space-fighter-entity';
import { ConvFighterEntity } from '../entities/aero/conv-fighter-entity';
import { DropShipEntity } from '../entities/aero/dropship-entity';
import { FixedWingSupportEntity } from '../entities/aero/fixed-wing-support-entity';
import { SmallCraftEntity } from '../entities/aero/small-craft-entity';
import { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import { InfantryEntity } from '../entities/infantry/infantry-entity';
import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { SpaceStationEntity } from '../entities/largecraft/space-station-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import { BipedMekEntity } from '../entities/mek/biped-mek-entity';
import { LamEntity } from '../entities/mek/lam-entity';
import { QuadMekEntity } from '../entities/mek/quad-mek-entity';
import { QuadVeeEntity } from '../entities/mek/quad-vee-entity';
import { TripodMekEntity } from '../entities/mek/tripod-mek-entity';
import { HandheldWeaponEntity } from '../entities/misc/handheld-weapon-entity';
import { ProtoMekEntity } from '../entities/protomek/protomek-entity';
import { LargeSupportTankEntity } from '../entities/vehicle/large-support-tank-entity';
import { SupportNavalEntity } from '../entities/vehicle/support-naval-entity';
import { SupportTankEntity } from '../entities/vehicle/support-tank-entity';
import { SupportVtolEntity } from '../entities/vehicle/support-vtol-entity';
import { TankEntity } from '../entities/vehicle/tank-entity';
import { VtolEntity } from '../entities/vehicle/vtol-entity';
import { TEST_EQUIPMENT_REGISTRY } from './test-equipment-registry';

export class TestAeroSpaceFighterEntity extends AeroSpaceFighterEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestBattleArmorEntity extends BattleArmorEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestBipedMekEntity extends BipedMekEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestConvFighterEntity extends ConvFighterEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestDropShipEntity extends DropShipEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestFixedWingSupportEntity extends FixedWingSupportEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestHandheldWeaponEntity extends HandheldWeaponEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestInfantryEntity extends InfantryEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestJumpShipEntity extends JumpShipEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestLamEntity extends LamEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestLargeSupportTankEntity extends LargeSupportTankEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestProtoMekEntity extends ProtoMekEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestQuadMekEntity extends QuadMekEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestQuadVeeEntity extends QuadVeeEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestSmallCraftEntity extends SmallCraftEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestSpaceStationEntity extends SpaceStationEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestSupportNavalEntity extends SupportNavalEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestSupportTankEntity extends SupportTankEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestSupportVtolEntity extends SupportVtolEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestTankEntity extends TankEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestTripodMekEntity extends TripodMekEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestVtolEntity extends VtolEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
export class TestWarShipEntity extends WarShipEntity {
  constructor(registry = TEST_EQUIPMENT_REGISTRY) { super(registry); }
}
