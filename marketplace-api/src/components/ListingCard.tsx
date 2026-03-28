import { type Listing } from "@/context/ListingsContext";
import { MapPin } from "lucide-react";
import sampleImg from "@/assets/sample1.jpg";

interface Props {
  listing: Listing;
  onClick: () => void;
}

const ListingCard = ({ listing, onClick }: Props) => {
  return (
    <button
      onClick={onClick}
      className="glass rounded-2xl overflow-hidden text-left transition-all duration-300 hover:scale-[1.03] hover:neon-glow-blue group w-full"
    >
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={listing.photo || sampleImg}
          alt={listing.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />
      </div>
      <div className="p-4 space-y-2">
        <h3 className="font-semibold text-foreground truncate">{listing.title}</h3>
        <p className="text-lg font-bold text-neon-blue neon-text-blue">
          {listing.price.toLocaleString("ru-RU")} ₸
        </p>
        <div className="flex items-center gap-1 text-muted-foreground text-sm">
          <MapPin className="h-3.5 w-3.5" />
          <span>{listing.city}</span>
          <span className="mx-1">·</span>
          <span>{listing.rooms} комн.</span>
        </div>
      </div>
    </button>
  );
};

export default ListingCard;
