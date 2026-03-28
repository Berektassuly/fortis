import { MapPin } from "lucide-react";

import type { MarketplaceListing } from "@/types/listing";

interface ListingCardProps {
  listing: MarketplaceListing;
  onClick: () => void;
}

export default function ListingCard({ listing, onClick }: ListingCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass group w-full overflow-hidden rounded-2xl text-left transition-all duration-300 hover:scale-[1.03] hover:neon-glow-blue"
    >
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={listing.photo ?? "/sample1.jpg"}
          alt={listing.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />
      </div>
      <div className="space-y-2 p-4">
        <h3 className="truncate font-semibold text-foreground">{listing.title}</h3>
        <p className="neon-text-blue text-lg font-bold text-neon-blue">
          {listing.price.toLocaleString("ru-RU")} ₸
        </p>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          <span>{listing.city}</span>
          <span className="mx-1">·</span>
          <span>{listing.rooms} комн.</span>
        </div>
      </div>
    </button>
  );
}
