"use client";

import bs58 from "bs58";
import { useEffect, useState } from "react";
import { BedDouble, MapPin, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

import type { MarketplaceListing } from "@/types/listing";

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

export default function ListingModal({ listing, onClose }: ListingModalProps) {
  const router = useRouter();
  const { connected, publicKey, signMessage } = useWallet();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);

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
            throw new Error(body?.error ?? "Failed to refresh the purchase status.");
          }

          return (await response.json()) as OrderStatusResponse;
        })
        .then((nextOrder) => {
          setOrder(nextOrder);

          if (nextOrder.status === "Success") {
            toast.success("Purchase completed successfully.");
            router.refresh();
          } else if (nextOrder.status === "Failed") {
            toast.error(nextOrder.errorMessage ?? "The Fortis purchase flow failed.");
          }
        })
        .catch((error) => {
          console.error(error);
        });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [order, router]);

  async function ensureWalletBound(walletAddress: string) {
    const response = await fetch("/api/me/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        walletAddress,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to link the connected wallet.");
    }
  }

  async function handleBuy() {
    if (!listing.tokenMintAddress) {
      toast.error("This listing is still missing its token mint.");
      return;
    }

    if (!connected || !publicKey) {
      toast.error("Connect your Solana wallet before buying.");
      return;
    }

    if (!signMessage) {
      toast.error("This wallet does not support message signing.");
      return;
    }

    setIsPurchasing(true);

    try {
      const walletAddress = publicKey.toBase58();
      await ensureWalletBound(walletAddress);

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

        throw new Error(body?.error ?? "Failed to create the Fortis purchase order.");
      }

      const nextOrder = body as OrderStatusResponse;
      setOrder(nextOrder);

      if (!nextOrder.bridgeDispatched) {
        toast.error(nextOrder.errorMessage ?? "The purchase intent was not accepted.");
        return;
      }

      toast.success("Purchase intent signed. Fortis is processing the transfer.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to buy this listing.");
    } finally {
      setIsPurchasing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
      <div
        className="glass neon-glow relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full bg-muted/80 p-2 transition-colors hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>

        <img
          src={listing.photo ?? "/sample1.jpg"}
          alt={listing.title}
          className="aspect-video w-full rounded-t-2xl object-cover"
        />

        <div className="space-y-4 p-6">
          <h2 className="text-2xl font-bold">{listing.title}</h2>
          <p className="neon-text-blue text-3xl font-bold text-neon-blue">
            {listing.price.toLocaleString("ru-RU")} â‚¸
          </p>

          <div className="flex flex-wrap gap-4 text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              <span>{listing.city}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <BedDouble className="h-4 w-4" />
              <span>{listing.rooms} ÐºÐ¾Ð¼Ð½Ð°Ñ‚(Ñ‹)</span>
            </div>
          </div>

          {listing.description ? (
            <div className="border-t border-border/30 pt-4">
              <h3 className="mb-2 font-semibold">ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ</h3>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {listing.description}
              </p>
            </div>
          ) : null}

          <div className="border-t border-border/30 pt-4">
            <button
              type="button"
              onClick={() => void handleBuy()}
              disabled={isPurchasing || order?.status === "Success"}
              className="flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPurchasing ? "Preparing purchase..." : order?.status === "Success" ? "Purchased" : "Buy"}
            </button>

            <p className="mt-3 text-sm text-muted-foreground">
              {order
                ? `Order status: ${order.status}${order.txHash ? ` (${order.txHash.slice(0, 12)}...)` : ""}`
                : "Your wallet will sign a Fortis purchase intent before the compliant transfer is orchestrated."}
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
