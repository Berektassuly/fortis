import { unstable_noStore as noStore } from "next/cache";
import { ArrowLeft, LockKeyhole, Shield, Sparkles } from "lucide-react";
import Link from "next/link";

import CreateListingForm from "@/components/marketplace/create-listing-form";
import Header from "@/components/marketplace/header";

const processCards = [
  {
    description:
      "Подготовьте карточку актива, оценку стоимости и обложку для дальнейшей токенизации.",
    icon: Sparkles,
    title: "Подготовка актива",
  },
  {
    description:
      "Fortis связывает запись с кошельком и проводит выпуск через безопасный токенизационный поток.",
    icon: Shield,
    title: "Комплаенс и выпуск",
  },
  {
    description:
      "Все действия подтверждаются кошельком и готовы к on-chain исполнению в инфраструктуре Solana.",
    icon: LockKeyhole,
    title: "Подпись и защита",
  },
] as const;

export default function CreateListingPage() {
  noStore();

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[10%] top-20 h-80 w-80 rounded-full bg-neon-purple/20 blur-[120px]" />
          <div className="absolute right-[8%] top-24 h-96 w-96 rounded-full bg-neon-blue/14 blur-[140px]" />
          <div className="absolute bottom-12 left-1/2 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-[140px]" />
          <div className="absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rotate-45 rounded-[4rem] border border-white/10 opacity-40 shadow-[0_0_90px_rgba(168,85,247,0.18)]" />
          <svg
            aria-hidden="true"
            viewBox="0 0 1600 420"
            className="absolute bottom-8 left-0 h-72 w-full opacity-30"
            fill="none"
            preserveAspectRatio="none"
          >
            {[0, 28, 56, 84, 112, 140].map((offset) => (
              <path
                key={offset}
                d={`M-80 ${250 - offset}C120 ${182 - offset}, 280 ${174 - offset}, 438 ${
                  220 - offset
                }S770 ${286 - offset}, 970 ${222 - offset}S1310 ${174 - offset}, 1680 ${238 - offset}`}
                stroke="rgba(143,111,255,0.2)"
                strokeWidth="2"
              />
            ))}
          </svg>
        </div>

        <div className="container relative mx-auto px-4 py-8 lg:py-12">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 transition-all hover:border-white/20 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Link>

          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <section className="relative overflow-hidden rounded-[2.5rem] border border-white/8 bg-[linear-gradient(180deg,rgba(11,13,28,0.78),rgba(9,11,21,0.42))] px-6 py-8 shadow-[0_30px_120px_rgba(4,6,20,0.65)] sm:px-8 sm:py-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.07),transparent_46%)]" />

              <div className="relative z-10 space-y-7">
                <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-primary">
                  Fortis Tokenization Desk
                </span>

                <div className="space-y-4">
                  <h1 className="neon-text max-w-3xl text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-[3.4rem] lg:leading-[1.04]">
                    Токенизация нового актива
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
                    Создайте карточку RWA-актива, прикрепите институциональную обложку и
                    отправьте актив в Fortis для выпуска токенизированного предложения.
                  </p>
                </div>

                <div className="grid gap-4">
                  {processCards.map((card) => {
                    const Icon = card.icon;

                    return (
                      <article
                        key={card.title}
                        className="glass rounded-[1.8rem] border border-purple-500/20 bg-card/35 p-5 transition-all duration-300 hover:border-purple-500/45 hover:shadow-[0_0_28px_rgba(168,85,247,0.12)]"
                      >
                        <div className="mb-4 inline-flex rounded-2xl border border-white/10 bg-white/6 p-3 text-neon-purple">
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-semibold text-white">{card.title}</p>
                        <p className="mt-2 text-sm leading-6 text-white/60">{card.description}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>

            <CreateListingForm />
          </div>
        </div>
      </main>
    </div>
  );
}
