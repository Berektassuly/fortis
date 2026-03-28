"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getListingsBucket } from "@/lib/supabase/config";

const cities = ["Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function getFileExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension || "jpg";
}

function getUploadErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("bucket") && normalizedMessage.includes("not found")) {
    return "Storage bucket listings не найден. Создайте его в Supabase Dashboard.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "Политики Supabase Storage блокируют загрузку. Разрешите authenticated-пользователям загружать файлы в bucket listings.";
  }

  return message;
}

async function uploadListingImage(file: File) {
  const supabase = createClient();
  const bucket = getListingsBucket();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Сессия истекла. Войдите в аккаунт снова.");
  }

  const objectPath = `${user.id}/${crypto.randomUUID()}.${getFileExtension(file)}`;
  const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
    upsert: false,
  });

  if (uploadError) {
    throw new Error(getUploadErrorMessage(uploadError.message));
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(objectPath);

  return {
    objectPath,
    publicUrl,
  };
}

async function removeUploadedImage(objectPath: string) {
  try {
    const supabase = createClient();
    await supabase.storage.from(getListingsBucket()).remove([objectPath]);
  } catch (error) {
    console.error("Failed to remove uploaded listing image", error);
  }
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
      toast.error("Заполните заголовок и цену.");
      return;
    }

    if (photoFile && !photoFile.type.startsWith("image/")) {
      toast.error("Можно загружать только изображения.");
      return;
    }

    if (photoFile && photoFile.size > MAX_IMAGE_SIZE_BYTES) {
      toast.error("Фото должно быть не больше 5 МБ.");
      return;
    }

    let uploadedImagePath: string | null = null;

    try {
      setIsSubmitting(true);

      let photo: string | null = null;
      if (photoFile) {
        const upload = await uploadListingImage(photoFile);
        uploadedImagePath = upload.objectPath;
        photo = upload.publicUrl;
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
        if (uploadedImagePath) {
          await removeUploadedImage(uploadedImagePath);
        }

        const body = (await response.json().catch(() => null)) as { error?: string } | null;

        if (response.status === 401) {
          toast.error(body?.error ?? "Сессия истекла. Войдите снова.");
          router.push("/login?next=/create");
          router.refresh();
          return;
        }

        toast.error(body?.error ?? "Не удалось опубликовать объявление.");
        return;
      }

      toast.success("Объявление опубликовано.");
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } catch (error) {
      if (uploadedImagePath) {
        await removeUploadedImage(uploadedImagePath);
      }

      console.error(error);
      toast.error(error instanceof Error ? error.message : "Не удалось опубликовать объявление.");
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
          {previewUrl ? "Фото готово к загрузке" : "Загрузить фото"}
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
