import { unstable_noStore as noStore } from "next/cache";

import Header from "@/components/marketplace/header";
import ListingsBrowser from "@/components/marketplace/listings-browser";
import { getListings } from "@/lib/services/listings";
import { toMarketplaceListing } from "@/types/listing";

export default async function HomePage() {
  noStore();

  const listings = (await getListings()).map(toMarketplaceListing);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <ListingsBrowser listings={listings} />
      </main>
    </div>
  );
}
