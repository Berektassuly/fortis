import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useListings } from "@/context/ListingsContext";
import Header from "@/components/Header";
import { ArrowLeft, Upload, Loader2 } from "lucide-react";

const cities = ["Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];

const CreateListing = () => {
  const { addListing } = useListings();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [city, setCity] = useState(cities[0]);
  const [rooms, setRooms] = useState("1");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(URL.createObjectURL(file));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !price.trim()) {
      alert("Заполните заголовок и цену");
      return;
    }

    setLoading(true);
    setTimeout(() => {
      addListing({
        title: title.trim(),
        price: Number(price),
        city,
        rooms: Number(rooms),
        photo,
        description: description.trim(),
      });
      setLoading(false);
      navigate("/");
    }, 800);
  };

  const inputClass =
    "w-full glass rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all bg-card text-foreground placeholder:text-muted-foreground";

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-xl">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>

        <h1 className="text-2xl font-bold mb-6 neon-text">Новое объявление</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            placeholder="Заголовок *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            maxLength={100}
          />

          <input
            type="number"
            placeholder="Цена ₸ *"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />

          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
          >
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            className={inputClass}
          >
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>{r} комн.</option>
            ))}
          </select>

          <label className="flex flex-col items-center justify-center gap-2 glass rounded-2xl p-6 cursor-pointer hover:border-primary/50 transition-all border-2 border-dashed border-border/50">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {photo ? "Фото загружено ✓" : "Загрузить фото"}
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            {photo && (
              <img src={photo} alt="Превью" className="mt-2 h-32 rounded-xl object-cover" />
            )}
          </label>

          <textarea
            placeholder="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={1000}
            className={inputClass + " resize-none"}
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/80 text-primary-foreground py-3 rounded-2xl font-medium transition-all duration-300 hover:neon-glow disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Публикация...
              </>
            ) : (
              "Опубликовать"
            )}
          </button>
        </form>
      </main>
    </div>
  );
};

export default CreateListing;
