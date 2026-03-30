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

const HERO_WAVE_OFFSETS = [0, 20, 40, 60, 80, 100];

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

function WaveMesh({
  className,
  stroke,
}: {
  className: string;
  stroke: string;
}) {
  return (
    <svg
      viewBox="0 0 960 260"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
      fill="none"
    >
      {HERO_WAVE_OFFSETS.map((offset) => (
        <path
          key={offset}
          d={`M-40 ${188 - offset}C78 ${128 - offset}, 170 ${124 - offset}, 286 ${174 - offset}S522 ${
            230 - offset
          }, 662 ${176 - offset}S852 ${118 - offset}, 1000 ${166 - offset}`}
          stroke={stroke}
          strokeWidth="2"
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
      <section className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[780px] overflow-hidden">
          <div className="absolute left-1/2 top-8 h-[520px] w-[92vw] max-w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(140,92,255,0.32),rgba(140,92,255,0.14)_28%,transparent_68%)] blur-[110px]" />
          <div className="absolute left-1/2 top-16 h-[460px] w-[80vw] max-w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(40,197,255,0.34),rgba(40,197,255,0.1)_26%,transparent_62%)] blur-[96px]" />
          <div className="absolute left-1/2 top-10 h-[360px] w-[360px] -translate-x-1/2 rotate-45 rounded-[3rem] border border-cyan-300/50 shadow-[0_0_60px_rgba(34,211,238,0.45)]" />
          <div className="absolute left-1/2 top-12 h-[460px] w-[460px] -translate-x-1/2 rotate-45 rounded-[4rem] border border-fuchsia-400/40 shadow-[0_0_80px_rgba(217,70,239,0.35)]" />
          <div className="absolute inset-x-0 bottom-20 h-48 bg-[radial-gradient(circle_at_center,rgba(228,76,255,0.18),transparent_62%)]" />
          <WaveMesh
            className="absolute -left-12 bottom-16 h-52 w-[44%] opacity-55"
            stroke="rgba(195,121,255,0.32)"
          />
          <WaveMesh
            className="absolute -right-12 bottom-10 h-52 w-[44%] scale-x-[-1] opacity-55"
            stroke="rgba(230,96,255,0.32)"
          />
        </div>

        <div className="relative mx-auto max-w-[1320px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-10">
          <div className="relative overflow-hidden rounded-[2.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(11,13,28,0.95),rgba(9,10,21,0.8))] px-5 pb-8 pt-10 shadow-[0_30px_120px_rgba(3,5,18,0.72)] sm:px-8 sm:pb-10 lg:px-10 lg:pb-12 lg:pt-14">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%)]" />

            <div className="relative z-10 mx-auto max-w-4xl text-center">
              <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-tight text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.16)] sm:text-5xl lg:text-[4rem] lg:leading-[1.03]">
                Институциональные токенизированные активы
              </h1>
              <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-white/68 sm:text-lg">
                Инвестируйте в недвижимость, облигации и сырьевые товары с
                институциональным качеством на блокчейне Solana.
              </p>
            </div>

            <div className="relative z-10 mt-10 lg:mt-12">
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

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="text-sm text-white/55">
              {formatResultsText(filteredListings.length, listings.length)}
            </p>
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-white/42">
              {selectedAssetType === "all" ? "Все активы" : getAssetFilterLabel(selectedAssetType)}
            </div>
          </div>

          {filteredListings.length === 0 ? (
            <div className="glass mt-8 rounded-[2rem] border border-white/10 bg-card/35 px-6 py-20 text-center shadow-[0_20px_80px_rgba(8,10,24,0.5)]">
              <Building2 className="mx-auto mb-4 h-16 w-16 text-white/18" />
              <p className="text-2xl font-semibold text-white">Активы не найдены</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/58">
                Измените тип актива или расширьте ценовой диапазон, чтобы увидеть больше
                институциональных предложений Fortis.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
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
