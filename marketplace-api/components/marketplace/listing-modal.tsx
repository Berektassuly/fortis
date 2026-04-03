"use client";

import bs58 from "bs58";
import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BedDouble,
  CheckCircle2,
  Landmark,
  LineChart,
  Loader2,
  Lock,
  MapPin,
  ShieldCheck,
  Warehouse,
  Wheat,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

import { fetchCurrentWalletProfile } from "@/lib/supabase/wallet-profile";
import type { MarketplaceAssetType, MarketplaceListing } from "@/types/listing";

type OrderStatusResponse = {
  bridgeDispatched?: boolean;
  errorMessage: string | null;
  fortisRequestId: string | null;
  id: number;
  status: string;
  txHash: string | null;
};

interface ListingModalProps {
  listing: MarketplaceListing;
  onClose: () => void;
}

type AssetTheme = {
  badgeClassName: string;
  containerClassName: string;
  label: string;
  priceClassName: string;
};

type AssetDetail = {
  icon: LucideIcon;
  label: string;
  value: string;
};

const ASSET_THEMES: Record<MarketplaceAssetType, AssetTheme> = {
  bond: {
    badgeClassName:
      "border-purple-300/55 bg-purple-500/16 text-purple-50 shadow-[0_0_18px_rgba(168,85,247,0.35)]",
    containerClassName:
      "border-purple-500/35 shadow-[0_0_36px_rgba(168,85,247,0.16),0_28px_90px_rgba(4,6,20,0.68)]",
    label: "Облигации",
    priceClassName: "text-purple-200 [text-shadow:0_0_22px_rgba(168,85,247,0.45)]",
  },
  commodity: {
    badgeClassName:
      "border-yellow-300/55 bg-yellow-500/16 text-yellow-50 shadow-[0_0_18px_rgba(234,179,8,0.35)]",
    containerClassName:
      "border-yellow-500/30 shadow-[0_0_36px_rgba(234,179,8,0.14),0_28px_90px_rgba(4,6,20,0.68)]",
    label: "Товары",
    priceClassName: "text-yellow-200 [text-shadow:0_0_22px_rgba(234,179,8,0.4)]",
  },
  equity: {
    badgeClassName:
      "border-green-300/55 bg-green-500/16 text-green-50 shadow-[0_0_18px_rgba(34,197,94,0.35)]",
    containerClassName:
      "border-green-500/30 shadow-[0_0_36px_rgba(34,197,94,0.14),0_28px_90px_rgba(4,6,20,0.68)]",
    label: "Акции",
    priceClassName: "text-emerald-200 [text-shadow:0_0_22px_rgba(34,197,94,0.42)]",
  },
  real_estate: {
    badgeClassName:
      "border-blue-300/55 bg-blue-500/16 text-blue-50 shadow-[0_0_18px_rgba(59,130,246,0.35)]",
    containerClassName:
      "border-blue-500/35 shadow-[0_0_36px_rgba(59,130,246,0.16),0_28px_90px_rgba(4,6,20,0.68)]",
    label: "Недвижимость",
    priceClassName: "text-cyan-200 [text-shadow:0_0_22px_rgba(34,211,238,0.5)]",
  },
};

function formatPrice(value: number) {
  return `${value.toLocaleString("en-US")} USDT`;
}

function formatOrderStatus(status: string) {
  switch (status) {
    case "Created":
      return "Создан";
    case "Pending":
      return "В обработке";
    case "Success":
      return "Исполнен";
    case "Failed":
      return "Ошибка";
    default:
      return status;
  }
}

function getAssetIcon(assetType: MarketplaceAssetType) {
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

function getAssetDetails(listing: MarketplaceListing): AssetDetail[] {
  if (listing.assetType === "real_estate") {
    return [
      { icon: MapPin, label: "Локация", value: listing.city },
      { icon: BedDouble, label: "Параметры", value: `${listing.rooms} комнат(ы)` },
      { icon: ShieldCheck, label: "Комплаенс", value: "Fortis Verified" },
      { icon: Warehouse, label: "Сеть", value: "Solana / Token-2022" },
    ];
  }

  return [
    { icon: ShieldCheck, label: "Токенизировано", value: "100%" },
    { icon: Lock, label: "Комплаенс", value: "Fortis Verified" },
    { icon: getAssetIcon(listing.assetType), label: "Тип актива", value: ASSET_THEMES[listing.assetType].label },
    { icon: Warehouse, label: "Сеть", value: "Solana / Token-2022" },
  ];
}

export default function ListingModal({ listing, onClose }: ListingModalProps) {
  const router = useRouter();
  const { connected, publicKey, signMessage } = useWallet();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const theme = ASSET_THEMES[listing.assetType];
  const previewImage = getPreviewImage(listing);
  const details = getAssetDetails(listing);
  const AssetIcon = getAssetIcon(listing.assetType);

  const finalizeSuccessfulPurchase = useCallback(() => {
    toast.success("Покупка завершена. Актив перенесен в ваш профиль.");
    onClose();
    router.push("/profile");
  }, [onClose, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!order?.id || order.status === "Success" || order.status === "Failed") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetch(`/api/orders/${order.id}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? "Не удалось обновить статус покупки.");
          }

          return (await response.json()) as OrderStatusResponse;
        })
        .then((nextOrder) => {
          setOrder(nextOrder);

          if (nextOrder.status === "Success") {
            finalizeSuccessfulPurchase();
          } else if (nextOrder.status === "Failed") {
            toast.error(nextOrder.errorMessage ?? "Покупка актива Fortis завершилась ошибкой.");
          }
        })
        .catch((error) => {
          console.error(error);
        });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [finalizeSuccessfulPurchase, order]);

  async function requireMatchingWalletSession(walletAddress: string) {
    const profile = await fetchCurrentWalletProfile();

    if (!profile) {
      throw new Error("Сессия Fortis истекла. Войдите через кошелек снова.");
    }

    if (profile.solanaWalletAddress !== walletAddress) {
      throw new Error(
        "Подключенный кошелек не совпадает с текущей Fortis wallet-сессией.",
      );
    }
  }

  async function handleBuy() {
    if (!listing.tokenMintAddress) {
      toast.error("Для этого актива еще не выпущен токен.");
      return;
    }

    if (!connected || !publicKey) {
      toast.error("Подключите Solana-кошелек перед покупкой.");
      return;
    }

    if (!signMessage) {
      toast.error("Этот кошелек не поддерживает подписание сообщений.");
      return;
    }

    setIsPurchasing(true);

    try {
      const walletAddress = publicKey.toBase58();
      await requireMatchingWalletSession(walletAddress);

      const amount = 1;
      const nonce = crypto.randomUUID();
      const message = `${walletAddress}:${walletAddress}:${amount}:${listing.tokenMintAddress}:${nonce}`;
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = bs58.encode(signatureBytes);

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          listingId: listing.id,
          transferIntent: {
            amount,
            fromAddress: walletAddress,
            mint: listing.tokenMintAddress,
            nonce,
            signature,
            toAddress: walletAddress,
          },
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | ({ error?: string } & Partial<OrderStatusResponse>)
        | null;

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login?next=/");
        }

        throw new Error(body?.error ?? "Не удалось создать ордер Fortis на покупку.");
      }

      const nextOrder = body as OrderStatusResponse;
      setOrder(nextOrder);

      if (!nextOrder.bridgeDispatched) {
        toast.error(nextOrder.errorMessage ?? "Намерение о покупке не было принято.");
        return;
      }

      if (nextOrder.status === "Success") {
        finalizeSuccessfulPurchase();
        return;
      }

      toast.success("Намерение о покупке подписано. Fortis выполняет перевод актива.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Не удалось купить этот актив.");
    } finally {
      setIsPurchasing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-background/85 backdrop-blur-xl" />

      <div
        className={[
          "glass relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] border bg-[linear-gradient(180deg,rgba(15,18,33,0.94),rgba(8,10,20,0.96))] backdrop-blur-2xl",
          theme.containerClassName,
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),transparent_42%)]" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-black/20 p-2.5 text-white/80 backdrop-blur-md transition-all hover:border-white/20 hover:bg-black/35 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative">
          <img
            src={previewImage}
            alt={listing.title || theme.label}
            className="h-[300px] w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
            <div className="mb-4 flex items-center justify-between gap-4">
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
                  theme.badgeClassName,
                ].join(" ")}
              >
                <AssetIcon className="h-3.5 w-3.5" />
                {theme.label}
              </span>

              <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/55 backdrop-blur-md">
                Solana
              </div>
            </div>

            <div className="max-w-2xl space-y-3">
              <h2 className="text-3xl font-semibold text-white sm:text-[2.2rem]">{listing.title}</h2>
              <p className={`text-4xl font-bold sm:text-[2.75rem] ${theme.priceClassName}`}>
                {formatPrice(listing.price)}
              </p>
            </div>
          </div>
        </div>

        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {details.map((detail) => {
              const Icon = detail.icon;

              return (
                <div
                  key={`${detail.label}-${detail.value}`}
                  className="rounded-[1.4rem] border border-white/8 bg-white/5 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-white/55">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-[0.18em]">{detail.label}</span>
                  </div>
                  <p className="text-sm font-medium text-white">{detail.value}</p>
                </div>
              );
            })}
          </div>

          {listing.description ? (
            <div className="rounded-[1.6rem] border border-white/8 bg-white/5 p-5">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                Описание актива
              </h3>
              <p className="whitespace-pre-wrap leading-7 text-white/72">{listing.description}</p>
            </div>
          ) : null}

          <div className="rounded-[1.6rem] border border-white/8 bg-white/5 p-5">
            <button
              type="button"
              onClick={() => void handleBuy()}
              disabled={isPurchasing || order?.status === "Success"}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] hover:neon-glow disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPurchasing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Подготовка транзакции...
                </>
              ) : order?.status === "Success" ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Куплено
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Купить актив
                </>
              )}
            </button>

            <p className="mt-3 text-sm leading-6 text-white/58">
              {order
                ? `Статус ордера: ${formatOrderStatus(order.status)}${
                    order.txHash ? ` (${order.txHash.slice(0, 12)}...)` : ""
                  }`
                : "Ваш кошелек подпишет намерение о покупке. Смарт-контракт Fortis автоматически проверит комплаенс перед переводом актива."}
            </p>

            {order?.errorMessage ? (
              <p className="mt-2 text-sm text-destructive">{order.errorMessage}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
