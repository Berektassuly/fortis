export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Numeric = number | string;

export type ListingTokenizationStatus = "draft" | "tokenizing" | "active" | "failed";
export type OrderStatus = "Created" | "Pending" | "Processing" | "Success" | "Failed";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: number;
          auth_user_id: string | null;
          email: string;
          password_hash: string | null;
          solana_wallet_address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          auth_user_id?: string | null;
          email: string;
          password_hash?: string | null;
          solana_wallet_address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          auth_user_id?: string | null;
          email?: string;
          password_hash?: string | null;
          solana_wallet_address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      listings: {
        Row: {
          id: number;
          title: string | null;
          description: string | null;
          price_fiat: Numeric | null;
          price_crypto: Numeric | null;
          city: string | null;
          rooms: number | null;
          lat: number | null;
          lng: number | null;
          area: Numeric | null;
          floor: number | null;
          images: string[];
          seller_wallet_address: string | null;
          token_mint_address: string | null;
          tokenization_status: ListingTokenizationStatus | null;
          tokenization_error: string | null;
          owner_id: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          title?: string | null;
          description?: string | null;
          price_fiat?: Numeric | null;
          price_crypto?: Numeric | null;
          city?: string | null;
          rooms?: number | null;
          lat?: number | null;
          lng?: number | null;
          area?: Numeric | null;
          floor?: number | null;
          images?: string[];
          seller_wallet_address?: string | null;
          token_mint_address?: string | null;
          tokenization_status?: ListingTokenizationStatus | null;
          tokenization_error?: string | null;
          owner_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          title?: string | null;
          description?: string | null;
          price_fiat?: Numeric | null;
          price_crypto?: Numeric | null;
          city?: string | null;
          rooms?: number | null;
          lat?: number | null;
          lng?: number | null;
          area?: Numeric | null;
          floor?: number | null;
          images?: string[];
          seller_wallet_address?: string | null;
          token_mint_address?: string | null;
          tokenization_status?: ListingTokenizationStatus | null;
          tokenization_error?: string | null;
          owner_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listings_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: number;
          listing_id: number | null;
          user_id: number | null;
          status: OrderStatus | null;
          tx_hash: string | null;
          fortis_request_id: string | null;
          buyer_wallet_address: string | null;
          seller_wallet_address: string | null;
          token_mint_address: string | null;
          nonce: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          listing_id?: number | null;
          user_id?: number | null;
          status?: OrderStatus | null;
          tx_hash?: string | null;
          fortis_request_id?: string | null;
          buyer_wallet_address?: string | null;
          seller_wallet_address?: string | null;
          token_mint_address?: string | null;
          nonce?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          listing_id?: number | null;
          user_id?: number | null;
          status?: OrderStatus | null;
          tx_hash?: string | null;
          fortis_request_id?: string | null;
          buyer_wallet_address?: string | null;
          seller_wallet_address?: string | null;
          token_mint_address?: string | null;
          nonce?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
