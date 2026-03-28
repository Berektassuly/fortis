const cities = ["Все города", "Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];
const roomOptions = ["Любое", "1", "2", "3", "4", "5+"];

interface Props {
  city: string;
  setCity: (v: string) => void;
  rooms: string;
  setRooms: (v: string) => void;
  maxPrice: string;
  setMaxPrice: (v: string) => void;
}

const Filters = ({ city, setCity, rooms, setRooms, maxPrice, setMaxPrice }: Props) => {
  const selectClass =
    "glass rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none bg-card text-foreground";

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <select value={city} onChange={(e) => setCity(e.target.value)} className={selectClass}>
        {cities.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <select value={rooms} onChange={(e) => setRooms(e.target.value)} className={selectClass}>
        <option value="">Комнаты</option>
        {roomOptions.map((r) => (
          <option key={r} value={r}>{r === "Любое" ? "Любое кол-во" : `${r} комн.`}</option>
        ))}
      </select>

      <input
        type="number"
        placeholder="Макс. цена ₸"
        value={maxPrice}
        onChange={(e) => setMaxPrice(e.target.value)}
        className="glass rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all w-40 bg-card text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
};

export default Filters;
