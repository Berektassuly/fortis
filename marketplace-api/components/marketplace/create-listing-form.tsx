"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getListingsBucket } from "@/lib/supabase/config";

const cities = ["ÐÐ»Ð¼Ð°Ñ‚Ñ‹", "ÐÑÑ‚Ð°Ð½Ð°", "Ð¨Ñ‹Ð¼ÐºÐµÐ½Ñ‚", "ÐšÐ°Ñ€Ð°Ð³Ð°Ð½Ð´Ð°", "ÐÐºÑ‚Ð°Ñƒ", "ÐŸÐ°Ð²Ð»Ð¾Ð´Ð°Ñ€"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function getFileExtension(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension || "jpg";
}

function getUploadErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("bucket") && normalizedMessage.includes("not found")) {
    return "Storage bucket listings Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½. Ð¡Ð¾Ð·Ð´Ð°Ð¹Ñ‚Ðµ ÐµÐ³Ð¾ Ð² Supabase Dashboard.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "ÐŸÐ¾Ð»Ð¸Ñ‚Ð¸ÐºÐ¸ Supabase Storage Ð±Ð»Ð¾ÐºÐ¸Ñ€ÑƒÑŽÑ‚ Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÑƒ. Ð Ð°Ð·Ñ€ÐµÑˆÐ¸Ñ‚Ðµ authenticated-Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑÐ¼ Ð·Ð°Ð³Ñ€ÑƒÐ¶Ð°Ñ‚ÑŒ Ñ„Ð°Ð¹Ð»Ñ‹ Ð² bucket listings.";
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
    throw new Error("Ð¡ÐµÑÑÐ¸Ñ Ð¸ÑÑ‚ÐµÐºÐ»Ð°. Ð’Ð¾Ð¹Ð´Ð¸Ñ‚Ðµ Ð² Ð°ÐºÐºÐ°ÑƒÐ½Ñ‚ ÑÐ½Ð¾Ð²Ð°.");
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
      throw new Error(body?.error ?? "Failed to link the connected wallet.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!connected || !publicKey) {
      toast.error("Connect your Solana wallet before publishing.");
      return;
    }

    if (!title.trim() || !price.trim()) {
      toast.error("Ð—Ð°Ð¿Ð¾Ð»Ð½Ð¸Ñ‚Ðµ Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº Ð¸ Ñ†ÐµÐ½Ñƒ.");
      return;
    }

    if (photoFile && !photoFile.type.startsWith("image/")) {
      toast.error("ÐœÐ¾Ð¶Ð½Ð¾ Ð·Ð°Ð³Ñ€ÑƒÐ¶Ð°Ñ‚ÑŒ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð¸Ð·Ð¾Ð±Ñ€Ð°Ð¶ÐµÐ½Ð¸Ñ.");
      return;
    }

    if (photoFile && photoFile.size > MAX_IMAGE_SIZE_BYTES) {
      toast.error("Ð¤Ð¾Ñ‚Ð¾ Ð´Ð¾Ð»Ð¶Ð½Ð¾ Ð±Ñ‹Ñ‚ÑŒ Ð½Ðµ Ð±Ð¾Ð»ÑŒÑˆÐµ 5 ÐœÐ‘.");
      return;
    }

    let uploadedImagePath: string | null = null;

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
          walletAddress,
        }),
      });

      if (!response.ok) {
        if (uploadedImagePath) {
          await removeUploadedImage(uploadedImagePath);
        }

        const body = (await response.json().catch(() => null)) as { error?: string } | null;

        if (response.status === 401) {
          toast.error(body?.error ?? "Session expired. Please sign in again.");
          router.push("/login?next=/create");
          router.refresh();
          return;
        }

        toast.error(body?.error ?? "Failed to publish the Fortis listing.");
        return;
      }

      toast.success("Listing tokenized and published.");
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } catch (error) {
      if (uploadedImagePath) {
        await removeUploadedImage(uploadedImagePath);
      }

      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to publish the Fortis listing.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        placeholder="Ð—Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº *"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className={inputClass}
        maxLength={100}
      />

      <input
        type="number"
        placeholder="Ð¦ÐµÐ½Ð° â‚¸ *"
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
            {item} ÐºÐ¾Ð¼Ð½.
          </option>
        ))}
      </select>

      <label className="glass flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/50 p-6 transition-all hover:border-primary/50">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {previewUrl ? "Ð¤Ð¾Ñ‚Ð¾ Ð³Ð¾Ñ‚Ð¾Ð²Ð¾ Ðº Ð·Ð°Ð³Ñ€ÑƒÐ·ÐºÐµ" : "Ð—Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ñ„Ð¾Ñ‚Ð¾"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
        />
        {previewUrl ? (
          <img src={previewUrl} alt="ÐŸÑ€ÐµÐ²ÑŒÑŽ" className="mt-2 h-32 rounded-xl object-cover" />
        ) : null}
      </label>

      <textarea
        placeholder="ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={4}
        maxLength={1000}
        className={`${inputClass} resize-none`}
      />

      <button
        type="submit"
        disabled={isSubmitting || isPending || !connected || !publicKey}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/80 hover:neon-glow disabled:opacity-50"
      >
        {isSubmitting || isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            ÐŸÑƒÐ±Ð»Ð¸ÐºÐ°Ñ†Ð¸Ñ...
          </>
        ) : (
          <>{connected && publicKey ? "ÐžÐ¿ÑƒÐ±Ð»Ð¸ÐºÐ¾Ð²Ð°Ñ‚ÑŒ" : "Connect wallet to publish"}</>
        )}
      </button>
    </form>
  );
}
