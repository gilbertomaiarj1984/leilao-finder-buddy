export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      known_artists: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lot_ai: {
        Row: {
          album: string | null
          deal: string | null
          evaluated_at: string
          id: string
          model: string | null
          rarity: string | null
          reason: string | null
          score: number | null
          tags: Json
          title_hash: string
        }
        Insert: {
          album?: string | null
          deal?: string | null
          evaluated_at?: string
          id: string
          model?: string | null
          rarity?: string | null
          reason?: string | null
          score?: number | null
          tags?: Json
          title_hash: string
        }
        Update: {
          album?: string | null
          deal?: string | null
          evaluated_at?: string
          id?: string
          model?: string | null
          rarity?: string | null
          reason?: string | null
          score?: number | null
          tags?: Json
          title_hash?: string
        }
        Relationships: []
      }
      lot_market: {
        Row: {
          basis: string
          checked_at: string
          currency: string | null
          have: number | null
          id: string
          lowest_price: number | null
          matched: boolean
          num_for_sale: number | null
          release_id: number | null
          release_title: string | null
          suggested_condition: string | null
          suggested_price: number | null
          want: number | null
          year: number | null
        }
        Insert: {
          basis: string
          checked_at?: string
          currency?: string | null
          have?: number | null
          id: string
          lowest_price?: number | null
          matched?: boolean
          num_for_sale?: number | null
          release_id?: number | null
          release_title?: string | null
          suggested_condition?: string | null
          suggested_price?: number | null
          want?: number | null
          year?: number | null
        }
        Update: {
          basis?: string
          checked_at?: string
          currency?: string | null
          have?: number | null
          id?: string
          lowest_price?: number | null
          matched?: boolean
          num_for_sale?: number | null
          release_id?: number | null
          release_title?: string | null
          suggested_condition?: string | null
          suggested_price?: number | null
          want?: number | null
          year?: number | null
        }
        Relationships: []
      }
      lots: {
        Row: {
          artist: string
          base: string
          created_at: string
          day_key: string
          house: string
          house_url: string
          id: string
          id_leilao: string
          id_peca: string
          image: string | null
          last_seen_at: string
          lote: string
          price: string
          start_time: string
          title: string
          uf: string
          updated_at: string
          url: string
        }
        Insert: {
          artist?: string
          base: string
          created_at?: string
          day_key: string
          house?: string
          house_url?: string
          id: string
          id_leilao: string
          id_peca: string
          image?: string | null
          last_seen_at?: string
          lote: string
          price?: string
          start_time?: string
          title: string
          uf?: string
          updated_at?: string
          url: string
        }
        Update: {
          artist?: string
          base?: string
          created_at?: string
          day_key?: string
          house?: string
          house_url?: string
          id?: string
          id_leilao?: string
          id_peca?: string
          image?: string | null
          last_seen_at?: string
          lote?: string
          price?: string
          start_time?: string
          title?: string
          uf?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      seen_auctions: {
        Row: {
          created_at: string
          day_key: string
          entry_url: string | null
          house: string
          house_url: string | null
          id_leilao: string
          last_seen_at: string
          lot_count: number
          sample_titles: string[]
          start_time: string
          starts_at: string | null
          uf: string | null
        }
        Insert: {
          created_at?: string
          day_key: string
          entry_url?: string | null
          house: string
          house_url?: string | null
          id_leilao: string
          last_seen_at?: string
          lot_count?: number
          sample_titles?: string[]
          start_time: string
          starts_at?: string | null
          uf?: string | null
        }
        Update: {
          created_at?: string
          day_key?: string
          entry_url?: string | null
          house?: string
          house_url?: string | null
          id_leilao?: string
          last_seen_at?: string
          lot_count?: number
          sample_titles?: string[]
          start_time?: string
          starts_at?: string | null
          uf?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
