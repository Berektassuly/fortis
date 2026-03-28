import { type Listing } from "@/context/ListingsContext";
import { X, MapPin, BedDouble } from "lucide-react";
import sampleImg from "@/assets/sample1.jpg";

interface Props {
  listing: Listing;
  onClose: () => void;
}

const ListingModal = ({ listing, onClose }: Props) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
      <div
        className="relative glass rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto neon-glow animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-muted/80 hover:bg-muted rounded-full p-2 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <img
          src={listing.photo || sampleImg}
          alt={listing.title}
          className="w-full aspect-video object-cover rounded-t-2xl"
        />

        <div className="p-6 space-y-4">
          <h2 className="text-2xl font-bold">{listing.title}</h2>
          <p className="text-3xl font-bold text-neon-blue neon-text-blue">
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

          {listing.description && (
            <div className="pt-4 border-t border-border/30">
              <h3 className="font-semibold mb-2">Описание</h3>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {listing.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListingModal;
