"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import Filters, { ASSET_FILTER_OPTIONS } from "@/components/marketplace/filters";
import ListingCard from "@/components/marketplace/listing-card";
import ListingModal from "@/components/marketplace/listing-modal";
import type { MarketplaceAssetFilter, MarketplaceListing } from "@/types/listing";

interface ListingsBrowserProps {
  listings: MarketplaceListing[];
}

function getPriceBounds(listings: MarketplaceListing[]) {
  const prices = listings
    .map((listing) => listing.price)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (prices.length === 0) {
    return {
      maxPrice: 2_000_000,
      minPrice: 100_000,
    };
  }

  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const roundedMin = Math.max(Math.floor(rawMin / 10_000) * 10_000, 0);
  const roundedMax = Math.ceil(rawMax / 10_000) * 10_000;

  if (roundedMin === roundedMax) {
    return {
      maxPrice: roundedMax + 50_000,
      minPrice: Math.max(roundedMin - 50_000, 0),
    };
  }

  return {
    maxPrice: roundedMax,
    minPrice: roundedMin,
  };
}

function formatResultsText(filteredCount: number, totalCount: number) {
  return `Показано ${filteredCount} из ${totalCount} активов`;
}

function getAssetFilterLabel(assetFilter: MarketplaceAssetFilter) {
  return ASSET_FILTER_OPTIONS.find((option) => option.value === assetFilter)?.label ?? "Все";
}

function AmbientWaveField({ className }: { className?: string }) {
  const waves = [
    {
      d: "M-120 516C82 442 204 406 382 436C546 462 674 586 846 574C1020 560 1112 394 1276 378C1388 366 1496 406 1576 458",
      stroke: "rgba(0,229,255,0.28)",
    },
    {
      d: "M-64 600C132 504 296 488 462 532C632 576 770 702 966 674C1168 644 1296 494 1508 486",
      stroke: "rgba(139,92,246,0.24)",
    },
    {
      d: "M-180 660C10 596 208 576 382 614C564 654 722 760 936 742C1140 724 1284 616 1508 604",
      stroke: "rgba(59,130,246,0.18)",
    },
  ];

  return (
    <svg
      viewBox="0 0 1440 760"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
      fill="none"
    >
      {waves.map(({ d, stroke }, index) => (
        <path
          key={index}
          d={d}
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export default function ListingsBrowser({ listings }: ListingsBrowserProps) {
  const { maxPrice, minPrice } = getPriceBounds(listings);
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [selectedAssetType, setSelectedAssetType] = useState<MarketplaceAssetFilter>("all");
  const [selectedMinPrice, setSelectedMinPrice] = useState(minPrice);
  const [selectedMaxPrice, setSelectedMaxPrice] = useState(maxPrice);

  useEffect(() => {
    setSelectedMinPrice(minPrice);
    setSelectedMaxPrice(maxPrice);
  }, [maxPrice, minPrice]);

  const filteredListings = listings.filter((listing) => {
    if (selectedAssetType !== "all" && listing.assetType !== selectedAssetType) {
      return false;
    }

    if (listing.price < selectedMinPrice || listing.price > selectedMaxPrice) {
      return false;
    }

    return true;
  });

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[940px] overflow-hidden">
          <div className="absolute left-1/2 top-10 h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,229,255,0.18),transparent_58%)] blur-[110px]" />
          <div className="absolute left-1/2 top-12 h-[720px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.18),transparent_62%)] blur-[130px]" />
          <div className="absolute left-1/2 top-[4.5rem] h-[520px] w-[520px] -translate-x-1/2 rotate-45 rounded-[6rem] bg-[linear-gradient(135deg,rgba(0,229,255,0.48),rgba(139,92,246,0.5))] opacity-70 blur-[130px]" />
          <div className="absolute left-1/2 top-[6rem] h-[430px] w-[430px] -translate-x-1/2 rotate-45 rounded-[5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.01))] opacity-70" />
          <div className="absolute left-1/2 top-[9.5rem] h-[230px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.22)_0%,rgba(0,229,255,0.18)_24%,rgba(139,92,246,0.18)_48%,transparent_76%)] blur-[48px]" />
          <div className="absolute inset-x-[-8%] bottom-[7rem] h-[360px]">
            <AmbientWaveField className="h-full w-full opacity-80" />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[220px] bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.12),transparent_46%)]" />
        </div>

        <div className="relative mx-auto max-w-[1440px] px-4 pt-2 sm:px-6 lg:px-8 lg:pt-2">
          <div className="relative pb-[3.5rem] pt-4 sm:pb-[4.25rem] sm:pt-5 lg:pb-[4.5rem] lg:pt-[1.4rem]">
            <div className="relative z-10 mx-auto max-w-[980px] text-center">
              <h1 className="mx-auto max-w-[980px] text-[2.15rem] font-extrabold leading-[1.02] tracking-[-0.05em] text-white [text-shadow:0_14px_46px_rgba(0,0,0,0.58),0_0_24px_rgba(255,255,255,0.15)] sm:text-[3rem] lg:text-[3.9rem]">
                <span className="block">Институциональные</span>
                <span className="mt-1 block">токенизированные активы</span>
              </h1>
              <p className="mx-auto mt-3 max-w-[620px] text-[0.82rem] leading-6 text-white/66 [text-wrap:balance] sm:text-[0.9rem] lg:text-[0.96rem]">
                Инвестируйте в недвижимость, облигации, товары и акции с институциональным качеством исполнения на блокчейне Solana.
              </p>
            </div>

            <div className="absolute inset-x-0 bottom-0 z-20 translate-y-[4%] sm:translate-y-[6%] lg:translate-y-[8%]">
              <div className="mx-auto max-w-[1080px]">
                <Filters
                  minPrice={minPrice}
                  maxPrice={maxPrice}
                  selectedAssetType={selectedAssetType}
                  selectedMinPrice={selectedMinPrice}
                  selectedMaxPrice={selectedMaxPrice}
                  onAssetTypeChange={setSelectedAssetType}
                  onMinPriceChange={setSelectedMinPrice}
                  onMaxPriceChange={setSelectedMaxPrice}
                />
              </div>
            </div>
          </div>

          <div className="mt-[1.35rem] flex flex-wrap items-center justify-between gap-3 px-1 sm:mt-[1.6rem] lg:mt-[1.9rem]">
            <p className="text-[0.9rem] text-white/55">
              {formatResultsText(filteredListings.length, listings.length)}
            </p>
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/44 backdrop-blur-xl">
              {selectedAssetType === "all" ? "Все активы" : getAssetFilterLabel(selectedAssetType)}
            </div>
          </div>

          {filteredListings.length === 0 ? (
            <div className="mt-8 rounded-[2.1rem] border border-white/10 bg-white/[0.05] px-6 py-20 text-center shadow-[0_24px_90px_rgba(4,8,24,0.4)] backdrop-blur-[26px]">
              <Building2 className="mx-auto mb-4 h-16 w-16 text-white/18" />
              <p className="text-2xl font-semibold text-white">Активы не найдены</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/58">
                Измените тип актива или расширьте ценовой диапазон, чтобы увидеть больше институциональных предложений Fortis.
              </p>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              {filteredListings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  onClick={() => setSelectedListing(listing)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedListing ? (
        <ListingModal listing={selectedListing} onClose={() => setSelectedListing(null)} />
      ) : null}
    </>
  );
}
