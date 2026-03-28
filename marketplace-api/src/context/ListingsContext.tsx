import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface Listing {
  id: number; // В базе ID это число
  title: string;
  price: number;
  city: string;
  rooms: number;
  photo: string | null;
  description: string;
}

interface ListingsContextType {
  listings: Listing[];
  addListing: (listing: Omit<Listing, "id">) => Promise<void>;
  loading: boolean;
}

const ListingsContext = createContext<ListingsContextType | undefined>(undefined);

const API_URL = "http://127.0.0.1:8000/api/listings";

export const ListingsProvider = ({ children }: { children: ReactNode }) => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. ЗАГРУЗКА ДАННЫХ ИЗ ПИТОНА ПРИ СТАРТЕ
  const fetchListings = async () => {
    try {
      const response = await fetch(API_URL);
      const data = await response.json();
      
      // Преобразуем данные из формата БД в формат фронтенда
      const formattedData = data.map((item: any) => ({
        id: item.id,
        title: item.title,
        price: item.price_fiat,
        city: "Алматы", // Можно добавить поле в БД позже
        rooms: 2,       // Можно добавить поле в БД позже
        photo: item.images?.[0] || null,
        description: item.description || ""
      }));
      
      setListings(formattedData);
    } catch (error) {
      console.error("Ошибка при загрузке:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchListings();
  }, []);

  // 2. ОТПРАВКА НОВОГО ОБЪЯВЛЕНИЯ В ПИТОН
  const addListing = async (newListing: Omit<Listing, "id">) => {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newListing),
      });

      if (response.ok) {
        // После успешного создания обновляем список с сервера
        await fetchListings();
      }
    } catch (error) {
      console.error("Ошибка при создании:", error);
    }
  };

  return (
    <ListingsContext.Provider value={{ listings, addListing, loading }}>
      {children}
    </ListingsContext.Provider>
  );
};

export const useListings = () => {
  const ctx = useContext(ListingsContext);
  if (!ctx) throw new Error("useListings must be used within ListingsProvider");
  return ctx;
};