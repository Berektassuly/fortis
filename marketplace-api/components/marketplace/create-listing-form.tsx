"use client";

import { useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Building2, Loader2, Shield, Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getListingsBucket } from "@/lib/supabase/config";

type AssetType = "bond" | "commodity" | "equity" | "real_estate";

const assetTypeOptions: Array<{
  label: string;
  value: AssetType;
}> = [
  { label: "Недвижимость", value: "real_estate" },
  { label: "Облигации", value: "bond" },
  { label: "Товары", value: "commodity" },
  { label: "Акции", value: "equity" },
];

const cities = ["Алматы", "Астана", "Шымкент", "Караганда", "Актау", "Павлодар"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function getFileExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension || "jpg";
}

function getUploadErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("bucket") && normalizedMessage.includes("not found")) {
    return "Storage bucket 'listings' не найден. Создайте его в Supabase Dashboard.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "Политики RLS блокируют загрузку. Проверьте права в Supabase Storage.";
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
    throw new Error("Сессия истекла. Пожалуйста, войдите снова.");
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
  const { connected, publicKey } = useWallet();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>("real_estate");
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

  const isRealEstate = assetType === "real_estate";
  const inputClass =
    "w-full rounded-2xl border border-white/10 bg-background/70 px-4 py-3.5 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-neon-purple focus:ring-2 focus:ring-neon-purple/40";

  async function ensureWalletBound(walletAddress: string) {
    const response = await fetch("/api/me/wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        walletAddress,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Не удалось привязать подключенный кошелек.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!connected || !publicKey) {
      toast.error("Подключите Solana-кошелек перед токенизацией актива.");
      return;
    }

    if (!title.trim() || !price.trim()) {
      toast.error("Заполните название актива и его оценку.");
      return;
    }

    if (photoFile && !photoFile.type.startsWith("image/")) {
      toast.error("Разрешены только файлы изображений.");
      return;
    }

    if (photoFile && photoFile.size > MAX_IMAGE_SIZE_BYTES) {
      toast.error("Размер файла не должен превышать 5 МБ.");
      return;
    }

    let uploadedImagePath: string | null = null;
    let listingSubmissionStarted = false;

    try {
      setIsSubmitting(true);

      const walletAddress = publicKey.toBase58();
      await ensureWalletBound(walletAddress);

      let photo: string | null = null;
      if (photoFile) {
        const upload = await uploadListingImage(photoFile);
        uploadedImagePath = upload.objectPath;
        photo = upload.publicUrl;
      }

      listingSubmissionStarted = true;
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          price: Number(price),
          city: isRealEstate ? city : undefined,
          rooms: isRealEstate ? Number(rooms) : undefined,
          photo,
          description: description.trim() || null,
          walletAddress,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;

        if (response.status === 401) {
          toast.error(body?.error ?? "Сессия истекла. Пожалуйста, войдите снова.");
          router.push("/login?next=/create");
          router.refresh();
          return;
        }

        toast.error(body?.error ?? "Не удалось отправить актив на токенизацию.");
        return;
      }

      toast.success("Актив успешно отправлен на токенизацию.");
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } catch (error) {
      if (uploadedImagePath && !listingSubmissionStarted) {
        await removeUploadedImage(uploadedImagePath);
      }

      console.error(error);
      toast.error(error instanceof Error ? error.message : "Не удалось отправить актив на токенизацию.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-[2.3rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,32,0.88),rgba(10,12,23,0.94))] p-6 shadow-[0_0_30px_rgba(168,85,247,0.1),0_24px_80px_rgba(3,6,20,0.6)] backdrop-blur-2xl sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%)]" />
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-neon-purple/12 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-neon-blue/10 blur-[90px]" />

      <div className="relative z-10">
        <div className="mb-6 rounded-[1.8rem] border border-white/8 bg-white/5 p-5">
          <div className="mb-4 inline-flex rounded-2xl border border-white/10 bg-white/6 p-3 text-neon-purple">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-2xl font-semibold text-white">Паспорт токенизации</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">
            Заполните ключевые параметры актива, добавьте визуальную обложку и отправьте
            карточку в Fortis для дальнейшего выпуска и публикации.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium text-white/80">
                Название актива
              </label>
              <input
                id="title"
                placeholder="Название актива *"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClass}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="asset-type" className="text-sm font-medium text-white/80">
                Тип актива
              </label>
              <select
                id="asset-type"
                value={assetType}
                onChange={(event) => setAssetType(event.target.value as AssetType)}
                className={inputClass}
              >
                {assetTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="price" className="text-sm font-medium text-white/80">
              Оценка стоимости
            </label>
            <input
              id="price"
              type="number"
              min="0"
              placeholder="Оценка стоимости (USDT) *"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium text-white/80">
              Описание актива
            </label>
            <textarea
              id="description"
              placeholder="Описание актива"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              maxLength={1000}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div className="rounded-[1.8rem] border border-white/8 bg-white/5 p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3 text-neon-blue">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Параметры недвижимости (Опционально)
                </h3>
                <p className="mt-1 text-sm leading-6 text-white/55">
                  Эти поля нужны только для real-estate активов. Для облигаций, товаров и
                  акций их можно оставить без изменений.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="city" className="text-sm font-medium text-white/80">
                  Город
                </label>
                <select
                  id="city"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  disabled={!isRealEstate}
                  className={`${inputClass} ${!isRealEstate ? "opacity-50" : ""}`}
                >
                  {cities.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="rooms" className="text-sm font-medium text-white/80">
                  Комнатность
                </label>
                <select
                  id="rooms"
                  value={rooms}
                  onChange={(event) => setRooms(event.target.value)}
                  disabled={!isRealEstate}
                  className={`${inputClass} ${!isRealEstate ? "opacity-50" : ""}`}
                >
                  {[1, 2, 3, 4, 5].map((item) => (
                    <option key={item} value={item}>
                      {item} комн.
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <label className="group block cursor-pointer rounded-[1.8rem] border-2 border-dashed border-white/10 bg-white/5 p-5 transition-all duration-300 hover:border-neon-purple/50 hover:bg-white/[0.07]">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3 text-neon-purple transition-transform duration-300 group-hover:scale-105">
                <Upload className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">
                  {previewUrl ? "Обложка готова к загрузке" : "Загрузить обложку актива"}
                </p>
                <p className="text-xs uppercase tracking-[0.18em] text-white/42">
                  PNG, JPG, WEBP до 5 МБ
                </p>
              </div>
            </div>

            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
            />

            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Предпросмотр обложки"
                className="mt-5 h-44 w-full rounded-[1.4rem] border border-white/10 object-cover"
              />
            ) : null}
          </label>

          <div className="flex items-center gap-3 rounded-[1.2rem] border border-white/8 bg-white/5 px-4 py-3 text-sm text-white/58">
            <Shield className="h-4 w-4 text-neon-purple" />
            <span>
              Кошелек используется для подписи, привязки профиля и безопасной публикации
              актива в Fortis.
            </span>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isPending || !connected || !publicKey}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:neon-glow disabled:opacity-50"
          >
            {isSubmitting || isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Токенизация...
              </>
            ) : connected && publicKey ? (
              "Токенизировать актив"
            ) : (
              "Подключите кошелек для токенизации"
            )}
          </button>
        </form>
      </div>
    </section>
  );
}
