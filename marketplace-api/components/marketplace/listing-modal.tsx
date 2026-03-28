"use client";

import { useEffect } from "react";
import { BedDouble, MapPin, X } from "lucide-react";

import type { MarketplaceListing } from "@/types/listing";

interface ListingModalProps {
  listing: MarketplaceListing;
  onClose: () => void;
}

export default function ListingModal({ listing, onClose }: ListingModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
            {listing.price.toLocaleString("ru-RU")} ₸
          </p>

          <div className="flex flex-wrap gap-4 text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              <span>{listing.city}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <BedDouble className="h-4 w-4" />
              <span>{listing.rooms} комнат(ы)</span>
            </div>
          </div>

          {listing.description ? (
            <div className="border-t border-border/30 pt-4">
              <h3 className="mb-2 font-semibold">Описание</h3>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {listing.description}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
