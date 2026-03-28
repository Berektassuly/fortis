"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

import Filters from "@/components/marketplace/filters";
import ListingCard from "@/components/marketplace/listing-card";
import ListingModal from "@/components/marketplace/listing-modal";
import type { MarketplaceListing } from "@/types/listing";

interface ListingsBrowserProps {
  listings: MarketplaceListing[];
}

export default function ListingsBrowser({ listings }: ListingsBrowserProps) {
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [city, setCity] = useState("Все города");
  const [rooms, setRooms] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const filteredListings = listings.filter((listing) => {
    if (city !== "Все города" && listing.city !== city) {
      return false;
    }

    if (rooms && rooms !== "Любое" && listing.rooms !== Number(rooms.replace("+", ""))) {
      return false;
    }

    if (maxPrice && listing.price > Number(maxPrice)) {
      return false;
    }

    return true;
  });

  return (
    <>
      <div className="mb-8">
        <h1 className="neon-text mb-2 text-3xl font-bold">Недвижимость</h1>
        <p className="text-muted-foreground">Найдите идеальное жильё</p>
      </div>

      <div className="mb-8">
        <Filters
          city={city}
          onCityChange={setCity}
          rooms={rooms}
          onRoomsChange={setRooms}
          maxPrice={maxPrice}
          onMaxPriceChange={setMaxPrice}
        />
      </div>

      {filteredListings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Building2 className="mb-4 h-16 w-16 text-muted-foreground/40" />
          <p className="text-xl text-muted-foreground">Объявлений пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Нажмите «Подать объявление», чтобы добавить первое
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onClick={() => setSelectedListing(listing)}
            />
          ))}
        </div>
      )}

      {selectedListing ? (
        <ListingModal listing={selectedListing} onClose={() => setSelectedListing(null)} />
      ) : null}
    </>
  );
}
