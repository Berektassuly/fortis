"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

const cities = ["Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function CreateListingForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [city, setCity] = useState(cities[0]);
  const [rooms, setRooms] = useState("1");
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  const inputClass =
    "w-full glass rounded-2xl bg-card px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/50";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !price.trim()) {
      toast.error("Заполните заголовок и цену");
      return;
    }

    try {
      setIsSubmitting(true);

      let photo: string | null = null;
      if (photoFile) {
        photo = await fileToDataUrl(photoFile);
      }

      const response = await fetch("/api/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          price: Number(price),
          city,
          rooms: Number(rooms),
          photo,
          description: description.trim() || null,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Не удалось опубликовать объявление");
        return;
      }

      toast.success("Объявление опубликовано");
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } catch (error) {
      console.error(error);
      toast.error("Не удалось опубликовать объявление");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        placeholder="Заголовок *"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className={inputClass}
        maxLength={100}
      />

      <input
        type="number"
        placeholder="Цена ₸ *"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        className={inputClass}
      />

      <select value={city} onChange={(event) => setCity(event.target.value)} className={inputClass}>
        {cities.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <select value={rooms} onChange={(event) => setRooms(event.target.value)} className={inputClass}>
        {[1, 2, 3, 4, 5].map((item) => (
          <option key={item} value={item}>
            {item} комн.
          </option>
        ))}
      </select>

      <label className="glass flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/50 p-6 transition-all hover:border-primary/50">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {previewUrl ? "Фото загружено" : "Загрузить фото"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
        />
        {previewUrl ? (
          <img src={previewUrl} alt="Превью" className="mt-2 h-32 rounded-xl object-cover" />
        ) : null}
      </label>

      <textarea
        placeholder="Описание"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={4}
        maxLength={1000}
        className={`${inputClass} resize-none`}
      />

      <button
        type="submit"
        disabled={isSubmitting || isPending}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/80 hover:neon-glow disabled:opacity-50"
      >
        {isSubmitting || isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Публикация...
          </>
        ) : (
          "Опубликовать"
        )}
      </button>
    </form>
  );
}
