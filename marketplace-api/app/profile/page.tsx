import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import { ArrowLeft, CircleUserRound, LayoutGrid, Wallet } from "lucide-react";

import Header from "@/components/marketplace/header";
import ListingCard from "@/components/marketplace/listing-card";
import { getPurchasedListingsForUser } from "@/lib/services/listings";
import { ServiceError } from "@/lib/services/service-error";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedMarketplaceContext } from "@/lib/supabase/server-auth";
import { shortenWalletAddress } from "@/lib/supabase/wallet-auth";
import type { MarketplaceListing } from "@/types/listing";
import { toMarketplaceListing } from "@/types/listing";

export default async function ProfilePage() {
  noStore();

  let walletAddress = "";
  let purchasedListings: MarketplaceListing[] = [];

  try {
    const supabase = createClient();
    const { marketplaceUser } = await requireAuthenticatedMarketplaceContext(supabase);

    walletAddress = marketplaceUser.solanaWalletAddress;
    purchasedListings = (await getPurchasedListingsForUser(supabase, marketplaceUser.id)).map(
      toMarketplaceListing,
    );
  } catch (error) {
    if (error instanceof ServiceError && error.statusCode === 401) {
      redirect("/login?next=/profile");
    }

    console.error("Failed to load the Fortis profile page", error);
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-transparent">
      <Header />

      <main className="relative overflow-hidden pb-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[880px] overflow-hidden">
          <div className="absolute left-1/2 top-16 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,229,255,0.18),transparent_58%)] blur-[110px]" />
          <div className="absolute left-1/2 top-24 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.18),transparent_62%)] blur-[120px]" />
        </div>

        <section className="relative mx-auto max-w-[1440px] px-4 pt-6 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,29,0.9),rgba(8,11,20,0.96))] p-6 shadow-[0_24px_90px_rgba(4,8,24,0.42)] backdrop-blur-[26px] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
                  Личный профиль
                </p>
                <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-white sm:text-5xl">
                  {walletAddress ? shortenWalletAddress(walletAddress) : "Портфель Fortis"}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/64 sm:text-base">
                  Здесь хранятся все активы, которые уже были куплены через Fortis. После
                  подтвержденной покупки актив исчезает с витрины маркетплейса и остается в этом
                  профиле владельца.
                </p>
              </div>

              <Link
                href="/"
                className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.09]"
              >
                <ArrowLeft className="h-4 w-4" />
                Вернуться к активам
              </Link>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/48">
                  <CircleUserRound className="h-4 w-4" />
                  Владелец
                </div>
                <p className="mt-3 text-lg font-semibold text-white">
                  {walletAddress ? shortenWalletAddress(walletAddress) : "Wallet unavailable"}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/48">
                  <Wallet className="h-4 w-4" />
                  Адрес кошелька
                </div>
                <p className="mt-3 break-all text-sm leading-6 text-white/74">
                  {walletAddress || "Wallet unavailable"}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/48">
                  <LayoutGrid className="h-4 w-4" />
                  Активов в профиле
                </div>
                <p className="mt-3 text-3xl font-bold text-white">{purchasedListings.length}</p>
              </div>
            </div>
          </div>

          {purchasedListings.length === 0 ? (
            <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.05] px-6 py-20 text-center shadow-[0_24px_90px_rgba(4,8,24,0.4)] backdrop-blur-[26px]">
              <CircleUserRound className="mx-auto mb-4 h-16 w-16 text-white/18" />
              <p className="text-2xl font-semibold text-white">В профиле пока нет активов</p>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-white/58">
                Когда покупка на маркетплейсе завершится успешно, актив автоматически исчезнет из
                общего списка и появится здесь.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              {purchasedListings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  actionLabel="В профиле"
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
