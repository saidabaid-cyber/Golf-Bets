import "server-only";

import { createInternalEquipmentCatalogProvider } from "./equipment-catalog-provider";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "./golf-equipment-catalog";

/** Server-only seed loader. Client components know only the HTTP contract. */
export const internalEquipmentCatalogProvider = createInternalEquipmentCatalogProvider({
  balls: golfBallCatalog,
  clubs: golfClubCatalog,
  shafts: golfShaftCatalog,
});
