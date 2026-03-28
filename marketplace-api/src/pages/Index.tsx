import { useState } from "react";
import { useListings, type Listing } from "@/context/ListingsContext";
import Header from "@/components/Header";
import Filters from "@/components/Filters";
import ListingCard from "@/components/ListingCard";
import ListingModal from "@/components/ListingModal";
import { Building2 } from "lucide-react";

const Index = () => {
  const { listings } = useListings();
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

  const [city, setCity] = useState("Все города");
  const [rooms, setRooms] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const filtered = listings.filter((l) => {
    if (city !== "Все города" && l.city !== city) return false;
    if (rooms && rooms !== "Любое" && l.rooms !== Number(rooms.replace("+", ""))) return false;
    if (maxPrice && l.price > Number(maxPrice)) return false;
    return true;
  });

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 neon-text">Недвижимость</h1>
          <p className="text-muted-foreground">Найдите идеальное жильё</p>
        </div>

        <div className="mb-8">
          <Filters
            city={city}
            setCity={setCity}
            rooms={rooms}
            setRooms={setRooms}
            maxPrice={maxPrice}
            setMaxPrice={setMaxPrice}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Building2 className="h-16 w-16 text-muted-foreground/40 mb-4" />
            <p className="text-xl text-muted-foreground">Объявлений пока нет</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Нажмите «Подать объявление», чтобы добавить первое
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={() => setSelectedListing(listing)}
              />
            ))}
          </div>
        )}
      </main>

      {selectedListing && (
        <ListingModal
          listing={selectedListing}
          onClose={() => setSelectedListing(null)}
        />
      )}
    </div>
  );
};

export default Index;
