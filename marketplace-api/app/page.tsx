import { unstable_noStore as noStore } from "next/cache";

import Header from "@/components/marketplace/header";
import ListingsBrowser from "@/components/marketplace/listings-browser";
import { getListings } from "@/lib/services/listings";
import { createClient } from "@/lib/supabase/server";
import { toMarketplaceListing } from "@/types/listing";

export default async function HomePage() {
  noStore();

  let listings = [] as ReturnType<typeof toMarketplaceListing>[];

  try {
    const supabase = createClient();
    listings = (await getListings(supabase)).map(toMarketplaceListing);
  } catch (error) {
    console.error("Failed to load listings for the home page", error);
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <ListingsBrowser listings={listings} />
      </main>
    </div>
  );
}
