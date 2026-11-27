// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake



import { naturalCompare } from '../utils/sort.util';
import type { UnitUuid } from '../services/unit-catalog/unit-catalog.types';

interface ForcePackUnit {
  uuid: UnitUuid;
}

export interface ForcePack {
  name: string;
  units: ForcePackUnit[];
  bv?: number;
  variants?: Array<{
    name: string;
    units: Array<ForcePackUnit>;
  }>;
  references?: Array<{ name: string; url: string }>;
}

export const getForcePacks = (): ForcePack[] => sortedForcePacks;

const FORCE_PACKS = [
  {
    "name": "Clan Command Star",
    "units": [
      { "uuid": "019f583e-c423-7da2-8416-4730c12fbc32" },
      { "uuid": "019f583e-c68c-73fc-aee1-6df21d11a270" },
      { "uuid": "019f583e-cadb-7058-9b0c-f53740127e5b" },
      { "uuid": "019f583e-c5c1-7e1b-897a-1817258a17ef" },
      { "uuid": "019f583e-c6be-762c-b5ff-90abf8911418" }
    ],
    "references": [
      { "name": "Catalyst Game Labs Store", "url": "https://store.catalystgamelabs.com/products/battletech-forcepack-clan?variant=39754352066594" }
    ]
  },
  {
    "name": "Clan Heavy Striker Star",
    "units": [
      { "uuid": "019f583e-c5fe-7aaa-b789-04490442a799" },
      { "uuid": "019f583e-c5db-737a-934e-d19d1d8686a0" },
      { "uuid": "019f583e-c70b-7a19-8614-7808a9fe5e62" },
      { "uuid": "019f583e-c48c-761e-9571-7dcd5519a6fc" },
      { "uuid": "019f583e-c458-7cd5-9d1c-ac7d1036003f" }
    ]
  },
  {
    "name": "Clan Fire Star",
    "units": [
      { "uuid": "019f583e-c60a-7924-bb93-89bbc54fd2ff" },
      { "uuid": "019f583e-cc65-722d-8c3f-a5766118fb9c" },
      { "uuid": "019f583e-cbca-7ad4-962e-e01013f88cd7" },
      { "uuid": "019f583e-c6db-7b45-a6ac-5b651ff5e5ea" },
      { "uuid": "019f583e-c43a-7fba-8bd5-9103f7b41ece" }
    ]
  },
  {
    "name": "Clan Heavy Star",
    "units": [
      { "uuid": "019f583e-c756-7c5f-a440-7a7ca7bae65d" },
      { "uuid": "019f583e-cb2d-7ce5-8955-473c7d23aaa9" },
      { "uuid": "019f583e-dc0a-7d99-92d8-7427e5f4d3a6" },
      { "uuid": "019f583e-dbd0-731a-8625-a72e01351d6c" },
      { "uuid": "019f583e-ca49-729d-acf1-de8124b0a710" }
    ]
  },
  {
    "name": "Clan Support Star",
    "units": [
      { "uuid": "019f583e-ca87-7aed-9499-d1d3bbad6f66" },
      { "uuid": "019f583e-ca43-7725-abf4-d5d844e5e96c" },
      { "uuid": "019f583e-c81b-79e0-a8d4-3cd519d91a82" },
      { "uuid": "019f583e-c93f-7037-b8ac-61546648954b" },
      { "uuid": "019f583e-c964-79f4-a771-b5ee695e9f17" }
    ]
  },
  {
    "name": "Clan Heavy Battle Star",
    "units": [
      { "uuid": "019f583e-cb5b-7cc5-934d-b9f297696671" },
      { "uuid": "019f583e-ca56-710e-b620-3a6c6e19b606" },
      { "uuid": "019f583e-c996-7e11-9749-23a4e944c9b3" },
      { "uuid": "019f583e-c9b0-7248-a059-c59d90080a3e" },
      { "uuid": "019f583e-ca9e-7753-a344-9952fa1d1c1e" }
    ]
  },
  {
    "name": "Clan Striker Star",
    "units": [
      { "uuid": "019f583e-dc81-70f9-8973-d18d7379e39a" },
      { "uuid": "019f583e-dbe1-77fc-b74a-c12550b719b4" },
      { "uuid": "019f583e-d847-7bfc-b98f-5197dea38aa7" },
      { "uuid": "019f583e-c8fd-7a59-9b5f-b2415dd647a3" },
      { "uuid": "019f583e-cac0-7d1d-9500-6337d38f307a" }
    ]
  },
  {
    "name": "Clan Ad Hoc Star",
    "units": [
      { "uuid": "019f583e-ca5f-7714-98ad-484c52e8ce1f" },
      { "uuid": "019f583e-cc71-7b94-9c23-2f5cda714bbf" },
      { "uuid": "019f583e-cd34-700c-b8ee-aba467e2855b" },
      { "uuid": "019f583e-ca07-707d-aae6-473e2ff497e6" },
      { "uuid": "019f583e-c747-70a6-ba2c-1b7030bb9f3c" }
    ]
  },
  {
    "name": "Clan Elemental Star",
    "units": [
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" }
    ]
  },
  {
    "name": "Inner Sphere Command Lance",
    "units": [
      { "uuid": "019f583e-c26b-73cd-8e73-6ad0f44f68d2" },
      { "uuid": "019f583e-c17f-7aa5-ad39-3367593a807d" },
      { "uuid": "019f583e-c2fb-772c-9012-ba90e879205f" },
      { "uuid": "019f583e-c2de-71b5-8f2c-fd01e390e2d7" }
    ]
  },
  {
    "name": "Inner Sphere Battle Lance",
    "units": [
      { "uuid": "019f583e-c31d-7656-b604-9c801f6d2f15" },
      { "uuid": "019f583e-c2a6-713d-921c-5ae7ec9e985b" },
      { "uuid": "019f583e-c28e-7e8e-abe0-a8c01a224a3a" },
      { "uuid": "019f583e-c31f-7a7e-be9e-14f924d4af13" }
    ]
  },
  {
    "name": "Inner Sphere Direct Fire Lance",
    "units": [
      { "uuid": "019f583e-c18a-7a23-98e0-6a19d55887d4" },
      { "uuid": "019f583e-c264-71e9-856b-94d5ee49a5eb" },
      { "uuid": "019f583e-c274-71df-b23b-a3b35d0ef7e5" },
      { "uuid": "019f583e-c1ef-79f1-b0ce-7548df1c9015" }
    ]
  },
  {
    "name": "Inner Sphere Heavy Lance",
    "units": [
      { "uuid": "019f583e-c19d-78a3-9083-73677719a117" },
      { "uuid": "019f583e-c212-7595-85b3-4341b119e46c" },
      { "uuid": "019f583e-c1c1-7e2c-bdcd-43bb06df6cc0" },
      { "uuid": "019f583e-c21c-748a-a77c-299873c4cf83" }
    ]
  },
  {
    "name": "Inner Sphere Striker Lance",
    "units": [
      { "uuid": "019f583e-c1aa-7400-a152-21c7aaeffa79" },
      { "uuid": "019f583e-c244-7b57-bfab-364469b7bb7f" },
      { "uuid": "019f583e-c28c-7408-a431-79cf1fabff5b" },
      { "uuid": "019f583e-c32e-736a-9279-33d0b393bb46" }
    ]
  },
  {
    "name": "Inner Sphere Fire Lance",
    "units": [
      { "uuid": "019f583e-c262-7f1a-accd-0adcb254055b" },
      { "uuid": "019f583e-c2d0-723a-b44a-e7cccb60d88f" },
      { "uuid": "019f583e-c341-7309-b4f3-7ade380944e9" },
      { "uuid": "019f583e-c2f1-7f09-8d8d-78aa348b3e5e" }
    ]
  },
  {
    "name": "Inner Sphere Heavy Battle Lance",
    "units": [
      { "uuid": "019f583e-ca90-70b8-be75-007dc2de2ec2" },
      { "uuid": "019f583e-c1b3-78f5-9685-97ddf292faa9" },
      { "uuid": "019f583e-c366-7421-8a8a-1b23b4424ec3" },
      { "uuid": "019f583e-c988-7319-98cd-7031e6929c2c" }
    ]
  },
  {
    "name": "Inner Sphere Urban Lance",
    "units": [
      { "uuid": "019f583e-c302-7036-81ff-cb0dc0587c8d" },
      { "uuid": "019f583e-c200-70d0-847f-0d36a869d9f1" },
      { "uuid": "019f583e-c22f-7b66-ba9e-06356dcc83f0" },
      { "uuid": "019f583e-c670-7a8d-b748-45169a0493b9" }
    ]
  },
  {
    "name": "Inner Sphere Support Lance",
    "units": [
      { "uuid": "019f583e-c1f7-7630-8b19-6a127ab8ee04" },
      { "uuid": "019f583e-c6c5-70b6-9610-b418ad01e4aa" },
      { "uuid": "019f583e-c1fe-70ff-a9f2-dcdc36d4c669" },
      { "uuid": "019f583e-c6a1-76b9-9372-cca318bd9282" }
    ]
  },
  {
    "name": "Wolf's Dragoons Assault Star",
    "units": [
      { "uuid": "019f583e-c345-7a9d-b59f-c75a012b9467" },
      { "uuid": "019f583e-c5eb-7cb8-b144-37b1bcb3270f" },
      { "uuid": "019f583e-c2a6-713d-921c-5ae7ec9e985b" },
      { "uuid": "019f583e-c182-7a7d-a4ca-6a76fa1a2a72" },
      { "uuid": "019f583e-c38d-732a-a836-9c72ddf4eee2" }
    ]
  },
  {
    "name": "Eridani Light Horse Hunter Lance",
    "units": [
      { "uuid": "019f583e-c2ea-70ab-a655-1c6dab28a137" },
      { "uuid": "019f583e-c410-7cd3-b214-3429a448b56c" },
      { "uuid": "019f583e-c19d-78a3-9083-73677719a117" },
      { "uuid": "019f583e-cd7c-738d-b57d-6748548f59b2" }
    ]
  },
  {
    "name": "Hansen's Roughriders Battle Lance",
    "units": [
      { "uuid": "019f583e-c865-72a9-8e4e-877c7b65d94b" },
      { "uuid": "019f583e-c519-7428-91d7-33170ebc5baf" },
      { "uuid": "019f583e-c459-7a10-9f2c-bbdf63acb519" },
      { "uuid": "019f583e-c18a-7a23-98e0-6a19d55887d4" }
    ]
  },
  {
    "name": "Northwind Highlanders Command Lance",
    "units": [
      { "uuid": "019f583e-c4e7-7120-8261-e9cb15b417e1" },
      { "uuid": "019f583e-c7c6-7cb7-aece-ffa88ba54a0c" },
      { "uuid": "019f583e-c538-7218-8a64-755b705053c0" },
      { "uuid": "019f583e-dc49-7dee-862c-bc674e6456ec" }
    ]
  },
  {
    "name": "Kell Hounds Striker Lance",
    "units": [
      { "uuid": "019f583e-d974-7b6d-93ba-6757f5e533e7" },
      { "uuid": "019f583e-d7db-7701-be87-f228057dadc1" },
      { "uuid": "019f583e-d962-7f0b-b76d-9f4063448b2a" },
      { "uuid": "019f583e-db14-778b-875c-65e49115f492" }
    ]
  },
  {
    "name": "Gray Death Legion Heavy Battle Lance",
    "units": [
      { "uuid": "019f583e-da5e-7681-a270-ab5f9771ef8b" },
      { "uuid": "019f583e-c5f3-739d-a364-71eff147d922" },
      { "uuid": "019f583e-c3bd-74da-a4a2-04ed3b959109" },
      { "uuid": "019f583e-d896-7426-bf2d-409f2cfdd836" }
    ]
  },
  {
    "name": "Snord's Irregulars Assault Lance",
    "units": [
      { "uuid": "019f583e-cae3-7a3f-a4ba-7c309e841d61" },
      { "uuid": "019f583e-dd4b-7aaf-8863-cc6a6e41f92d" },
      { "uuid": "019f583e-c4f2-73b9-943e-2e1a17fed3a1" },
      { "uuid": "019f583e-c538-7218-8a64-755b705053c0" }
    ]
  },
  {
    "name": "1st Somerset Strikers",
    "units": [
      { "uuid": "019f583e-c4fe-7a73-8638-f0fae90382a0" },
      { "uuid": "019f583e-c60d-709a-8004-2f1f037dae55" },
      { "uuid": "019f583e-c367-73c9-a72e-87c770e42856" },
      { "uuid": "019f583e-c988-7319-98cd-7031e6929c2c" },
      { "uuid": "019f583e-c71c-7ea8-8aeb-4b9cb1b5c03e" }
    ]
  },
  {
    "name": "McCarron's Armored Cavalry Assault Lance",
    "units": [
      { "uuid": "019f583e-d384-76a2-851f-2fe34af5feab" },
      { "uuid": "019f583e-c385-74f1-905f-0342bdc470ee" },
      { "uuid": "019f583e-c363-742a-b3a1-8b2278818e90" },
      { "uuid": "019f583e-d105-78df-86f2-a19ca3c29fbe" }
    ]
  },
  {
    "name": "Black Remnant Command Lance",
    "units": [
      { "uuid": "019f583e-c415-7b1e-9248-2593e2e74ac7" },
      { "uuid": "019f583e-dade-7086-8ea0-ef0cd82ebb7d" },
      { "uuid": "019f583e-db90-7334-98ec-1a0ce1f6f445" },
      { "uuid": "019f583e-c9bb-708f-9695-b757f7a828fc" }
    ]
  },
  {
    "name": "BattleTech: Proliferation Cycle Pack",
    "units": [
      { "uuid": "019f583e-ce2e-7717-9a5b-938976e24c3f" },
      { "uuid": "019f583e-cf45-7c96-beb3-deaf0df1fe10" },
      { "uuid": "019f583e-d654-7e46-a0d7-29a699c3e887" },
      { "uuid": "019f583e-dff1-76f0-8fb5-0099b50fefd6" },
      { "uuid": "019f583e-dfe4-743a-9541-2661b8c107ec" },
      { "uuid": "019f583e-ce96-7e3b-b941-3407a8696952" },
      { "uuid": "019f583e-dfdb-7d30-8347-5a8c2f52afb1" }
    ]
  },
  {
    "name": "BattleTech: UrbanMech Lance",
    "units": [
      { "uuid": "019f583e-c2f8-7ee0-8f56-9ae35699f574" },
      { "uuid": "019f583e-c2f7-72d7-9111-2d4ce8c0ab1e" },
      { "uuid": "019f583e-d648-7c2a-8d11-e4aac66d3b96" },
      { "uuid": "019f583e-c6e0-741a-9364-cfac0978d43f" }
    ]
  },
  {
    "name": "ComStar Command Level II",
    "units": [
      { "uuid": "019f583e-c387-7668-8cdd-b9fb58190eb6" },
      { "uuid": "019f583e-c463-70cf-a514-361d7437d8b5" },
      { "uuid": "019f583e-c538-7218-8a64-755b705053c0" },
      { "uuid": "019f583e-c59c-7b4a-a4ac-9c196644ccb4" },
      { "uuid": "019f583e-c26c-7e54-ae5f-66e25fba7fab" },
      { "uuid": "019f583e-c2b3-7e05-8043-6227737b0085" }
    ]
  },
  {
    "name": "ComStar Battle Level II",
    "units": [
      { "uuid": "019f583e-c1e4-7d03-a9cd-ff4cf5046746" },
      { "uuid": "019f583e-c1e6-7a10-8b21-7b8f8ddf7745" },
      { "uuid": "019f583e-c20a-7872-9e87-5841fba2cd9a" },
      { "uuid": "019f583e-c4f2-73b9-943e-2e1a17fed3a1" },
      { "uuid": "019f583e-c5c3-7c3d-b63c-9ba8363cba3f" },
      { "uuid": "019f583e-c61b-79ab-bd03-328b4e384658" }
    ]
  },
  {
    "name": "First Star League Command Lance",
    "units": [
      { "uuid": "019f583e-ce23-7c30-92c7-d0c181b367a7" },
      { "uuid": "019f583e-cb45-7363-a8f4-2ac8b4998591" },
      { "uuid": "019f583e-c274-71df-b23b-a3b35d0ef7e5" },
      { "uuid": "019f583e-ceff-76f9-8d6e-a142823938b1" }
    ]
  },
  {
    "name": "Second Star League Assault Lance",
    "units": [
      { "uuid": "019f583e-c418-7829-b3ba-f3e1f8a36e44" },
      { "uuid": "019f583e-c9c9-77b0-80d2-11f1e25df4ec" },
      { "uuid": "019f583e-ccef-720f-a475-c95e60ea23b4" },
      { "uuid": "019f583e-cc0d-7f6c-a799-a572b0703681" },
      { "uuid": "019f583e-e26d-7725-80b1-4a6750459beb" }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack",
    "units": [
      { "uuid": "019f583e-c42a-7bad-894c-a5a01f3c623b" },
      { "uuid": "019f583e-c17f-7aa5-ad39-3367593a807d" },
      { "uuid": "019f583e-c26b-73cd-8e73-6ad0f44f68d2" },
      { "uuid": "019f583e-c5ed-7beb-8c4c-a3d6c3d97c1d" }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack II",
    "units": [
      { "uuid": "019f583e-ea5a-7d24-9cd6-edd3414eb4ea" },
      { "uuid": "019f583e-c9b5-7d9f-829e-1203ffc3e602" },
      { "uuid": "019f583e-c3dd-70db-8d59-309dcbb4e4ff" },
      { "uuid": "019f583e-dc19-7ec9-bbb3-e072f352506d" },
      { "uuid": "019f583e-c39b-7765-8c07-ed3ae311de76" }
    ]
  },
  {
    "name": "Legendary MechWarriors Pack III",
    "units": [
      { "uuid": "019f583e-dc00-7a8f-afeb-0d1f09c66228" },
      { "uuid": "019f583e-dc4c-7807-b6f3-3eb73294a505" },
      { "uuid": "019f583e-d737-7432-91cf-4454553b4c94" },
      { "uuid": "019f583e-d6d3-713c-b9b0-41839351cbe5" },
      { "uuid": "019f583e-d2df-726e-bffd-bcaeef1f1f42" },
      { "uuid": "019f583e-d1a2-7ccf-ad1a-a208537718a4" }
    ]
  },
  {
    "name": "Inner Sphere Battle Armor Platoon",
    "units": [
      { "uuid": "019f583e-a27d-7ffc-8eab-97d650ad44fd" },
      { "uuid": "019f583e-a27d-7ffc-8eab-97d650ad44fd" },
      { "uuid": "019f583e-a27d-7ffc-8eab-97d650ad44fd" },
      { "uuid": "019f583e-a27d-7ffc-8eab-97d650ad44fd" }
    ]
  },
  {
    "name": "Inner Sphere Security Lance",
    "units": [
      { "uuid": "019f583e-c23e-79c8-a5bb-3fbbf23addc5" },
      { "uuid": "019f583e-c2ad-7bdb-8e16-7ca0b966fdbe" },
      { "uuid": "019f583e-c311-79f5-81df-9ec448e2bdcc" },
      { "uuid": "019f583e-c32b-772d-8928-ade4800cc6e4" }
    ]
  },
  {
    "name": "Inner Sphere Recon Lance",
    "units": [
      { "uuid": "019f583e-c205-70fb-a068-0fe621f5d533" },
      { "uuid": "019f583e-caea-7236-9c44-156dbf2aec34" },
      { "uuid": "019f583e-c284-74c1-ac59-8cf567a70d76" },
      { "uuid": "019f583e-c242-7894-9ac4-a94716db7d4a" }
    ]
  },
  {
    "name": "Inner Sphere Heavy Recon Lance",
    "units": [
      { "uuid": "019f583e-c1ca-7250-bc52-432beab20e1e" },
      { "uuid": "019f583e-c27c-7124-be93-3ed85d66c1fb" },
      { "uuid": "019f583e-ca77-76c6-9cde-26adc15f2f65" },
      { "uuid": "019f583e-db2e-7e5e-bf4d-0f6105e3af1b" }
    ]
  },
  {
    "name": "Battlefield Support: Fire Lance",
    "units": [
      { "uuid": "019f583e-e2f9-7820-be76-6cb682eb0e3f" },
      { "uuid": "019f583e-e2f9-7820-be76-6cb682eb0e3f" },
      { "uuid": "019f583e-e2bb-7c9f-bad8-69d9274198bd" },
      { "uuid": "019f583e-e2bb-7c9f-bad8-69d9274198bd" }
    ]
  },
  {
    "name": "Battlefield Support: Battle Lance",
    "units": [
      { "uuid": "019f583e-e2c0-7df4-ac2a-b03229952c19" },
      { "uuid": "019f583e-e2c0-7df4-ac2a-b03229952c19" },
      { "uuid": "019f583e-e326-74de-8b26-e3e4e58f06b8" },
      { "uuid": "019f583e-e326-74de-8b26-e3e4e58f06b8" }
    ]
  },
  {
    "name": "Battlefield Support: Cavalry Lance",
    "units": [
      { "uuid": "019f583e-e269-7927-b137-789bc539d0db" },
      { "uuid": "019f583e-e269-7927-b137-789bc539d0db" },
      { "uuid": "019f583e-e2f2-79e4-9b66-b2c8808f698a" },
      { "uuid": "019f583e-e2f2-79e4-9b66-b2c8808f698a" }
    ]
  },
  {
    "name": "Battlefield Support: Assault Lance",
    "units": [
      { "uuid": "019f583e-e304-70d6-8795-f750054374a2" },
      { "uuid": "019f583e-e304-70d6-8795-f750054374a2" },
      { "uuid": "019f583e-e26f-7354-91c9-f410a69bd409" },
      { "uuid": "019f583e-e26f-7354-91c9-f410a69bd409" }
    ]
  },
  {
    "name": "Battlefield Support: Command Lance",
    "units": [
      { "uuid": "019f583e-e32a-736b-b45c-b203f70d4fd1" },
      { "uuid": "019f583e-e32a-736b-b45c-b203f70d4fd1" },
      { "uuid": "019f583e-e9ce-7dbe-bfd1-263579fd2571" },
      { "uuid": "019f583e-e9ce-7dbe-bfd1-263579fd2571" }
    ]
  },
  {
    "name": "Battlefield Support: Rifle Lance",
    "units": [
      { "uuid": "019f583e-e263-7e7a-a0cb-656a1bb5a825" },
      { "uuid": "019f583e-e263-7e7a-a0cb-656a1bb5a825" },
      { "uuid": "019f583e-e29a-7a1f-81c2-322643c2f764" },
      { "uuid": "019f583e-e29a-7a1f-81c2-322643c2f764" }
    ]
  },
  {
    "name": "Battlefield Support: Sweep Lance",
    "units": [
      { "uuid": "019f583e-e278-7f72-8106-53f2c98274ef" },
      { "uuid": "019f583e-e278-7f72-8106-53f2c98274ef" },
      { "uuid": "019f583e-e2b2-7cac-b805-8e5d7abbb8b9" },
      { "uuid": "019f583e-e2b2-7cac-b805-8e5d7abbb8b9" }
    ]
  },
  {
    "name": "Battlefield Support: Heavy Battle Lance",
    "units": [
      { "uuid": "019f583e-e2ec-7085-a6b4-ebbf5f41d6d7" },
      { "uuid": "019f583e-e2ec-7085-a6b4-ebbf5f41d6d7" },
      { "uuid": "019f583e-e2f6-7b6c-8637-39f0ecc08718" },
      { "uuid": "019f583e-e2f6-7b6c-8637-39f0ecc08718" }
    ]
  },
  {
    "name": "Battlefield Support: Hunter Lance",
    "units": [
      { "uuid": "019f583e-e2df-7f34-bf5b-58802c3ab2a6" },
      { "uuid": "019f583e-e2df-7f34-bf5b-58802c3ab2a6" },
      { "uuid": "019f583e-e25e-7bcc-98db-f0e4490970ab" },
      { "uuid": "019f583e-e25e-7bcc-98db-f0e4490970ab" }
    ]
  },
  {
    "name": "Battlefield Support: Recon Lance",
    "units": [
      { "uuid": "019f583e-e32e-7053-85ce-1348db5f5195" },
      { "uuid": "019f583e-e32e-7053-85ce-1348db5f5195" },
      { "uuid": "019f583e-e318-7065-bed6-a4ae704e1035" },
      { "uuid": "019f583e-e318-7065-bed6-a4ae704e1035" }
    ]
  },
  {
    "name": "Battlefield Support: Objectives",
    "units": [
      { "uuid": "019f583e-e846-7a21-a33b-bfdea3a4656a" },
      { "uuid": "019f583e-e2d0-7d13-aa5e-eac6343119aa" },
      { "uuid": "019f583e-e2bf-7ab6-86e7-0bcc5abc3167" },
      { "uuid": "019f583e-e2ce-7330-a8ac-401e2f40caf2" }
    ]
  },
  {
    "name": "Beginner Box Set, 1st Edition",
    "units": [
      { "uuid": "019f583e-c215-7a66-afd4-259f136b4ab0" },
      { "uuid": "019f583e-c338-7203-9a51-f587c68e116c" }
    ]
  },
  {
    "name": "Beginner Box Set, 2nd Edition",
    "units": [
      { "uuid": "019f583e-c215-7a66-afd4-259f136b4ab0" },
      { "uuid": "019f583e-c30b-768a-a636-2dc759b7b74b" },
      { "uuid": "019f583e-c25b-7e1d-a2f6-f2b3763ac718" },
      { "uuid": "019f583e-c2e8-70ca-92f3-4739c180a188" }
    ]
  },
  {
    "name": "A Game of Armored Combat Box Set",
    "units": [
      { "uuid": "019f583e-c18d-7c68-a0f3-af8d5d2c13cd" },
      { "uuid": "019f583e-c1a2-737e-90ee-5776126d69cf" },
      { "uuid": "019f583e-c1ba-779f-b22a-55757e46e82c" },
      { "uuid": "019f583e-c1df-7ba1-9e40-a6f8b34451a9" },
      { "uuid": "019f583e-c25b-7e1d-a2f6-f2b3763ac718" },
      { "uuid": "019f583e-c2bd-7493-b16b-c5dd6e98a2e3" },
      { "uuid": "019f583e-c2e8-70ca-92f3-4739c180a188" },
      { "uuid": "019f583e-c338-7203-9a51-f587c68e116c" }
    ],
    "variants": [
      { "name": "IlClan",
        "units": [
          { "uuid": "019f583e-dbb3-78ec-8ccd-8717f3bb8511" },
          { "uuid": "019f583e-db3b-73b9-a283-2f6a341d14c9" },
          { "uuid": "019f583e-dbd9-72a3-8d58-5cf4feb32fe4" },
          { "uuid": "019f583e-d7d1-7d0a-abfd-6a359468e30e" },
          { "uuid": "019f583e-d927-7de4-8656-6d95531e8c19" },
          { "uuid": "019f583e-d271-77f0-8cdf-cffc27fe3d57" },
          { "uuid": "019f583e-d905-7e59-8fd7-f3f09d9453d8" },
          { "uuid": "019f583e-d9a0-7872-8869-eadb54c0434c" }
        ]
      }
    ]
  },
  {
    "name": "Essentials Box Set",
    "units": [
      { "uuid": "019f583e-c1c1-7e2c-bdcd-43bb06df6cc0" },
      { "uuid": "019f583e-c2a6-713d-921c-5ae7ec9e985b" },
      { "uuid": "019f583e-c1c5-7ee5-a9fa-e126b7d6c2ac" },
    ]
  },
  {
    "name": "Alpha Strike Box Set",
    "units": [
      { "uuid": "019f583e-d7f3-72e1-b54f-172491d384e0" },
      { "uuid": "019f583e-c359-7dbe-b2aa-c6dbdef02548" },
      { "uuid": "019f583e-c38f-7592-8346-866e67ad1530" },
      { "uuid": "019f583e-c430-7166-abea-d1c60a7dfbf8" },
      { "uuid": "019f583e-d921-707b-87f1-7c9c2ead95c6" },
      { "uuid": "019f583e-c382-7c88-8e97-e336ab182970" },
      { "uuid": "019f583e-d855-7205-b9dd-58d5f0770559" },
      { "uuid": "019f583e-c892-722c-9d57-62ebd17f35b2" },
      { "uuid": "019f583e-c5eb-7cb8-b144-37b1bcb3270f" },
      { "uuid": "019f583e-c31d-7656-b604-9c801f6d2f15" },
      { "uuid": "019f583e-c602-7a92-88f7-8ca2fb6ff5cb" },
      { "uuid": "019f583e-dbd5-77bb-8cc2-7f0f00fcc8e4" },
      { "uuid": "019f583e-c90e-771b-99a7-1c7a1bef420a" }
    ]
  },
  {
    "name": "Clan Invasion Box Set",
    "units": [
      { "uuid": "019f583e-c660-7799-bccc-c6b51d07caf9" },
      { "uuid": "019f583e-c4da-7729-82f9-b5fd86afa5c1" },
      { "uuid": "019f583e-ca33-70d7-8835-d47612e9125f" },
      { "uuid": "019f583e-c382-7c88-8e97-e336ab182970" },
      { "uuid": "019f583e-c5eb-7cb8-b144-37b1bcb3270f" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" },
      { "uuid": "019f583e-a1e0-785d-a983-829ca2dd427c" }
    ]
  },
  {
    "name": "Mercenaries Box Set",
    "units": [
      { "uuid": "019f583e-c39e-765d-9625-e8bebda2dba1" },
      { "uuid": "019f583e-c9a0-742b-92b8-31bb286fbedf" },
      { "uuid": "019f583e-c9b5-7d9f-829e-1203ffc3e602" },
      { "uuid": "019f583e-c4c0-768b-b0fd-b36fbbf6a28b" },
      { "uuid": "019f583e-c496-7bb4-87ef-0da8873f1587" },
      { "uuid": "019f583e-c286-7b3f-9a22-9dc69e6a5e0e" },
      { "uuid": "019f583e-c294-7d59-a6ed-f604c3ff4e9d" },
      { "uuid": "019f583e-caf1-705e-b74a-172d57b51cb9" },
      { "uuid": "019f583e-e3fd-79d8-849f-eefe6e42c150" },
      { "uuid": "019f583e-e3ff-7b70-b73d-77df96369117" },
      { "uuid": "019f583e-e2c6-7b99-a188-ba0759db128e" },
      { "uuid": "019f583e-e99d-7708-9162-7c3cf743c1db" }
    ]
  },
  {
    "name": "Solaris VII: The Game World",
    "units": [
      { "uuid": "019f583e-c830-7086-886c-3a4643c232c4" },
      { "uuid": "019f583e-c8aa-7e14-b5d3-215187744f61" },
      { "uuid": "019f583e-c85b-7a97-9a9a-c2d150756e50" },
      { "uuid": "019f583e-c7fd-7adf-911e-2ed0bd416704" },
      { "uuid": "019f583e-c81d-73bc-b2e3-015687373d76" },
      { "uuid": "019f583e-c773-7329-a5ff-0d6f93c6136b" },
      { "uuid": "019f583e-c85f-7562-b5c4-71993b961129" },
      { "uuid": "019f583e-c76f-7545-a659-eb2b29191710" },
      { "uuid": "019f583e-c808-71ef-967b-6ba483b537e6" },
      { "uuid": "019f583e-c8ea-7e6e-a5e6-8dffe05e42f5" },
      { "uuid": "019f583e-c831-7f3f-b593-228f7a358f2f" },
      { "uuid": "019f583e-c766-75dd-a65d-4b40454c57f3" }
    ]
  },
  {
    "name": "Aces: Scouring Sands",
    "units": [
      { "uuid": "019f583e-d78a-7a85-8572-a6735c598875" },
      { "uuid": "019f583e-c6ba-7535-a208-a0a90e256a29" },
      { "uuid": "019f583e-dc50-708e-b558-cb3d6b1c62dc" },
      { "uuid": "019f583e-d969-7263-89dd-0ac8171c707e" },
      { "uuid": "019f583e-d228-7a43-aedb-e46212d4ed3f" },
      { "uuid": "019f583e-d91c-7628-a57a-7d2f16af16a9" },
      { "uuid": "019f583e-dc05-7407-9d6a-1db3cdf5e8fc" },
      { "uuid": "019f583e-e3fc-7d5e-abe7-db090c08409d" },
      { "uuid": "019f583e-e3fc-7d5e-abe7-db090c08409d" }
    ]
  },
  {
    "name": "Third Star League Strike Team",
    "units": [
      { "uuid": "019f583e-d54b-7403-89e3-381b31d13793" },
      { "uuid": "019f583e-d53d-735f-938f-07727c20e3f4" },
      { "uuid": "019f583e-c5a9-7a98-acd5-bc5c379b64f8" },
      { "uuid": "019f583e-dbdc-7cee-9838-59d7ec4309f2" },
      { "uuid": "019f583e-d397-7fa9-bc58-062ed87747ea" },
      { "uuid": "019f583e-e2ac-7c60-b90c-c2d02d14e88b" }
    ]
  },
  {
    "name": "Third Star League Battle Group",
    "units": [
      { "uuid": "019f583e-d3be-7bac-9dcc-a2b73a9a5b4c" },
      { "uuid": "019f583e-d361-74c5-823a-3c918b06e9f9" },
      { "uuid": "019f583e-c9e5-7f8f-9130-dd360f541c29" },
      { "uuid": "019f583e-cff1-783c-b839-fdc9deb2315f" },
      { "uuid": "019f583e-d556-7ca4-b34c-62761c06d980" },
      { "uuid": "019f583e-e813-7306-bd3b-30e5dfae7622" }
    ]
  },
  {
    "name": "Clan Cavalry Star",
    "units": [
      { "uuid": "019f583e-d91c-7628-a57a-7d2f16af16a9" },
      { "uuid": "019f583e-d983-7787-ba4a-7d6b980f69c4" },
      { "uuid": "019f583e-d8cf-7b7f-a077-aca3098a2b66" },
      { "uuid": "019f583e-da41-76ed-82f2-6f3935ce17cd" },
      { "uuid": "019f583e-d898-7be7-9ab0-066b44451903" }
    ]
  },
  {
    "name": "Clan Direct Fire Star",
    "units": [
      { "uuid": "019f583e-d971-720a-ad6c-983332d0c190" },
      { "uuid": "019f583e-cc1a-723e-b73a-0bb28edcfdd4" },
      { "uuid": "019f583e-d8f9-7e44-a250-f2fde6b38d8f" },
      { "uuid": "019f583e-ca38-7cd7-b47f-a8ab8f760efe" },
      { "uuid": "019f583e-d23e-7b23-83d0-74fe9c720a84" }
    ]
  },
  {
    "name": "Inner Sphere Pursuit Lance",
    "units": [
      { "uuid": "019f583e-c1d1-79fe-996b-d51b4227865c" },
      { "uuid": "019f583e-c1db-7e69-98c5-51597bfc2a17" },
      { "uuid": "019f583e-c223-70ab-adf7-5811fcd8c04f" },
      { "uuid": "019f583e-c1fb-7ee9-aed3-ef1564e73a71" }
    ]
  },
  {
    "name": "Inner Sphere Assault Lance",
    "units": [
      { "uuid": "019f583e-cab5-7fe8-a3bd-3b93f3ab49c9" },
      { "uuid": "019f583e-c20f-7106-85bb-5f9bd3d391e1" },
      { "uuid": "019f583e-c69c-76f3-a040-89086b638668" },
      { "uuid": "019f583e-c54b-7b56-a76c-b9cf326e3ded" }
    ]
  },
  {
    "name": "21st Centauri Lancers Command Lance",
    "units": [
      { "uuid": "019f583e-cadb-7058-9b0c-f53740127e5b" },
      { "uuid": "019f583e-d01a-782a-afd9-7c2d3643a8a7" },
      { "uuid": "019f583e-c6ad-7d70-8696-a8b5e3e5e253" },
      { "uuid": "019f583e-d3b4-7265-8425-3b391074fb5a" }
    ]
  },
  {
    "name": "Illician Lancers Command Lance",
    "units": [
      { "uuid": "019f583e-c8bd-7163-81e1-137de60c58ac" },
      { "uuid": "019f583e-da52-747f-a837-6ebf5504659f" },
      { "uuid": "019f583e-d200-70ec-9e4c-aa9f53e5b06b" },
      { "uuid": "019f583e-cfdb-782f-9206-65339dbab347" }
    ]
  },
  {
    "name": "House Davion Heavy Battle Lance",
    "units": [
      { "uuid": "019f583e-cd95-74a8-8dc3-d06c68e72640" },
      { "uuid": "019f583e-c78b-7d0f-ae47-e8ba48bdf4ef" },
      { "uuid": "019f583e-cd9d-70ff-b8df-623e092713c5" },
      { "uuid": "019f583e-d28f-705e-9701-cb7ce6a3936e" }
    ]
  },
  {
    "name": "House Davion Cavalry Lance",
    "units": [
      { "uuid": "019f583e-c459-7a10-9f2c-bbdf63acb519" },
      { "uuid": "019f583e-d327-709c-bd0c-9fa0417f77b1" },
      { "uuid": "019f583e-cd37-7d18-bf28-56fd31b8ff9c" },
      { "uuid": "019f583e-cec7-73e4-82de-8b40f02d659d" }
    ]
  },
  {
    "name": "House Kurita Ranger Lance",
    "units": [
      { "uuid": "019f583e-c8f5-78ac-8fea-1601c376ae8a" },
      { "uuid": "019f583e-cdd6-73ce-be19-fe4f881af929" },
      { "uuid": "019f583e-c28c-7408-a431-79cf1fabff5b" },
      { "uuid": "019f583e-d3dc-769c-89b5-41d479af3dbd" }
    ]
  },
  {
    "name": "House Kurita Command Lance",
    "units": [
      { "uuid": "019f583e-d353-76c6-87e3-e00001be04b0" },
      { "uuid": "019f583e-d04d-7ba2-a4ef-0a879423c1ea" },
      { "uuid": "019f583e-d356-792d-9d0b-41d42ad404b2" },
      { "uuid": "019f583e-d41c-7d24-b24e-1246a04b3314" }
    ]
  },
  {
    "name": "Aces: Snowblind",
    "units": [
      { "uuid": "019f583e-dc52-73ec-842c-25a56b6107d8" },
      { "uuid": "019f583e-ca3a-76f3-9834-08a1ffe413c4" },
      { "uuid": "019f583e-d9cd-7a74-b9b1-177b16ce83ba" },
      { "uuid": "019f583e-ca22-78fb-b9cb-103735ed18b1" },
      { "uuid": "019f583e-cc56-7bfb-b42a-a9b4f2f2fb8d" },
      { "uuid": "019f583e-ca4e-7453-b3ce-1da599a98923" },
      { "uuid": "019f583e-db5e-74dd-aff8-d6de1083399f" },
      { "uuid": "019f583e-d590-7d86-8992-04f30d8668d7" }
    ]
  }
] as ForcePack[];

// Sort once at module load and cache
const sortedForcePacks = [...FORCE_PACKS].sort((a, b) => naturalCompare(a.name, b.name));
