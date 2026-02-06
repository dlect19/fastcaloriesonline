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
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_id?: string
        }
        Relationships: []
      }
      addon_groups: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          max_selections: number | null
          min_selections: number | null
          name: string
          product_id: string
          selection_type: string
          sort_order: number | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_selections?: number | null
          min_selections?: number | null
          name: string
          product_id: string
          selection_type?: string
          sort_order?: number | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          max_selections?: number | null
          min_selections?: number | null
          name?: string
          product_id?: string
          selection_type?: string
          sort_order?: number | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_groups_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_items: {
        Row: {
          additional_price: number
          addon_group_id: string
          calories: number | null
          created_at: string
          id: string
          is_available: boolean
          name: string
          sort_order: number | null
        }
        Insert: {
          additional_price?: number
          addon_group_id: string
          calories?: number | null
          created_at?: string
          id?: string
          is_available?: boolean
          name: string
          sort_order?: number | null
        }
        Update: {
          additional_price?: number
          addon_group_id?: string
          calories?: number | null
          created_at?: string
          id?: string
          is_available?: boolean
          name?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "addon_items_addon_group_id_fkey"
            columns: ["addon_group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
        ]
      }
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
      admin_staff: {
        Row: {
          created_at: string | null
          id: string
          invite_accepted_at: string | null
          invite_code: string | null
          invite_email: string | null
          invited_by: string | null
          is_active: boolean | null
          permissions: string[] | null
          role: Database["public"]["Enums"]["admin_staff_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invite_accepted_at?: string | null
          invite_code?: string | null
          invite_email?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          permissions?: string[] | null
          role?: Database["public"]["Enums"]["admin_staff_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invite_accepted_at?: string | null
          invite_code?: string | null
          invite_email?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          permissions?: string[] | null
          role?: Database["public"]["Enums"]["admin_staff_role"]
          updated_at?: string | null
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
      daily_promo_stats: {
        Row: {
          created_at: string | null
          environment: string | null
          high_discount_winners: number | null
          id: string
          stat_date: string
          total_promo_cost: number | null
          total_revenue: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          environment?: string | null
          high_discount_winners?: number | null
          id?: string
          stat_date?: string
          total_promo_cost?: number | null
          total_revenue?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          environment?: string | null
          high_discount_winners?: number | null
          id?: string
          stat_date?: string
          total_promo_cost?: number | null
          total_revenue?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      daily_spin_usage: {
        Row: {
          created_at: string | null
          free_spins_used: number | null
          id: string
          spin_date: string
          try_again_used: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          free_spins_used?: number | null
          id?: string
          spin_date?: string
          try_again_used?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          free_spins_used?: number | null
          id?: string
          spin_date?: string
          try_again_used?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      delivery_companies: {
        Row: {
          address: string | null
          bank_account_number: string | null
          bank_code: string | null
          bank_name: string | null
          city: string | null
          commission_rate: number
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_email_verified: boolean | null
          is_verified: boolean
          logo_url: string | null
          name: string
          paystack_recipient_code: string | null
          phone: string | null
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          bank_account_number?: string | null
          bank_code?: string | null
          bank_name?: string | null
          city?: string | null
          commission_rate?: number
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_email_verified?: boolean | null
          is_verified?: boolean
          logo_url?: string | null
          name: string
          paystack_recipient_code?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          bank_account_number?: string | null
          bank_code?: string | null
          bank_name?: string | null
          city?: string | null
          commission_rate?: number
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_email_verified?: boolean | null
          is_verified?: boolean
          logo_url?: string | null
          name?: string
          paystack_recipient_code?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      delivery_company_staff: {
        Row: {
          created_at: string
          delivery_company_id: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["delivery_company_staff_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivery_company_id: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["delivery_company_staff_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivery_company_id?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["delivery_company_staff_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_company_staff_delivery_company_id_fkey"
            columns: ["delivery_company_id"]
            isOneToOne: false
            referencedRelation: "delivery_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_offers: {
        Row: {
          created_at: string | null
          customer_address: string | null
          delivery_fee: number
          dispatch_request_id: string
          distance_km: number
          estimated_delivery_minutes: number | null
          estimated_pickup_minutes: number | null
          expires_at: string
          id: string
          priority_tier: string
          responded_at: string | null
          rider_profile_id: string
          rider_share: number
          rider_user_id: string
          status: string | null
          vendor_address: string | null
          vendor_name: string | null
        }
        Insert: {
          created_at?: string | null
          customer_address?: string | null
          delivery_fee: number
          dispatch_request_id: string
          distance_km: number
          estimated_delivery_minutes?: number | null
          estimated_pickup_minutes?: number | null
          expires_at: string
          id?: string
          priority_tier: string
          responded_at?: string | null
          rider_profile_id: string
          rider_share: number
          rider_user_id: string
          status?: string | null
          vendor_address?: string | null
          vendor_name?: string | null
        }
        Update: {
          created_at?: string | null
          customer_address?: string | null
          delivery_fee?: number
          dispatch_request_id?: string
          distance_km?: number
          estimated_delivery_minutes?: number | null
          estimated_pickup_minutes?: number | null
          expires_at?: string
          id?: string
          priority_tier?: string
          responded_at?: string | null
          rider_profile_id?: string
          rider_share?: number
          rider_user_id?: string
          status?: string | null
          vendor_address?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_dispatch_request_id_fkey"
            columns: ["dispatch_request_id"]
            isOneToOne: false
            referencedRelation: "dispatch_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_offers_rider_profile_id_fkey"
            columns: ["rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_requests: {
        Row: {
          accepted_at: string | null
          accepted_by_rider_id: string | null
          accepted_by_rider_profile_id: string | null
          created_at: string | null
          customer_latitude: number | null
          customer_longitude: number | null
          delivery_fee: number
          environment: string | null
          expires_at: string
          id: string
          max_retries: number | null
          order_id: string
          priority_tier: string | null
          retry_count: number | null
          search_radius_km: number | null
          status: string | null
          vendor_id: string
          vendor_latitude: number
          vendor_longitude: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_rider_id?: string | null
          accepted_by_rider_profile_id?: string | null
          created_at?: string | null
          customer_latitude?: number | null
          customer_longitude?: number | null
          delivery_fee?: number
          environment?: string | null
          expires_at: string
          id?: string
          max_retries?: number | null
          order_id: string
          priority_tier?: string | null
          retry_count?: number | null
          search_radius_km?: number | null
          status?: string | null
          vendor_id: string
          vendor_latitude: number
          vendor_longitude: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by_rider_id?: string | null
          accepted_by_rider_profile_id?: string | null
          created_at?: string | null
          customer_latitude?: number | null
          customer_longitude?: number | null
          delivery_fee?: number
          environment?: string | null
          expires_at?: string
          id?: string
          max_retries?: number | null
          order_id?: string
          priority_tier?: string | null
          retry_count?: number | null
          search_radius_km?: number | null
          status?: string | null
          vendor_id?: string
          vendor_latitude?: number
          vendor_longitude?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_requests_accepted_by_rider_profile_id_fkey"
            columns: ["accepted_by_rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_requests_vendor_id_fkey"
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
      email_verification_otps: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          id: string
          otp_code: string
          platform: string
          used: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          otp_code: string
          platform: string
          used?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          otp_code?: string
          platform?: string
          used?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      environment_switch_logs: {
        Row: {
          confirmation_text: string
          created_at: string | null
          from_environment: string
          id: string
          ip_address: string | null
          switched_by: string
          to_environment: string
        }
        Insert: {
          confirmation_text: string
          created_at?: string | null
          from_environment: string
          id?: string
          ip_address?: string | null
          switched_by: string
          to_environment: string
        }
        Update: {
          confirmation_text?: string
          created_at?: string | null
          from_environment?: string
          id?: string
          ip_address?: string | null
          switched_by?: string
          to_environment?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string | null
          id: string
          user_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          user_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          user_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      order_financials: {
        Row: {
          company_revenue: number
          created_at: string | null
          environment: string | null
          id: string
          menu_price: number
          order_id: string
          promo_discount_amount: number
          promo_source: string | null
          promo_type: string | null
          revenue_status: string
          vendor_commission_amount: number
          vendor_commission_percentage: number
          vendor_payout: number
        }
        Insert: {
          company_revenue: number
          created_at?: string | null
          environment?: string | null
          id?: string
          menu_price: number
          order_id: string
          promo_discount_amount?: number
          promo_source?: string | null
          promo_type?: string | null
          revenue_status?: string
          vendor_commission_amount: number
          vendor_commission_percentage: number
          vendor_payout: number
        }
        Update: {
          company_revenue?: number
          created_at?: string | null
          environment?: string | null
          id?: string
          menu_price?: number
          order_id?: string
          promo_discount_amount?: number
          promo_source?: string | null
          promo_type?: string | null
          revenue_status?: string
          vendor_commission_amount?: number
          vendor_commission_percentage?: number
          vendor_payout?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_financials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_addons: {
        Row: {
          additional_price: number
          addon_group_name: string
          addon_item_name: string
          calories: number | null
          created_at: string
          id: string
          order_item_id: string
        }
        Insert: {
          additional_price?: number
          addon_group_name: string
          addon_item_name: string
          calories?: number | null
          created_at?: string
          id?: string
          order_item_id: string
        }
        Update: {
          additional_price?: number
          addon_group_name?: string
          addon_item_name?: string
          calories?: number | null
          created_at?: string
          id?: string
          order_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_addons_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
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
      order_reassignments: {
        Row: {
          created_at: string
          id: string
          new_rider_id: string
          new_rider_share: number
          order_id: string
          original_rider_id: string
          original_rider_share: number
          reason: string | null
          reassigned_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          new_rider_id: string
          new_rider_share?: number
          order_id: string
          original_rider_id: string
          original_rider_share?: number
          reason?: string | null
          reassigned_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          new_rider_id?: string
          new_rider_share?: number
          order_id?: string
          original_rider_id?: string
          original_rider_share?: number
          reason?: string | null
          reassigned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_reassignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmation_code: string | null
          created_at: string
          delivered_at: string | null
          delivery_address_id: string | null
          delivery_address_text: string | null
          delivery_fee: number | null
          delivery_instructions: string | null
          delivery_type: string | null
          discount: number | null
          environment: string | null
          estimated_delivery_at: string | null
          id: string
          menu_subtotal: number | null
          order_number: string
          packaging_fee: number | null
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
          confirmation_code?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_address_text?: string | null
          delivery_fee?: number | null
          delivery_instructions?: string | null
          delivery_type?: string | null
          discount?: number | null
          environment?: string | null
          estimated_delivery_at?: string | null
          id?: string
          menu_subtotal?: number | null
          order_number: string
          packaging_fee?: number | null
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
          confirmation_code?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_address_id?: string | null
          delivery_address_text?: string | null
          delivery_fee?: number | null
          delivery_instructions?: string | null
          delivery_type?: string | null
          discount?: number | null
          environment?: string | null
          estimated_delivery_at?: string | null
          id?: string
          menu_subtotal?: number | null
          order_number?: string
          packaging_fee?: number | null
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
      password_reset_otps: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          id: string
          otp_code: string
          platform: string
          used: boolean | null
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          otp_code: string
          platform: string
          used?: boolean | null
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          otp_code?: string
          platform?: string
          used?: boolean | null
        }
        Relationships: []
      }
      payout_requests: {
        Row: {
          amount: number
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          created_at: string | null
          failure_reason: string | null
          id: string
          paystack_reference: string | null
          paystack_transfer_code: string | null
          processed_at: string | null
          recipient_id: string | null
          retry_count: number | null
          status: string | null
          updated_at: string | null
          user_id: string
          user_type: string
          wallet_id: string
          withdrawal_source: string | null
        }
        Insert: {
          amount: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          recipient_id?: string | null
          retry_count?: number | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          user_type: string
          wallet_id: string
          withdrawal_source?: string | null
        }
        Update: {
          amount?: number
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          recipient_id?: string | null
          retry_count?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          user_type?: string
          wallet_id?: string
          withdrawal_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "paystack_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      paystack_recipients: {
        Row: {
          account_name: string
          account_number: string
          bank_code: string
          created_at: string | null
          created_in_environment: string | null
          id: string
          is_default: boolean | null
          is_verified: boolean | null
          recipient_code: string
          updated_at: string | null
          user_id: string
          wallet_id: string | null
        }
        Insert: {
          account_name: string
          account_number: string
          bank_code: string
          created_at?: string | null
          created_in_environment?: string | null
          id?: string
          is_default?: boolean | null
          is_verified?: boolean | null
          recipient_code: string
          updated_at?: string | null
          user_id: string
          wallet_id?: string | null
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_code?: string
          created_at?: string | null
          created_in_environment?: string | null
          id?: string
          is_default?: boolean | null
          is_verified?: boolean | null
          recipient_code?: string
          updated_at?: string | null
          user_id?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "paystack_recipients_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_promotions: {
        Row: {
          created_at: string | null
          description: string | null
          discount_percentage: number
          id: string
          is_active: boolean | null
          name: string
          promo_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discount_percentage?: number
          id?: string
          is_active?: boolean | null
          name: string
          promo_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discount_percentage?: number
          id?: string
          is_active?: boolean | null
          name?: string
          promo_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      platform_wallet: {
        Row: {
          balance: number | null
          created_at: string | null
          currency: string | null
          id: string
          test_balance: number | null
          total_earned: number | null
          total_paid_out: number | null
          updated_at: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string
          test_balance?: number | null
          total_earned?: number | null
          total_paid_out?: number | null
          updated_at?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string
          test_balance?: number | null
          total_earned?: number | null
          total_paid_out?: number | null
          updated_at?: string | null
        }
        Relationships: []
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
          per_user_limit: number | null
          scope: string | null
          usage_limit: number | null
          used_count: number | null
          valid_from: string | null
          valid_until: string | null
          vendor_id: string | null
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
          per_user_limit?: number | null
          scope?: string | null
          usage_limit?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
          vendor_id?: string | null
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
          per_user_limit?: number | null
          scope?: string | null
          usage_limit?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_usage: {
        Row: {
          created_at: string | null
          id: string
          promo_id: string
          updated_at: string | null
          used_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          promo_id: string
          updated_at?: string | null
          used_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          promo_id?: string
          updated_at?: string | null
          used_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_usage_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_usage_log: {
        Row: {
          created_at: string | null
          discount_amount: number
          discount_percentage: number
          environment: string | null
          id: string
          order_id: string | null
          platform_cost: number
          promo_source: string
          promo_type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          discount_amount: number
          discount_percentage: number
          environment?: string | null
          id?: string
          order_id?: string | null
          platform_cost: number
          promo_source: string
          promo_type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          discount_amount?: number
          discount_percentage?: number
          environment?: string | null
          id?: string
          order_id?: string | null
          platform_cost?: number
          promo_source?: string
          promo_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_usage_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
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
          affiliated_vendor_id: string | null
          created_at: string
          current_latitude: number | null
          current_longitude: number | null
          delivery_company_id: string | null
          email: string | null
          id: string
          id_document_url: string | null
          is_email_verified: boolean | null
          is_online: boolean | null
          is_test_rider: boolean | null
          is_verified: boolean | null
          nin_number: string | null
          nin_submitted_at: string | null
          nin_verified: boolean | null
          preferred_city: string | null
          preferred_latitude: number | null
          preferred_longitude: number | null
          preferred_state: string | null
          rating: number | null
          total_deliveries: number | null
          updated_at: string
          user_id: string
          vehicle_plate: string | null
          vehicle_type: string | null
          work_radius_km: number | null
        }
        Insert: {
          affiliated_vendor_id?: string | null
          created_at?: string
          current_latitude?: number | null
          current_longitude?: number | null
          delivery_company_id?: string | null
          email?: string | null
          id?: string
          id_document_url?: string | null
          is_email_verified?: boolean | null
          is_online?: boolean | null
          is_test_rider?: boolean | null
          is_verified?: boolean | null
          nin_number?: string | null
          nin_submitted_at?: string | null
          nin_verified?: boolean | null
          preferred_city?: string | null
          preferred_latitude?: number | null
          preferred_longitude?: number | null
          preferred_state?: string | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string
          user_id: string
          vehicle_plate?: string | null
          vehicle_type?: string | null
          work_radius_km?: number | null
        }
        Update: {
          affiliated_vendor_id?: string | null
          created_at?: string
          current_latitude?: number | null
          current_longitude?: number | null
          delivery_company_id?: string | null
          email?: string | null
          id?: string
          id_document_url?: string | null
          is_email_verified?: boolean | null
          is_online?: boolean | null
          is_test_rider?: boolean | null
          is_verified?: boolean | null
          nin_number?: string | null
          nin_submitted_at?: string | null
          nin_verified?: boolean | null
          preferred_city?: string | null
          preferred_latitude?: number | null
          preferred_longitude?: number | null
          preferred_state?: string | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string
          user_id?: string
          vehicle_plate?: string | null
          vehicle_type?: string | null
          work_radius_km?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_profiles_affiliated_vendor_id_fkey"
            columns: ["affiliated_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_profiles_delivery_company_id_fkey"
            columns: ["delivery_company_id"]
            isOneToOne: false
            referencedRelation: "delivery_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      spin_results: {
        Row: {
          created_at: string | null
          discount_percentage: number
          expires_at: string
          id: string
          is_try_again: boolean | null
          is_used: boolean | null
          segment_id: string | null
          used_on_order_id: string | null
          user_id: string
          wheel_type: string
        }
        Insert: {
          created_at?: string | null
          discount_percentage?: number
          expires_at: string
          id?: string
          is_try_again?: boolean | null
          is_used?: boolean | null
          segment_id?: string | null
          used_on_order_id?: string | null
          user_id: string
          wheel_type: string
        }
        Update: {
          created_at?: string | null
          discount_percentage?: number
          expires_at?: string
          id?: string
          is_try_again?: boolean | null
          is_used?: boolean | null
          segment_id?: string | null
          used_on_order_id?: string | null
          user_id?: string
          wheel_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "spin_results_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "spin_wheel_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spin_results_used_on_order_id_fkey"
            columns: ["used_on_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      spin_wheel_config: {
        Row: {
          cost: number
          created_at: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
          wheel_type: string
        }
        Insert: {
          cost?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          wheel_type: string
        }
        Update: {
          cost?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          wheel_type?: string
        }
        Relationships: []
      }
      spin_wheel_segments: {
        Row: {
          color: string | null
          created_at: string | null
          daily_winner_limit: number | null
          discount_percentage: number
          id: string
          is_try_again: boolean | null
          probability_weight: number
          segment_label: string
          sort_order: number | null
          wheel_config_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          daily_winner_limit?: number | null
          discount_percentage?: number
          id?: string
          is_try_again?: boolean | null
          probability_weight?: number
          segment_label: string
          sort_order?: number | null
          wheel_config_id: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          daily_winner_limit?: number | null
          discount_percentage?: number
          id?: string
          is_try_again?: boolean | null
          probability_weight?: number
          segment_label?: string
          sort_order?: number | null
          wheel_config_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spin_wheel_segments_wheel_config_id_fkey"
            columns: ["wheel_config_id"]
            isOneToOne: false
            referencedRelation: "spin_wheel_config"
            referencedColumns: ["id"]
          },
        ]
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
      user_order_stats: {
        Row: {
          completed_orders: number | null
          created_at: string | null
          first_order_promo_used: boolean | null
          id: string
          last_loyalty_promo_at: string | null
          total_spent: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_orders?: number | null
          created_at?: string | null
          first_order_promo_used?: boolean | null
          id?: string
          last_loyalty_promo_at?: string | null
          total_spent?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_orders?: number | null
          created_at?: string | null
          first_order_promo_used?: boolean | null
          id?: string
          last_loyalty_promo_at?: string | null
          total_spent?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      vendor_rider_invites: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          invite_code: string
          is_used: boolean | null
          used_by: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invite_code: string
          is_used?: boolean | null
          used_by?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean | null
          used_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_rider_invites_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_rider_invites_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_riders: {
        Row: {
          created_at: string | null
          id: string
          invite_code: string
          is_active: boolean | null
          restriction_mode: string | null
          rider_profile_id: string
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invite_code: string
          is_active?: boolean | null
          restriction_mode?: string | null
          rider_profile_id: string
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invite_code?: string
          is_active?: boolean | null
          restriction_mode?: string | null
          rider_profile_id?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_riders_rider_profile_id_fkey"
            columns: ["rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_riders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_staff: {
        Row: {
          created_at: string | null
          id: string
          invite_accepted_at: string | null
          invite_code: string | null
          invite_email: string | null
          invited_by: string | null
          is_active: boolean | null
          permissions: string[] | null
          role: Database["public"]["Enums"]["vendor_staff_role"]
          updated_at: string | null
          user_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invite_accepted_at?: string | null
          invite_code?: string | null
          invite_email?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          permissions?: string[] | null
          role?: Database["public"]["Enums"]["vendor_staff_role"]
          updated_at?: string | null
          user_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invite_accepted_at?: string | null
          invite_code?: string | null
          invite_email?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          permissions?: string[] | null
          role?: Database["public"]["Enums"]["vendor_staff_role"]
          updated_at?: string | null
          user_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_staff_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
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
          approved_for_live: boolean | null
          banner_url: string | null
          category: Database["public"]["Enums"]["vendor_category"]
          city: string
          commission_rate: number | null
          created_at: string
          delivery_fee: number | null
          delivery_mode: string | null
          description: string | null
          email: string | null
          estimated_delivery_minutes: number | null
          id: string
          is_active: boolean | null
          is_test_store: boolean | null
          is_verified: boolean | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          min_order_amount: number | null
          name: string
          own_rider_priority: boolean | null
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
          approved_for_live?: boolean | null
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city: string
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          delivery_mode?: string | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_test_store?: boolean | null
          is_verified?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          name: string
          own_rider_priority?: boolean | null
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
          approved_for_live?: boolean | null
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city?: string
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          delivery_mode?: string | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_test_store?: boolean | null
          is_verified?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          name?: string
          own_rider_priority?: boolean | null
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
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          category: string
          created_at: string | null
          environment: string | null
          id: string
          metadata: Json | null
          notes: string | null
          order_id: string | null
          paystack_reference: string | null
          platform_wallet_id: string | null
          reference: string | null
          related_wallet_id: string | null
          status: string | null
          transaction_type: string
          wallet_id: string | null
          wallet_type: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          category: string
          created_at?: string | null
          environment?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_id?: string | null
          paystack_reference?: string | null
          platform_wallet_id?: string | null
          reference?: string | null
          related_wallet_id?: string | null
          status?: string | null
          transaction_type: string
          wallet_id?: string | null
          wallet_type: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          category?: string
          created_at?: string | null
          environment?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_id?: string | null
          paystack_reference?: string | null
          platform_wallet_id?: string | null
          reference?: string | null
          related_wallet_id?: string | null
          status?: string | null
          transaction_type?: string
          wallet_id?: string | null
          wallet_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_platform_wallet_id_fkey"
            columns: ["platform_wallet_id"]
            isOneToOne: false
            referencedRelation: "platform_wallet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          auto_withdraw: boolean | null
          auto_withdraw_day: number | null
          auto_withdraw_threshold: number | null
          balance: number | null
          bank_account_name: string | null
          bank_account_number: string | null
          bank_name: string | null
          created_at: string
          dva_account_name: string | null
          dva_account_number: string | null
          dva_active: boolean | null
          dva_bank_name: string | null
          dva_created_at: string | null
          eligible_balance: number | null
          id: string
          is_disabled: boolean | null
          menu_earnings_balance: number | null
          menu_earnings_pending: number | null
          paystack_customer_code: string | null
          paystack_customer_id: number | null
          paystack_recipient_code: string | null
          pending_balance: number | null
          pending_payouts: number | null
          rider_revenue_balance: number | null
          test_balance: number | null
          test_eligible_balance: number | null
          test_menu_earnings_balance: number | null
          test_menu_earnings_pending: number | null
          test_pending_balance: number | null
          test_rider_revenue_balance: number | null
          total_earned: number | null
          total_withdrawn: number | null
          updated_at: string
          user_id: string
          wallet_type: string | null
        }
        Insert: {
          auto_withdraw?: boolean | null
          auto_withdraw_day?: number | null
          auto_withdraw_threshold?: number | null
          balance?: number | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          dva_account_name?: string | null
          dva_account_number?: string | null
          dva_active?: boolean | null
          dva_bank_name?: string | null
          dva_created_at?: string | null
          eligible_balance?: number | null
          id?: string
          is_disabled?: boolean | null
          menu_earnings_balance?: number | null
          menu_earnings_pending?: number | null
          paystack_customer_code?: string | null
          paystack_customer_id?: number | null
          paystack_recipient_code?: string | null
          pending_balance?: number | null
          pending_payouts?: number | null
          rider_revenue_balance?: number | null
          test_balance?: number | null
          test_eligible_balance?: number | null
          test_menu_earnings_balance?: number | null
          test_menu_earnings_pending?: number | null
          test_pending_balance?: number | null
          test_rider_revenue_balance?: number | null
          total_earned?: number | null
          total_withdrawn?: number | null
          updated_at?: string
          user_id: string
          wallet_type?: string | null
        }
        Update: {
          auto_withdraw?: boolean | null
          auto_withdraw_day?: number | null
          auto_withdraw_threshold?: number | null
          balance?: number | null
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          dva_account_name?: string | null
          dva_account_number?: string | null
          dva_active?: boolean | null
          dva_bank_name?: string | null
          dva_created_at?: string | null
          eligible_balance?: number | null
          id?: string
          is_disabled?: boolean | null
          menu_earnings_balance?: number | null
          menu_earnings_pending?: number | null
          paystack_customer_code?: string | null
          paystack_customer_id?: number | null
          paystack_recipient_code?: string | null
          pending_balance?: number | null
          pending_payouts?: number | null
          rider_revenue_balance?: number | null
          test_balance?: number | null
          test_eligible_balance?: number | null
          test_menu_earnings_balance?: number | null
          test_menu_earnings_pending?: number | null
          test_pending_balance?: number | null
          test_rider_revenue_balance?: number | null
          total_earned?: number | null
          total_withdrawn?: number | null
          updated_at?: string
          user_id?: string
          wallet_type?: string | null
        }
        Relationships: []
      }
      withdrawal_requests: {
        Row: {
          amount: number
          bank_account_name: string
          bank_account_number: string
          bank_name: string
          created_at: string
          id: string
          notes: string | null
          processed_at: string | null
          requested_at: string
          status: string
          user_id: string
          user_type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          bank_account_name: string
          bank_account_number: string
          bank_name: string
          created_at?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string
          status?: string
          user_id: string
          user_type?: string
          wallet_id: string
        }
        Update: {
          amount?: number
          bank_account_name?: string
          bank_account_number?: string
          bank_name?: string
          created_at?: string
          id?: string
          notes?: string | null
          processed_at?: string | null
          requested_at?: string
          status?: string
          user_id?: string
          user_type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_vendor_role: { Args: never; Returns: undefined }
      cancel_stale_pending_orders: { Args: never; Returns: number }
      get_admin_staff_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["admin_staff_role"]
      }
      get_delivery_company_staff_role: {
        Args: { _company_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["delivery_company_staff_role"]
      }
      get_platform_environment: { Args: never; Returns: string }
      get_vendor_staff_role: {
        Args: { _user_id: string; _vendor_id: string }
        Returns: Database["public"]["Enums"]["vendor_staff_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_delivery_company_email_verified: {
        Args: { _company_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_vendor_owner: {
        Args: { _user_id: string; _vendor_id: string }
        Returns: boolean
      }
      owns_delivery_company: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      owns_vendor: {
        Args: { _user_id: string; _vendor_id: string }
        Returns: boolean
      }
      release_pending_vendor_earnings: { Args: never; Returns: number }
      rider_belongs_to_company: {
        Args: { _rider_user_id: string }
        Returns: string
      }
    }
    Enums: {
      admin_staff_role: "super_admin" | "admin" | "support" | "analyst"
      app_role: "customer" | "vendor" | "rider" | "admin" | "delivery_company"
      calorie_class: "carbs" | "protein" | "fats" | "fiber"
      delivery_company_staff_role: "owner" | "manager" | "dispatcher"
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready_for_pickup"
        | "searching_for_rider"
        | "assigned"
        | "picked_up"
        | "on_the_way"
        | "delivered"
        | "cancelled"
      vendor_category: "restaurant" | "pharmacy" | "market"
      vendor_staff_role: "owner" | "manager" | "cashier" | "viewer"
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
      admin_staff_role: ["super_admin", "admin", "support", "analyst"],
      app_role: ["customer", "vendor", "rider", "admin", "delivery_company"],
      calorie_class: ["carbs", "protein", "fats", "fiber"],
      delivery_company_staff_role: ["owner", "manager", "dispatcher"],
      order_status: [
        "pending",
        "confirmed",
        "preparing",
        "ready_for_pickup",
        "searching_for_rider",
        "assigned",
        "picked_up",
        "on_the_way",
        "delivered",
        "cancelled",
      ],
      vendor_category: ["restaurant", "pharmacy", "market"],
      vendor_staff_role: ["owner", "manager", "cashier", "viewer"],
    },
  },
} as const
