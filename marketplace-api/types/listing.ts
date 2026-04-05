import type { ListingDto } from "@/lib/dto/listing";

export const MARKETPLACE_ASSET_TYPES = ["bond", "real_estate", "commodity", "equity"] as const;

export type MarketplaceAssetType = (typeof MARKETPLACE_ASSET_TYPES)[number];
export type MarketplaceAssetFilter = MarketplaceAssetType | "all";

export interface MarketplaceListing extends ListingDto {
  assetType: MarketplaceAssetType;
  city: string | null;
  rooms: number | null;
}

const ASSET_TYPE_KEYWORDS: Array<{
  pattern: RegExp;
  type: MarketplaceAssetType;
}> = [
  {
    pattern: /(облиг|bond|treasury|fixed income|coupon)/i,
    type: "bond",
  },
  {
    pattern: /(недвиж|estate|property|tower|building|office|apartment|жил|дом|residen)/i,
    type: "real_estate",
  },
  {
    pattern: /(товар|сырь|gold|oil|metal|commodity|copper|agri|зерн)/i,
    type: "commodity",
  },
  {
    pattern: /(акци|equity|stock|share|index|growth|venture)/i,
    type: "equity",
  },
];

function inferMarketplaceAssetType(listing: ListingDto): MarketplaceAssetType {
  const searchText = [listing.title, listing.description ?? ""].join(" ");
  const keywordMatch = ASSET_TYPE_KEYWORDS.find(({ pattern }) => pattern.test(searchText));

  if (keywordMatch) {
    return keywordMatch.type;
  }

  return MARKETPLACE_ASSET_TYPES[(listing.id - 1) % MARKETPLACE_ASSET_TYPES.length] ?? "bond";
}

export function toMarketplaceListing(listing: ListingDto): MarketplaceListing {
  return {
    ...listing,
    assetType: inferMarketplaceAssetType(listing),
    city: listing.city ?? null,
    rooms: listing.rooms ?? null,
  };
}
