import type { KeyboardEvent } from "react";
import { Landmark, LineChart, MapPin, Warehouse, Wheat } from "lucide-react";

import type { MarketplaceAssetType, MarketplaceListing } from "@/types/listing";

interface ListingCardProps {
  listing: MarketplaceListing;
  onClick: () => void;
}

type AssetTheme = {
  badgeClassName: string;
  buttonClassName: string;
  cardClassName: string;
  imageGlowClassName: string;
  label: string;
  orbClassName: string;
};

const ASSET_THEMES: Record<MarketplaceAssetType, AssetTheme> = {
  bond: {
    badgeClassName:
      "border-[#A855F7]/55 bg-[#A855F7]/12 text-white shadow-[0_0_18px_rgba(168,85,247,0.28)]",
    buttonClassName:
      "border-[#A855F7]/70 shadow-[0_0_24px_rgba(168,85,247,0.16)] hover:bg-[#A855F7]/8",
    cardClassName:
      "border-[#A855F7]/40 shadow-[0_0_0_1px_rgba(168,85,247,0.14),0_26px_70px_rgba(63,28,98,0.28)] hover:shadow-[0_0_0_1px_rgba(168,85,247,0.24),0_32px_92px_rgba(84,34,132,0.34)]",
    imageGlowClassName: "bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.28),transparent_68%)]",
    label: "Облигации",
    orbClassName: "bg-[radial-gradient(circle,rgba(168,85,247,0.24)_0%,transparent_72%)]",
  },
  commodity: {
    badgeClassName:
      "border-[#EAB308]/55 bg-[#EAB308]/12 text-white shadow-[0_0_18px_rgba(234,179,8,0.24)]",
    buttonClassName:
      "border-[#EAB308]/70 shadow-[0_0_24px_rgba(234,179,8,0.16)] hover:bg-[#EAB308]/8",
    cardClassName:
      "border-[#EAB308]/40 shadow-[0_0_0_1px_rgba(234,179,8,0.14),0_26px_70px_rgba(103,74,12,0.24)] hover:shadow-[0_0_0_1px_rgba(234,179,8,0.24),0_32px_92px_rgba(128,93,18,0.32)]",
    imageGlowClassName: "bg-[radial-gradient(circle_at_center,rgba(234,179,8,0.26),transparent_70%)]",
    label: "Товары",
    orbClassName: "bg-[radial-gradient(circle,rgba(234,179,8,0.22)_0%,transparent_72%)]",
  },
  equity: {
    badgeClassName:
      "border-[#22C55E]/55 bg-[#22C55E]/12 text-white shadow-[0_0_18px_rgba(34,197,94,0.24)]",
    buttonClassName:
      "border-[#22C55E]/70 shadow-[0_0_24px_rgba(34,197,94,0.16)] hover:bg-[#22C55E]/8",
    cardClassName:
      "border-[#22C55E]/40 shadow-[0_0_0_1px_rgba(34,197,94,0.14),0_26px_70px_rgba(20,86,53,0.26)] hover:shadow-[0_0_0_1px_rgba(34,197,94,0.24),0_32px_92px_rgba(24,113,68,0.32)]",
    imageGlowClassName: "bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.24),transparent_70%)]",
    label: "Акции",
    orbClassName: "bg-[radial-gradient(circle,rgba(34,197,94,0.22)_0%,transparent_72%)]",
  },
  real_estate: {
    badgeClassName:
      "border-[#3B82F6]/55 bg-[#3B82F6]/12 text-white shadow-[0_0_18px_rgba(59,130,246,0.26)]",
    buttonClassName:
      "border-[#3B82F6]/70 shadow-[0_0_24px_rgba(59,130,246,0.16)] hover:bg-[#3B82F6]/8",
    cardClassName:
      "border-[#3B82F6]/40 shadow-[0_0_0_1px_rgba(59,130,246,0.14),0_26px_70px_rgba(18,58,122,0.28)] hover:shadow-[0_0_0_1px_rgba(59,130,246,0.24),0_32px_92px_rgba(24,79,162,0.34)]",
    imageGlowClassName: "bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.28),transparent_68%)]",
    label: "Недвижимость",
    orbClassName: "bg-[radial-gradient(circle,rgba(59,130,246,0.24)_0%,transparent_72%)]",
  },
};

const LISTING_METRICS: Record<
  MarketplaceAssetType,
  ReadonlyArray<{
    term: string;
    tokenized: string;
    yield: string;
  }>
> = {
  bond: [
    { term: "5 лет", tokenized: "50%", yield: "7.5% годовых" },
    { term: "7 лет", tokenized: "64%", yield: "8.1% годовых" },
    { term: "4 года", tokenized: "42%", yield: "6.9% годовых" },
  ],
  commodity: [
    { term: "3 года", tokenized: "48%", yield: "6.8% годовых" },
    { term: "5 лет", tokenized: "55%", yield: "7.2% годовых" },
    { term: "2 года", tokenized: "38%", yield: "5.9% годовых" },
  ],
  equity: [
    { term: "4 года", tokenized: "35%", yield: "12.3% годовых" },
    { term: "6 лет", tokenized: "41%", yield: "10.8% годовых" },
    { term: "3 года", tokenized: "29%", yield: "13.7% годовых" },
  ],
  real_estate: [
    { term: "7 лет", tokenized: "62%", yield: "8.4% годовых" },
    { term: "5 лет", tokenized: "57%", yield: "9.1% годовых" },
    { term: "8 лет", tokenized: "68%", yield: "7.8% годовых" },
  ],
};

function formatPrice(value: number) {
  return `${value.toLocaleString("ru-RU")} USDT`;
}

function getListingMetrics(listing: MarketplaceListing) {
  const variations = LISTING_METRICS[listing.assetType];
  return variations[(listing.id - 1) % variations.length] ?? variations[0];
}

function getLocationLabel(listing: MarketplaceListing) {
  return listing.city || "Solana";
}

function getFallbackArtwork(assetType: MarketplaceAssetType) {
  const svgByType: Record<MarketplaceAssetType, string> = {
    bond: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" fill="none">
        <defs>
          <linearGradient id="bg" x1="30" y1="20" x2="610" y2="420" gradientUnits="userSpaceOnUse">
            <stop stop-color="#9F67FF"/>
            <stop offset="1" stop-color="#241247"/>
          </linearGradient>
        </defs>
        <rect width="640" height="440" rx="40" fill="url(#bg)"/>
        <rect x="74" y="150" width="120" height="220" rx="18" fill="rgba(255,255,255,0.16)"/>
        <rect x="216" y="98" width="122" height="272" rx="18" fill="rgba(255,255,255,0.22)"/>
        <rect x="360" y="52" width="152" height="318" rx="18" fill="rgba(255,255,255,0.18)"/>
        <path d="M94 188h80M94 228h80M94 268h80M94 308h80M236 136h82M236 182h82M236 228h82M236 274h82M380 96h112M380 148h112M380 200h112M380 252h112M380 304h112" stroke="rgba(255,255,255,0.22)" stroke-width="10" stroke-linecap="round"/>
      </svg>`,
    commodity: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" fill="none">
        <defs>
          <linearGradient id="bg" x1="52" y1="18" x2="594" y2="430" gradientUnits="userSpaceOnUse">
            <stop stop-color="#F8D66D"/>
            <stop offset="1" stop-color="#4A2C0B"/>
          </linearGradient>
        </defs>
        <rect width="640" height="440" rx="40" fill="url(#bg)"/>
        <g fill="rgba(255,230,153,0.78)" stroke="rgba(119,74,12,0.75)" stroke-width="10">
          <path d="M92 246l106-58 108 36-105 58-109-36Z"/>
          <path d="M198 188l77-100 109 37-78 99-108-36Z"/>
          <path d="M306 224l78-99 124 44-78 99-124-44Z"/>
          <path d="M248 282l105-58 116 40-104 58-117-40Z"/>
        </g>
      </svg>`,
    equity: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" fill="none">
        <defs>
          <linearGradient id="bg" x1="52" y1="24" x2="604" y2="414" gradientUnits="userSpaceOnUse">
            <stop stop-color="#1A5E41"/>
            <stop offset="1" stop-color="#071B17"/>
          </linearGradient>
        </defs>
        <rect width="640" height="440" rx="40" fill="url(#bg)"/>
        <path d="M74 334H566M74 280H566M74 226H566M74 172H566M74 118H566" stroke="rgba(255,255,255,0.1)" stroke-width="6"/>
        <path d="M96 308L176 286L238 214L294 236L364 162L428 182L494 118L544 132" stroke="#79FFB7" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M96 308L176 286L238 214L294 236L364 162L428 182L494 118L544 132" stroke="rgba(121,255,183,0.34)" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    real_estate: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" fill="none">
        <defs>
          <linearGradient id="bg" x1="58" y1="22" x2="598" y2="414" gradientUnits="userSpaceOnUse">
            <stop stop-color="#79C6FF"/>
            <stop offset="1" stop-color="#123260"/>
          </linearGradient>
        </defs>
        <rect width="640" height="440" rx="40" fill="url(#bg)"/>
        <path d="M118 332h404" stroke="rgba(255,255,255,0.22)" stroke-width="10" stroke-linecap="round"/>
        <path d="M170 332V176l152-84 148 84v156" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.35)" stroke-width="10"/>
        <path d="M262 332V214h116v118" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.35)" stroke-width="10"/>
        <path d="M250 156c22-38 64-60 110-60 45 0 87 22 110 60" stroke="rgba(255,255,255,0.45)" stroke-width="12" stroke-linecap="round"/>
        <path d="M220 214h204M220 250h204M220 286h204" stroke="rgba(255,255,255,0.18)" stroke-width="8" stroke-linecap="round"/>
      </svg>`,
  };

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgByType[assetType])}`;
}

function getPreviewImage(listing: MarketplaceListing) {
  return listing.photo ?? getFallbackArtwork(listing.assetType);
}

function getFallbackIcon(assetType: MarketplaceAssetType) {
  switch (assetType) {
    case "bond":
      return Landmark;
    case "commodity":
      return Wheat;
    case "equity":
      return LineChart;
    case "real_estate":
      return Warehouse;
  }
}

export default function ListingCard({ listing, onClick }: ListingCardProps) {
  const theme = ASSET_THEMES[listing.assetType];
  const metrics = getListingMetrics(listing);
  const previewImage = getPreviewImage(listing);
  const FallbackIcon = getFallbackIcon(listing.assetType);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={[
        "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[1.9rem] border",
        "bg-[linear-gradient(180deg,rgba(14,18,31,0.9),rgba(8,11,20,0.94))] p-3 text-left backdrop-blur-[26px] transition-all duration-300",
        "hover:-translate-y-1.5",
        theme.cardClassName,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-x-6 bottom-4 h-24 rounded-full blur-3xl">
        <div className={`h-full w-full rounded-full ${theme.orbClassName}`} />
      </div>

      <div className="relative overflow-hidden rounded-[1.45rem] border border-white/10">
        <div className={`pointer-events-none absolute inset-0 ${theme.imageGlowClassName}`} />
        <img
          src={previewImage}
          alt={listing.title || theme.label}
          className="aspect-[1.08/1] h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#080B14] via-black/10 to-white/5" />

        {!listing.photo ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <FallbackIcon className="h-14 w-14 text-white/20" />
          </div>
        ) : null}

        <span
          className={[
            "absolute right-3 top-3 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-md",
            theme.badgeClassName,
          ].join(" ")}
        >
          {theme.label}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col px-2 pb-2 pt-4">
        <div className="mb-5">
          <h3 className="min-h-[3.5rem] text-[1.12rem] font-semibold leading-6 text-white">
            {listing.title}
          </h3>

          <div className="mt-2 flex items-center gap-1.5 text-sm text-white/58">
            <MapPin className="h-3.5 w-3.5" />
            <span>{getLocationLabel(listing)}</span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4 text-sm">
          <span className="text-white/50">Цена</span>
          <span className="text-right font-medium text-white">{formatPrice(listing.price)}</span>

          <span className="text-white/50">Доходность</span>
          <span className="text-right font-medium text-white">{metrics.yield}</span>

          <span className="text-white/50">Срок погашения</span>
          <span className="text-right font-medium text-white">{metrics.term}</span>

          <span className="text-white/50">Токенизировано</span>
          <span className="text-right font-medium text-white">{metrics.tokenized}</span>
        </div>

        <span
          className={[
            "mt-5 flex min-h-12 w-full items-center justify-center rounded-[1rem] border bg-transparent px-4 text-base font-medium text-white transition-all duration-300",
            theme.buttonClassName,
          ].join(" ")}
        >
          Купить
        </span>
      </div>
    </article>
  );
}
