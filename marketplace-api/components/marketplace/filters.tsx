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
    "pointer-events-none absolute inset-0 h-8 w-full appearance-none bg-transparent " +
    "[&::-webkit-slider-runnable-track]:h-[6px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_18px_rgba(0,229,255,0.75)] " +
    "[&::-moz-range-track]:h-[6px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-white/80 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_18px_rgba(0,229,255,0.75)]";

  function handleMinPriceChange(value: number) {
    const maxAllowed = Math.max(minPrice, selectedMaxPrice - sliderStep);
    onMinPriceChange(Math.min(value, maxAllowed));
  }

  function handleMaxPriceChange(value: number) {
    const minAllowed = Math.min(maxPrice, selectedMinPrice + sliderStep);
    onMaxPriceChange(Math.max(value, minAllowed));
  }

  return (
    <div className="rounded-[1.65rem] border border-white/10 bg-[rgba(255,255,255,0.05)] px-3.5 py-3 shadow-[0_24px_90px_rgba(3,8,24,0.34)] backdrop-blur-[28px] sm:px-4 sm:py-3.5">
      <div className="grid gap-3 lg:grid-cols-[1.18fr_0.82fr] lg:items-center">
        <div className="lg:border-r lg:border-white/10 lg:pr-5">
          <div className="flex flex-nowrap items-center gap-1 rounded-[1.25rem] border border-white/8 bg-black/20 p-1.5">
            {ASSET_FILTER_OPTIONS.map((option) => {
              const isActive = option.value === selectedAssetType;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onAssetTypeChange(option.value)}
                  className={[
                    "shrink-0 rounded-full border px-3 py-1.5 text-[0.84rem] font-medium transition-all duration-300 sm:px-3.5 sm:text-[0.86rem]",
                    isActive
                      ? "border-white/10 bg-[#151A28] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_rgba(255,255,255,0.05)]"
                      : "border-transparent text-white/62 hover:border-white/8 hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="rounded-[1.25rem] border border-white/8 bg-black/20 px-3.5 py-2.5 sm:px-4">
            <div className="relative">
              <div className="relative h-8">
                <div className="absolute left-0 right-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-white/10" />
                <div
                  className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,#00E5FF_0%,#3B82F6_100%)] shadow-[0_0_24px_rgba(0,229,255,0.48)]"
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

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
