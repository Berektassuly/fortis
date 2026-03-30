import { ChevronDown } from "lucide-react";

import type { MarketplaceAssetFilter } from "@/types/listing";

export const ASSET_FILTER_OPTIONS = [
  { label: "Все", value: "all" },
  { label: "Облигации", value: "bond" },
  { label: "Недвижимость", value: "real_estate" },
  { label: "Товары", value: "commodity" },
  { label: "Акции", value: "equity" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: MarketplaceAssetFilter;
}>;

interface FiltersProps {
  maxPrice: number;
  minPrice: number;
  onAssetTypeChange: (value: MarketplaceAssetFilter) => void;
  onMaxPriceChange: (value: number) => void;
  onMinPriceChange: (value: number) => void;
  selectedAssetType: MarketplaceAssetFilter;
  selectedMaxPrice: number;
  selectedMinPrice: number;
}

function formatCompactPrice(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value)} USDT`;
}

function formatExactPrice(value: number) {
  return `${value.toLocaleString("en-US")} USDT`;
}

function getSliderStep(minPrice: number, maxPrice: number) {
  const priceSpan = Math.max(maxPrice - minPrice, 1);

  if (priceSpan > 5_000_000) {
    return 100_000;
  }

  if (priceSpan > 1_000_000) {
    return 25_000;
  }

  if (priceSpan > 250_000) {
    return 10_000;
  }

  return 1_000;
}

export default function Filters({
  maxPrice,
  minPrice,
  onAssetTypeChange,
  onMaxPriceChange,
  onMinPriceChange,
  selectedAssetType,
  selectedMaxPrice,
  selectedMinPrice,
}: FiltersProps) {
  const sliderStep = getSliderStep(minPrice, maxPrice);
  const sliderRange = Math.max(maxPrice - minPrice, 1);
  const leftPercentage = ((selectedMinPrice - minPrice) / sliderRange) * 100;
  const rightPercentage = ((selectedMaxPrice - minPrice) / sliderRange) * 100;
  const sliderClassName =
    "pointer-events-none absolute inset-0 h-10 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_16px_rgba(56,189,248,0.75)] " +
    "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_16px_rgba(56,189,248,0.75)]";

  function handleMinPriceChange(value: number) {
    const maxAllowed = Math.max(minPrice, selectedMaxPrice - sliderStep);
    onMinPriceChange(Math.min(value, maxAllowed));
  }

  function handleMaxPriceChange(value: number) {
    const minAllowed = Math.min(maxPrice, selectedMinPrice + sliderStep);
    onMaxPriceChange(Math.max(value, minAllowed));
  }

  return (
    <div className="glass rounded-[2rem] border border-white/10 bg-card/40 p-5 shadow-[0_20px_90px_rgba(8,11,29,0.55)] sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end">
        <div className="space-y-3">
          <p className="text-sm font-medium text-white/80">Тип актива</p>

          <div className="rounded-[1.45rem] border border-white/10 bg-black/25 p-1.5">
            <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
              {ASSET_FILTER_OPTIONS.map((option) => {
                const isActive = option.value === selectedAssetType;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onAssetTypeChange(option.value)}
                    className={[
                      "rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-300",
                      isActive
                        ? "bg-white/14 text-white shadow-[0_0_22px_rgba(255,255,255,0.12)]"
                        : "text-white/72 hover:bg-white/8 hover:text-white",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                );
              })}

              <div className="ml-auto hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/55 sm:flex">
                <ChevronDown className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-white/80">Цена</p>
            <p className="text-xs text-white/55">
              {formatExactPrice(selectedMinPrice)} - {formatExactPrice(selectedMaxPrice)}
            </p>
          </div>

          <div className="rounded-[1.45rem] border border-white/10 bg-black/25 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="min-w-[4.5rem] text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                {formatCompactPrice(minPrice)}
              </span>

              <div className="relative h-10 flex-1">
                <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/10" />
                <div
                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-neon-blue shadow-[0_0_20px_rgba(59,130,246,0.65)]"
                  style={{
                    left: `${leftPercentage}%`,
                    width: `${Math.max(rightPercentage - leftPercentage, 0)}%`,
                  }}
                />

                <input
                  type="range"
                  min={minPrice}
                  max={maxPrice}
                  step={sliderStep}
                  value={selectedMinPrice}
                  aria-label="Минимальная цена"
                  onChange={(event) => handleMinPriceChange(Number(event.target.value))}
                  className={`${sliderClassName} z-10`}
                />
                <input
                  type="range"
                  min={minPrice}
                  max={maxPrice}
                  step={sliderStep}
                  value={selectedMaxPrice}
                  aria-label="Максимальная цена"
                  onChange={(event) => handleMaxPriceChange(Number(event.target.value))}
                  className={`${sliderClassName} z-20`}
                />
              </div>

              <span className="min-w-[4.5rem] text-right text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                {formatCompactPrice(maxPrice)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
