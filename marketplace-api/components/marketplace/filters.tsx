interface FiltersProps {
  city: string;
  onCityChange: (value: string) => void;
  rooms: string;
  onRoomsChange: (value: string) => void;
  maxPrice: string;
  onMaxPriceChange: (value: string) => void;
}

const cities = ["Все города", "Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];
const roomOptions = ["Любое", "1", "2", "3", "4", "5+"];

export default function Filters({
  city,
  onCityChange,
  rooms,
  onRoomsChange,
  maxPrice,
  onMaxPriceChange,
}: FiltersProps) {
  const selectClass =
    "glass appearance-none rounded-2xl bg-card px-4 py-2.5 text-sm text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/50";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select value={city} onChange={(event) => onCityChange(event.target.value)} className={selectClass}>
        {cities.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <select
        value={rooms}
        onChange={(event) => onRoomsChange(event.target.value)}
        className={selectClass}
      >
        <option value="">Комнаты</option>
        {roomOptions.map((item) => (
          <option key={item} value={item}>
            {item === "Любое" ? "Любое кол-во" : `${item} комн.`}
          </option>
        ))}
      </select>

      <input
        type="number"
        placeholder="Макс. цена ₸"
        value={maxPrice}
        onChange={(event) => onMaxPriceChange(event.target.value)}
        className="glass w-40 rounded-2xl bg-card px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}
