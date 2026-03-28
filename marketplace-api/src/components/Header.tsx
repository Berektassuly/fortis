import { Link } from "react-router-dom";
import { Search, Home, Plus } from "lucide-react";

const Header = () => {
  return (
    <header className="sticky top-0 z-50 glass border-b border-border/30">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 group">
          <Home className="h-6 w-6 text-neon-purple group-hover:drop-shadow-[0_0_8px_hsl(250,90%,65%)] transition-all" />
          <span className="text-xl font-bold neon-text">НеоДом</span>
        </Link>

        <div className="hidden md:flex items-center gap-2 glass rounded-2xl px-4 py-2 w-96">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск недвижимости..."
            className="bg-transparent outline-none flex-1 text-sm placeholder:text-muted-foreground"
            onClick={(e) => e.preventDefault()}
          />
        </div>

        <Link
          to="/create"
          className="flex items-center gap-2 bg-primary/90 hover:bg-primary text-primary-foreground px-5 py-2.5 rounded-2xl font-medium text-sm transition-all duration-300 hover:neon-glow"
        >
          <Plus className="h-4 w-4" />
          Подать объявление
        </Link>
      </div>
    </header>
  );
};

export default Header;
