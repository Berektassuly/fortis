import Link from "next/link";

import Header from "@/components/marketplace/header";
import CreateListingForm from "@/components/marketplace/create-listing-form";

export default function CreateListingPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto max-w-xl px-4 py-8">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          Назад
        </Link>

        <h1 className="neon-text mb-6 text-2xl font-bold">Новое объявление</h1>
        <CreateListingForm />
      </main>
    </div>
  );
}
