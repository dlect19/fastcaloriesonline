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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line: string
          city: string
          created_at: string
          id: string
          is_default: boolean | null
          label: string
          latitude: number | null
          longitude: number | null
          state: string
          user_id: string
        }
        Insert: {
          address_line: string
          city: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          label?: string
          latitude?: number | null
          longitude?: number | null
          state: string
          user_id: string
        }
        Update: {
          address_line?: string
          city?: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          label?: string
          latitude?: number | null
          longitude?: number | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      advertisements: {
        Row: {
          created_at: string
          description: string | null
          display_order: number | null
          ends_at: string | null
          id: string
          image_url: string
          is_active: boolean | null
          link_url: string | null
          starts_at: string | null
          target_audience: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          ends_at?: string | null
          id?: string
          image_url: string
          is_active?: boolean | null
          link_url?: string | null
          starts_at?: string | null
          target_audience?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          ends_at?: string | null
          id?: string
          image_url?: string
          is_active?: boolean | null
          link_url?: string | null
          starts_at?: string | null
          target_audience?: string | null
          title?: string
        }
        Relationships: []
      }
      calorie_logs: {
        Row: {
          calories: number
          carbs_grams: number | null
          created_at: string
          fats_grams: number | null
          id: string
          log_date: string
          meal_type: string | null
          order_id: string | null
          protein_grams: number | null
          user_id: string
        }
        Insert: {
          calories?: number
          carbs_grams?: number | null
          created_at?: string
          fats_grams?: number | null
          id?: string
          log_date?: string
          meal_type?: string | null
          order_id?: string | null
          protein_grams?: number | null
          user_id: string
        }
        Update: {
          calories?: number
          carbs_grams?: number | null
          created_at?: string
          fats_grams?: number | null
          id?: string
          log_date?: string
          meal_type?: string | null
          order_id?: string | null
          protein_grams?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calorie_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_items: {
        Row: {
          combo_id: string
          created_at: string | null
          id: string
          product_id: string
          quantity: number | null
        }
        Insert: {
          combo_id: string
          created_at?: string | null
          id?: string
          product_id: string
          quantity?: number | null
        }
        Update: {
          combo_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
          quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "combo_items_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "combos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      combos: {
        Row: {
          combo_price: number
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_available: boolean | null
          name: string
          original_price: number
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          combo_price: number
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name: string
          original_price: number
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          combo_price?: number
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name?: string
          original_price?: number
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combos_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      drug_reminders: {
        Row: {
          created_at: string
          dosage: string | null
          drug_name: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean | null
          reminder_times: string[]
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dosage?: string | null
          drug_name: string
          end_date?: string | null
          frequency: string
          id?: string
          is_active?: boolean | null
          reminder_times: string[]
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dosage?: string | null
          drug_name?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          reminder_times?: string[]
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          calories: number | null
          created_at: string
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          special_instructions: string | null
          total_price: number
          unit_price: number
        }
        Insert: {
          calories?: number | null
          created_at?: string
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          special_instructions?: string | null
          total_price: number
          unit_price: number
        }
        Update: {
          calories?: number | null
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          special_instructions?: string | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivery_address_id: string | null
          delivery_address_text: string | null
          delivery_fee: number | null
          delivery_instructions: string | null
          discount: number | null
          estimated_delivery_at: string | null
          id: string
          order_number: string
          payment_method: string | null
          payment_reference: string | null
          payment_status: string | null
          promo_code: string | null
          rider_id: string | null
          service_fee: number | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          total_calories: number | null
          updated_at: string
          user_id: string | null
          vendor_id: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_address_text?: string | null
          delivery_fee?: number | null
          delivery_instructions?: string | null
          discount?: number | null
          estimated_delivery_at?: string | null
          id?: string
          order_number: string
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          promo_code?: string | null
          rider_id?: string | null
          service_fee?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          total_calories?: number | null
          updated_at?: string
          user_id?: string | null
          vendor_id: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_address_text?: string | null
          delivery_fee?: number | null
          delivery_instructions?: string | null
          discount?: number | null
          estimated_delivery_at?: string | null
          id?: string
          order_number?: string
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          promo_code?: string | null
          rider_id?: string | null
          service_fee?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
          total_calories?: number | null
          updated_at?: string
          user_id?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_delivery_address_id_fkey"
            columns: ["delivery_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          id: string
          image_url: string
          notes: string | null
          order_id: string | null
          reviewed_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          notes?: string | null
          order_id?: string | null
          reviewed_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          notes?: string | null
          order_id?: string | null
          reviewed_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          calorie_classes: Database["public"]["Enums"]["calorie_class"][] | null
          calories: number | null
          carbs_grams: number | null
          category_id: string | null
          created_at: string
          description: string | null
          fats_grams: number | null
          fiber_grams: number | null
          id: string
          image_url: string | null
          is_available: boolean | null
          name: string
          nutrient_tags: string[] | null
          price: number
          protein_grams: number | null
          requires_prescription: boolean | null
          serving_unit: string | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          calorie_classes?:
            | Database["public"]["Enums"]["calorie_class"][]
            | null
          calories?: number | null
          carbs_grams?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          fats_grams?: number | null
          fiber_grams?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name: string
          nutrient_tags?: string[] | null
          price: number
          protein_grams?: number | null
          requires_prescription?: boolean | null
          serving_unit?: string | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          calorie_classes?:
            | Database["public"]["Enums"]["calorie_class"][]
            | null
          calories?: number | null
          carbs_grams?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          fats_grams?: number | null
          fiber_grams?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          name?: string
          nutrient_tags?: string[] | null
          price?: number
          protein_grams?: number | null
          requires_prescription?: boolean | null
          serving_unit?: string | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          daily_calorie_target: number | null
          full_name: string | null
          health_goal: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          daily_calorie_target?: number | null
          full_name?: string | null
          health_goal?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          daily_calorie_target?: number | null
          full_name?: string | null
          health_goal?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean | null
          max_discount: number | null
          min_order_amount: number | null
          usage_limit: number | null
          used_count: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          discount_type: string
          discount_value: number
          id?: string
          is_active?: boolean | null
          max_discount?: number | null
          min_order_amount?: number | null
          usage_limit?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean | null
          max_discount?: number | null
          min_order_amount?: number | null
          usage_limit?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          order_id: string
          rider_id: string | null
          rider_rating: number | null
          user_id: string
          vendor_id: string
          vendor_rating: number | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id: string
          rider_id?: string | null
          rider_rating?: number | null
          user_id: string
          vendor_id: string
          vendor_rating?: number | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string
          rider_id?: string | null
          rider_rating?: number | null
          user_id?: string
          vendor_id?: string
          vendor_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_profiles: {
        Row: {
          created_at: string
          current_latitude: number | null
          current_longitude: number | null
          id: string
          id_document_url: string | null
          is_online: boolean | null
          is_verified: boolean | null
          rating: number | null
          total_deliveries: number | null
          updated_at: string
          user_id: string
          vehicle_plate: string | null
          vehicle_type: string | null
        }
        Insert: {
          created_at?: string
          current_latitude?: number | null
          current_longitude?: number | null
          id?: string
          id_document_url?: string | null
          is_online?: boolean | null
          is_verified?: boolean | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string
          user_id: string
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Update: {
          created_at?: string
          current_latitude?: number | null
          current_longitude?: number | null
          id?: string
          id_document_url?: string | null
          is_online?: boolean | null
          is_verified?: boolean | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string
          user_id?: string
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      takeaway_packs: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          price: number
          sort_order: number | null
          threshold_type: string
          threshold_value: number
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          price?: number
          sort_order?: number | null
          threshold_type?: string
          threshold_value?: number
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          price?: number
          sort_order?: number | null
          threshold_type?: string
          threshold_value?: number
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeaway_packs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          reference: string | null
          status: string | null
          type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          reference?: string | null
          status?: string | null
          type: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          reference?: string | null
          status?: string | null
          type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_working_hours: {
        Row: {
          close_time: string
          day_of_week: number
          id: string
          is_closed: boolean | null
          open_time: string
          vendor_id: string
        }
        Insert: {
          close_time: string
          day_of_week: number
          id?: string
          is_closed?: boolean | null
          open_time: string
          vendor_id: string
        }
        Update: {
          close_time?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean | null
          open_time?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_working_hours_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string
          banner_url: string | null
          category: Database["public"]["Enums"]["vendor_category"]
          city: string
          commission_rate: number | null
          created_at: string
          delivery_fee: number | null
          description: string | null
          email: string | null
          estimated_delivery_minutes: number | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          logo_url: string | null
          min_order_amount: number | null
          name: string
          phone: string | null
          qr_code_url: string | null
          rating: number | null
          state: string
          total_ratings: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city: string
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          min_order_amount?: number | null
          name: string
          phone?: string | null
          qr_code_url?: string | null
          rating?: number | null
          state: string
          total_ratings?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city?: string
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          min_order_amount?: number | null
          name?: string
          phone?: string | null
          qr_code_url?: string | null
          rating?: number | null
          state?: string
          total_ratings?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number | null
          created_at: string
          id: string
          pending_balance: number | null
          total_earned: number | null
          total_withdrawn: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number | null
          created_at?: string
          id?: string
          pending_balance?: number | null
          total_earned?: number | null
          total_withdrawn?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number | null
          created_at?: string
          id?: string
          pending_balance?: number | null
          total_earned?: number | null
          total_withdrawn?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_vendor_role: { Args: never; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      owns_vendor: {
        Args: { _user_id: string; _vendor_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "customer" | "vendor" | "rider" | "admin"
      calorie_class: "carbs" | "protein" | "fats" | "fiber"
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready_for_pickup"
        | "picked_up"
        | "on_the_way"
        | "delivered"
        | "cancelled"
      vendor_category: "restaurant" | "pharmacy" | "market"
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
    Enums: {
      app_role: ["customer", "vendor", "rider", "admin"],
      calorie_class: ["carbs", "protein", "fats", "fiber"],
      order_status: [
        "pending",
        "confirmed",
        "preparing",
        "ready_for_pickup",
        "picked_up",
        "on_the_way",
        "delivered",
        "cancelled",
      ],
      vendor_category: ["restaurant", "pharmacy", "market"],
    },
  },
} as const
