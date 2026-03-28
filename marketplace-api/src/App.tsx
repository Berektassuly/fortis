import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ListingsProvider } from "@/context/ListingsContext";
import Index from "./pages/Index.tsx";
import CreateListing from "./pages/CreateListing.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ListingsProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/create" element={<CreateListing />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ListingsProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
