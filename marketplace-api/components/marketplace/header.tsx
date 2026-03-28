import Link from "next/link";
import { Home, Plus, Search } from "lucide-react";

export default function Header() {
  return (
    <header className="glass sticky top-0 z-50 border-b border-border/30">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <Home className="h-6 w-6 text-neon-purple transition-all group-hover:drop-shadow-[0_0_8px_hsl(250,90%,65%)]" />
          <span className="neon-text text-xl font-bold">НеоДом</span>
        </Link>

        <div className="glass hidden w-96 items-center gap-2 rounded-2xl px-4 py-2 md:flex">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск недвижимости..."
            readOnly
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <Link
          href="/create"
          className="flex items-center gap-2 rounded-2xl bg-primary/90 px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-300 hover:bg-primary hover:neon-glow"
        >
          <Plus className="h-4 w-4" />
          Подать объявление
        </Link>
      </div>
    </header>
  );
}
