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
      "border-purple-300/55 bg-purple-500/16 text-purple-50 shadow-[0_0_14px_rgba(168,85,247,0.35)]",
    buttonClassName:
      "border-purple-400/45 bg-purple-500/10 text-purple-50 shadow-[inset_0_0_18px_rgba(168,85,247,0.18),0_0_16px_rgba(168,85,247,0.2)]",
    cardClassName:
      "border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.4)] hover:shadow-[0_0_28px_rgba(168,85,247,0.45)]",
    imageGlowClassName: "from-purple-500/20 via-transparent to-fuchsia-400/25",
    label: "Облигации",
    orbClassName: "bg-purple-500/20",
  },
  commodity: {
    badgeClassName:
      "border-yellow-300/55 bg-yellow-500/14 text-yellow-50 shadow-[0_0_14px_rgba(234,179,8,0.35)]",
    buttonClassName:
      "border-yellow-400/45 bg-yellow-500/10 text-yellow-50 shadow-[inset_0_0_18px_rgba(234,179,8,0.16),0_0_16px_rgba(234,179,8,0.22)]",
    cardClassName:
      "border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.4)] hover:shadow-[0_0_28px_rgba(234,179,8,0.45)]",
    imageGlowClassName: "from-yellow-400/22 via-transparent to-amber-500/28",
    label: "Товары",
    orbClassName: "bg-yellow-500/20",
  },
  equity: {
    badgeClassName:
      "border-green-300/55 bg-green-500/14 text-green-50 shadow-[0_0_14px_rgba(34,197,94,0.35)]",
    buttonClassName:
      "border-green-400/45 bg-green-500/10 text-green-50 shadow-[inset_0_0_18px_rgba(34,197,94,0.16),0_0_16px_rgba(34,197,94,0.22)]",
    cardClassName:
      "border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_28px_rgba(34,197,94,0.45)]",
    imageGlowClassName: "from-green-400/18 via-transparent to-emerald-500/24",
    label: "Акции",
    orbClassName: "bg-green-500/20",
  },
  real_estate: {
    badgeClassName:
      "border-blue-300/55 bg-blue-500/14 text-blue-50 shadow-[0_0_14px_rgba(59,130,246,0.35)]",
    buttonClassName:
      "border-blue-400/45 bg-blue-500/10 text-blue-50 shadow-[inset_0_0_18px_rgba(59,130,246,0.16),0_0_16px_rgba(59,130,246,0.2)]",
    cardClassName:
      "border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_28px_rgba(59,130,246,0.45)]",
    imageGlowClassName: "from-sky-400/18 via-transparent to-blue-500/22",
    label: "Недвижимость",
    orbClassName: "bg-blue-500/20",
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
  return `${value.toLocaleString("en-US")} USDT`;
}

function getListingMetrics(listing: MarketplaceListing) {
  const variations = LISTING_METRICS[listing.assetType];
  return variations[(listing.id - 1) % variations.length] ?? variations[0];
}

function getLocationLabel(listing: MarketplaceListing) {
  return listing.city ? `${listing.city} · Solana` : "Solana";
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
        "group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[2rem] border",
        "bg-[linear-gradient(180deg,rgba(17,19,35,0.92),rgba(8,10,20,0.92))] p-3 text-left backdrop-blur-xl transition-all duration-300",
        "hover:-translate-y-1.5",
        theme.cardClassName,
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-x-6 bottom-4 h-24 rounded-full blur-3xl">
        <div className={`h-full w-full rounded-full ${theme.orbClassName}`} />
      </div>

      <div className="relative overflow-hidden rounded-[1.4rem] border border-white/10">
        <img
          src={previewImage}
          alt={listing.title || theme.label}
          className="aspect-[1.08/1] h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-white/5" />
        <div
          className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${theme.imageGlowClassName}`}
        />

        {!listing.photo ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <FallbackIcon className="h-14 w-14 text-white/22" />
          </div>
        ) : null}

        <span
          className={[
            "absolute right-3 top-3 rounded-full border px-3 py-1 text-xs font-semibold",
            theme.badgeClassName,
          ].join(" ")}
        >
          {theme.label}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col px-2 pb-2 pt-4">
        <div className="mb-4">
          <h3 className="min-h-[3.25rem] text-[1.08rem] font-semibold leading-6 text-white">
            {listing.title}
          </h3>

          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-white/60">
            <MapPin className="h-3.5 w-3.5" />
            <span>{getLocationLabel(listing)}</span>
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <span className="text-white/58">Цена:</span>
          <span className="text-right font-medium text-white">{formatPrice(listing.price)}</span>

          <span className="text-white/58">Доходность:</span>
          <span className="text-right font-medium text-white">{metrics.yield}</span>

          <span className="text-white/58">Срок:</span>
          <span className="text-right font-medium text-white">{metrics.term}</span>

          <span className="text-white/58">Токенизировано:</span>
          <span className="text-right font-medium text-white">{metrics.tokenized}</span>
        </div>

        <span
          className={[
            "mt-5 flex min-h-12 w-full items-center justify-center rounded-[1rem] border px-4 text-base font-medium transition-all duration-300",
            theme.buttonClassName,
          ].join(" ")}
        >
          Купить
        </span>
      </div>
    </article>
  );
}
