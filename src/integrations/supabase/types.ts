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
      account_deletion_requests: {
        Row: {
          created_at: string
          id: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
          outlet_id: string | null
          product_id: string | null
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
          outlet_id?: string | null
          product_id?: string | null
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
          outlet_id?: string | null
          product_id?: string | null
          selection_type?: string
          sort_order?: number | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_groups_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
      addon_item_choices: {
        Row: {
          addon_item_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          price: number
          sort_order: number | null
        }
        Insert: {
          addon_item_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          price?: number
          sort_order?: number | null
        }
        Update: {
          addon_item_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          price?: number
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "addon_item_choices_addon_item_id_fkey"
            columns: ["addon_item_id"]
            isOneToOne: false
            referencedRelation: "addon_items"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_items: {
        Row: {
          additional_price: number
          addon_group_id: string
          calories: number | null
          choice_required: boolean
          choice_selection_type: string
          created_at: string
          description: string | null
          has_choices: boolean
          id: string
          is_available: boolean
          linked_product_id: string | null
          name: string
          pricing_type: string
          sort_order: number | null
        }
        Insert: {
          additional_price?: number
          addon_group_id: string
          calories?: number | null
          choice_required?: boolean
          choice_selection_type?: string
          created_at?: string
          description?: string | null
          has_choices?: boolean
          id?: string
          is_available?: boolean
          linked_product_id?: string | null
          name: string
          pricing_type?: string
          sort_order?: number | null
        }
        Update: {
          additional_price?: number
          addon_group_id?: string
          calories?: number | null
          choice_required?: boolean
          choice_selection_type?: string
          created_at?: string
          description?: string | null
          has_choices?: boolean
          id?: string
          is_available?: boolean
          linked_product_id?: string | null
          name?: string
          pricing_type?: string
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
          {
            foreignKeyName: "addon_items_linked_product_id_fkey"
            columns: ["linked_product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
      combo_addon_groups: {
        Row: {
          addon_group_id: string
          combo_id: string
          created_at: string
          id: string
        }
        Insert: {
          addon_group_id: string
          combo_id: string
          created_at?: string
          id?: string
        }
        Update: {
          addon_group_id?: string
          combo_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_addon_groups_addon_group_id_fkey"
            columns: ["addon_group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_addon_groups_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "combos"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_items: {
        Row: {
          combo_id: string
          created_at: string | null
          id: string
          product_id: string | null
          quantity: number | null
          takeaway_pack_id: string | null
        }
        Insert: {
          combo_id: string
          created_at?: string | null
          id?: string
          product_id?: string | null
          quantity?: number | null
          takeaway_pack_id?: string | null
        }
        Update: {
          combo_id?: string
          created_at?: string | null
          id?: string
          product_id?: string | null
          quantity?: number | null
          takeaway_pack_id?: string | null
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
          {
            foreignKeyName: "combo_items_takeaway_pack_id_fkey"
            columns: ["takeaway_pack_id"]
            isOneToOne: false
            referencedRelation: "takeaway_packs"
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combos_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combos_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_overrides: {
        Row: {
          commission_type: string
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          fixed_value: number | null
          id: string
          max_value: number | null
          min_value: number | null
          notes: string | null
          percentage_value: number | null
          updated_at: string
        }
        Insert: {
          commission_type?: string
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          fixed_value?: number | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          notes?: string | null
          percentage_value?: number | null
          updated_at?: string
        }
        Update: {
          commission_type?: string
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          fixed_value?: number | null
          id?: string
          max_value?: number | null
          min_value?: number | null
          notes?: string | null
          percentage_value?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      cuisine_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cuisine_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cuisine_categories"
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
          slug: string | null
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
          slug?: string | null
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
          slug?: string | null
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
          distance_bonus: number | null
          distance_km: number
          estimated_delivery_minutes: number | null
          estimated_pickup_minutes: number | null
          expires_at: string
          id: string
          platform_fee: number | null
          priority_tier: string
          responded_at: string | null
          rider_profile_id: string
          rider_share: number
          rider_user_id: string
          status: string | null
          subsidy_amount: number | null
          time_period: string | null
          time_surge_bonus: number | null
          total_surge_bonus: number | null
          vendor_address: string | null
          vendor_name: string | null
          weather_condition: string | null
          weather_surge_bonus: number | null
        }
        Insert: {
          created_at?: string | null
          customer_address?: string | null
          delivery_fee: number
          dispatch_request_id: string
          distance_bonus?: number | null
          distance_km: number
          estimated_delivery_minutes?: number | null
          estimated_pickup_minutes?: number | null
          expires_at: string
          id?: string
          platform_fee?: number | null
          priority_tier: string
          responded_at?: string | null
          rider_profile_id: string
          rider_share: number
          rider_user_id: string
          status?: string | null
          subsidy_amount?: number | null
          time_period?: string | null
          time_surge_bonus?: number | null
          total_surge_bonus?: number | null
          vendor_address?: string | null
          vendor_name?: string | null
          weather_condition?: string | null
          weather_surge_bonus?: number | null
        }
        Update: {
          created_at?: string | null
          customer_address?: string | null
          delivery_fee?: number
          dispatch_request_id?: string
          distance_bonus?: number | null
          distance_km?: number
          estimated_delivery_minutes?: number | null
          estimated_pickup_minutes?: number | null
          expires_at?: string
          id?: string
          platform_fee?: number | null
          priority_tier?: string
          responded_at?: string | null
          rider_profile_id?: string
          rider_share?: number
          rider_user_id?: string
          status?: string | null
          subsidy_amount?: number | null
          time_period?: string | null
          time_surge_bonus?: number | null
          total_surge_bonus?: number | null
          vendor_address?: string | null
          vendor_name?: string | null
          weather_condition?: string | null
          weather_surge_bonus?: number | null
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
          {
            foreignKeyName: "dispatch_offers_rider_profile_id_fkey"
            columns: ["rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles_safe"
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
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
            foreignKeyName: "dispatch_requests_accepted_by_rider_profile_id_fkey"
            columns: ["accepted_by_rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles_safe"
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
            foreignKeyName: "dispatch_requests_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
      disputes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          customer_name: string | null
          customer_refund_reference: string | null
          delivery_fee: number | null
          environment: string
          fault_party: string
          id: string
          notes: string | null
          order_id: string
          order_number: string
          order_total: number | null
          platform_debit_reference: string | null
          platform_deduction: number
          reason: string
          refund_amount: number
          rejection_reason: string | null
          rider_debit_reference: string | null
          rider_deduction: number
          rider_id: string | null
          rider_name: string | null
          status: string
          updated_at: string
          vendor_debit_reference: string | null
          vendor_deduction: number
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          customer_name?: string | null
          customer_refund_reference?: string | null
          delivery_fee?: number | null
          environment?: string
          fault_party: string
          id?: string
          notes?: string | null
          order_id: string
          order_number: string
          order_total?: number | null
          platform_debit_reference?: string | null
          platform_deduction?: number
          reason: string
          refund_amount: number
          rejection_reason?: string | null
          rider_debit_reference?: string | null
          rider_deduction?: number
          rider_id?: string | null
          rider_name?: string | null
          status?: string
          updated_at?: string
          vendor_debit_reference?: string | null
          vendor_deduction?: number
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_refund_reference?: string | null
          delivery_fee?: number | null
          environment?: string
          fault_party?: string
          id?: string
          notes?: string | null
          order_id?: string
          order_number?: string
          order_total?: number | null
          platform_debit_reference?: string | null
          platform_deduction?: number
          reason?: string
          refund_amount?: number
          rejection_reason?: string | null
          rider_debit_reference?: string | null
          rider_deduction?: number
          rider_id?: string | null
          rider_name?: string | null
          status?: string
          updated_at?: string
          vendor_debit_reference?: string | null
          vendor_deduction?: number
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
      expense_requisitions: {
        Row: {
          account_name: string | null
          account_number: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          bank_code: string | null
          bank_name: string | null
          category: string
          created_at: string
          description: string | null
          environment: string
          id: string
          paid_at: string | null
          paid_by: string | null
          payment_method: string | null
          payment_note: string | null
          paystack_reference: string | null
          paystack_transfer_code: string | null
          rejection_reason: string | null
          requested_by: string
          requested_by_name: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          category?: string
          created_at?: string
          description?: string | null
          environment?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          rejection_reason?: string | null
          requested_by: string
          requested_by_name: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          category?: string
          created_at?: string
          description?: string | null
          environment?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: string | null
          payment_note?: string | null
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          rejection_reason?: string | null
          requested_by?: string
          requested_by_name?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      faqs: {
        Row: {
          answer: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          platform: string
          question: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          platform?: string
          question: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          platform?: string
          question?: string
          sort_order?: number
          updated_at?: string
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
      legal_acceptances: {
        Row: {
          accepted_at: string
          document_id: string
          document_type: string
          document_version: number
          id: string
          ip_address: string | null
          role: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          document_id: string
          document_type: string
          document_version: number
          id?: string
          ip_address?: string | null
          role: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          document_id?: string
          document_type?: string
          document_version?: number
          id?: string
          ip_address?: string | null
          role?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "legal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          content: string
          created_at: string
          document_type: string
          force_reaccept: boolean
          id: string
          is_current: boolean
          published_by: string | null
          requires_acceptance: boolean
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          document_type: string
          force_reaccept?: boolean
          id?: string
          is_current?: boolean
          published_by?: string | null
          requires_acceptance?: boolean
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          document_type?: string
          force_reaccept?: boolean
          id?: string
          is_current?: boolean
          published_by?: string | null
          requires_acceptance?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      order_financials: {
        Row: {
          company_revenue: number
          created_at: string | null
          environment: string | null
          id: string
          logistics_commission_amount: number | null
          logistics_commission_percentage: number | null
          menu_price: number
          order_id: string
          outlet_id: string | null
          promo_discount_amount: number
          promo_source: string | null
          promo_type: string | null
          revenue_status: string
          rider_commission_amount: number | null
          rider_commission_percentage: number | null
          service_fee_amount: number | null
          vendor_commission_amount: number
          vendor_commission_percentage: number
          vendor_payout: number
        }
        Insert: {
          company_revenue: number
          created_at?: string | null
          environment?: string | null
          id?: string
          logistics_commission_amount?: number | null
          logistics_commission_percentage?: number | null
          menu_price: number
          order_id: string
          outlet_id?: string | null
          promo_discount_amount?: number
          promo_source?: string | null
          promo_type?: string | null
          revenue_status?: string
          rider_commission_amount?: number | null
          rider_commission_percentage?: number | null
          service_fee_amount?: number | null
          vendor_commission_amount: number
          vendor_commission_percentage: number
          vendor_payout: number
        }
        Update: {
          company_revenue?: number
          created_at?: string | null
          environment?: string | null
          id?: string
          logistics_commission_amount?: number | null
          logistics_commission_percentage?: number | null
          menu_price?: number
          order_id?: string
          outlet_id?: string | null
          promo_discount_amount?: number
          promo_source?: string | null
          promo_type?: string | null
          revenue_status?: string
          rider_commission_amount?: number | null
          rider_commission_percentage?: number | null
          service_fee_amount?: number | null
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
          {
            foreignKeyName: "order_financials_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
          image_url: string | null
          order_item_id: string
        }
        Insert: {
          additional_price?: number
          addon_group_name: string
          addon_item_name: string
          calories?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          order_item_id: string
        }
        Update: {
          additional_price?: number
          addon_group_name?: string
          addon_item_name?: string
          calories?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
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
          package_id: string | null
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
          package_id?: string | null
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
          package_id?: string | null
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
            foreignKeyName: "order_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "order_packages"
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
      order_packages: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          recipient_name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          recipient_name?: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          recipient_name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_packages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
          extra_package_fee: number
          id: string
          menu_subtotal: number | null
          order_number: string
          outlet_id: string | null
          package_count: number
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
          extra_package_fee?: number
          id?: string
          menu_subtotal?: number | null
          order_number: string
          outlet_id?: string | null
          package_count?: number
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
          extra_package_fee?: number
          id?: string
          menu_subtotal?: number | null
          order_number?: string
          outlet_id?: string | null
          package_count?: number
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
            foreignKeyName: "orders_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
      outlet_product_overrides: {
        Row: {
          created_at: string
          id: string
          is_available: boolean
          outlet_id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_available?: boolean
          outlet_id: string
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_available?: boolean
          outlet_id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_product_overrides_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_product_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
          environment: string | null
          failure_reason: string | null
          id: string
          outlet_id: string | null
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
          environment?: string | null
          failure_reason?: string | null
          id?: string
          outlet_id?: string | null
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
          environment?: string | null
          failure_reason?: string | null
          id?: string
          outlet_id?: string | null
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
            foreignKeyName: "payout_requests_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
      payroll_employees: {
        Row: {
          admin_staff_id: string
          bank_account_number: string | null
          bank_code: string | null
          bank_name: string | null
          base_salary: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          paystack_recipient_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_staff_id: string
          bank_account_number?: string | null
          bank_code?: string | null
          bank_name?: string | null
          base_salary?: number
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          paystack_recipient_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_staff_id?: string
          bank_account_number?: string | null
          bank_code?: string | null
          bank_name?: string | null
          base_salary?: number
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          paystack_recipient_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employees_admin_staff_id_fkey"
            columns: ["admin_staff_id"]
            isOneToOne: true
            referencedRelation: "admin_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          bank_account_number: string | null
          bank_name: string | null
          base_salary: number
          bonus: number
          bonus_note: string | null
          created_at: string
          deduction_note: string | null
          deductions: number
          employee_name: string
          failure_reason: string | null
          id: string
          net_pay: number
          payroll_employee_id: string
          payroll_run_id: string
          paystack_reference: string | null
          paystack_transfer_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_name?: string | null
          base_salary?: number
          bonus?: number
          bonus_note?: string | null
          created_at?: string
          deduction_note?: string | null
          deductions?: number
          employee_name: string
          failure_reason?: string | null
          id?: string
          net_pay?: number
          payroll_employee_id: string
          payroll_run_id: string
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bank_account_number?: string | null
          bank_name?: string | null
          base_salary?: number
          bonus?: number
          bonus_note?: string | null
          created_at?: string
          deduction_note?: string | null
          deductions?: number
          employee_name?: string
          failure_reason?: string | null
          id?: string
          net_pay?: number
          payroll_employee_id?: string
          payroll_run_id?: string
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_payroll_employee_id_fkey"
            columns: ["payroll_employee_id"]
            isOneToOne: false
            referencedRelation: "payroll_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          created_by: string
          environment: string | null
          failed_count: number
          id: string
          notes: string | null
          pay_period_end: string
          pay_period_start: string
          processed_at: string | null
          processed_count: number
          status: string
          title: string
          total_deductions: number
          total_employees: number
          total_gross: number
          total_net: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          environment?: string | null
          failed_count?: number
          id?: string
          notes?: string | null
          pay_period_end: string
          pay_period_start: string
          processed_at?: string | null
          processed_count?: number
          status?: string
          title: string
          total_deductions?: number
          total_employees?: number
          total_gross?: number
          total_net?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          environment?: string | null
          failed_count?: number
          id?: string
          notes?: string | null
          pay_period_end?: string
          pay_period_start?: string
          processed_at?: string | null
          processed_count?: number
          status?: string
          title?: string
          total_deductions?: number
          total_employees?: number
          total_gross?: number
          total_net?: number
          updated_at?: string
        }
        Relationships: []
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
      product_addon_groups: {
        Row: {
          addon_group_id: string
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          addon_group_id: string
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          addon_group_id?: string
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_addon_groups_addon_group_id_fkey"
            columns: ["addon_group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_addon_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          outlet_id: string | null
          sort_order: number | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          outlet_id?: string | null
          sort_order?: number | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          outlet_id?: string | null
          sort_order?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
          cuisine_category_id: string | null
          description: string | null
          discount_price: number | null
          fats_grams: number | null
          fiber_grams: number | null
          id: string
          image_url: string | null
          is_available: boolean | null
          meal_type: string
          name: string
          nutrient_tags: string[] | null
          outlet_id: string | null
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
          cuisine_category_id?: string | null
          description?: string | null
          discount_price?: number | null
          fats_grams?: number | null
          fiber_grams?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          meal_type?: string
          name: string
          nutrient_tags?: string[] | null
          outlet_id?: string | null
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
          cuisine_category_id?: string | null
          description?: string | null
          discount_price?: number | null
          fats_grams?: number | null
          fiber_grams?: number | null
          id?: string
          image_url?: string | null
          is_available?: boolean | null
          meal_type?: string
          name?: string
          nutrient_tags?: string[] | null
          outlet_id?: string | null
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
            foreignKeyName: "products_cuisine_category_id_fkey"
            columns: ["cuisine_category_id"]
            isOneToOne: false
            referencedRelation: "cuisine_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
          referral_code: string | null
          referred_by: string | null
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
          referral_code?: string | null
          referred_by?: string | null
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
          referral_code?: string | null
          referred_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
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
            foreignKeyName: "promo_codes_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          fcm_token: string | null
          id: string
          p256dh: string
          subscription_type: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          fcm_token?: string | null
          id?: string
          p256dh: string
          subscription_type?: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          fcm_token?: string | null
          id?: string
          p256dh?: string
          subscription_type?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          ip_address: string | null
          referred_bonus: number
          referred_credited: boolean
          referred_id: string
          referrer_bonus: number
          referrer_credited: boolean
          referrer_id: string
          status: string
          trigger_order_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          referred_bonus?: number
          referred_credited?: boolean
          referred_id: string
          referrer_bonus?: number
          referrer_credited?: boolean
          referrer_id: string
          status?: string
          trigger_order_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          referred_bonus?: number
          referred_credited?: boolean
          referred_id?: string
          referrer_bonus?: number
          referrer_credited?: boolean
          referrer_id?: string
          status?: string
          trigger_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_trigger_order_id_fkey"
            columns: ["trigger_order_id"]
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
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
            foreignKeyName: "reviews_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
      rider_distance_logs: {
        Row: {
          created_at: string
          distance_km: number
          environment: string
          id: string
          log_date: string
          order_id: string | null
          rider_user_id: string
        }
        Insert: {
          created_at?: string
          distance_km?: number
          environment?: string
          id?: string
          log_date?: string
          order_id?: string | null
          rider_user_id: string
        }
        Update: {
          created_at?: string
          distance_km?: number
          environment?: string
          id?: string
          log_date?: string
          order_id?: string | null
          rider_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rider_distance_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_payout_details: {
        Row: {
          created_at: string
          delivery_fee: number
          distance_bonus: number
          distance_km: number
          environment: string | null
          final_rider_pay: number
          id: string
          order_id: string
          platform_fee: number
          raw_rider_pay: number
          rider_user_id: string
          subsidy_amount: number
          time_period: string | null
          time_surge_bonus: number
          total_surge_bonus: number
          weather_condition: string | null
          weather_surge_bonus: number
        }
        Insert: {
          created_at?: string
          delivery_fee?: number
          distance_bonus?: number
          distance_km?: number
          environment?: string | null
          final_rider_pay?: number
          id?: string
          order_id: string
          platform_fee?: number
          raw_rider_pay?: number
          rider_user_id: string
          subsidy_amount?: number
          time_period?: string | null
          time_surge_bonus?: number
          total_surge_bonus?: number
          weather_condition?: string | null
          weather_surge_bonus?: number
        }
        Update: {
          created_at?: string
          delivery_fee?: number
          distance_bonus?: number
          distance_km?: number
          environment?: string | null
          final_rider_pay?: number
          id?: string
          order_id?: string
          platform_fee?: number
          raw_rider_pay?: number
          rider_user_id?: string
          subsidy_amount?: number
          time_period?: string | null
          time_surge_bonus?: number
          total_surge_bonus?: number
          weather_condition?: string | null
          weather_surge_bonus?: number
        }
        Relationships: [
          {
            foreignKeyName: "rider_payout_details_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
      support_messages: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          sender_id: string
          sender_type: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          sender_id: string
          sender_type: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          sender_id?: string
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_admin_id: string | null
          category: Database["public"]["Enums"]["support_category"]
          created_at: string
          id: string
          rated_at: string | null
          rating: number | null
          rating_comment: string | null
          status: Database["public"]["Enums"]["support_ticket_status"]
          subject: string
          updated_at: string
          user_id: string
          user_type: Database["public"]["Enums"]["support_user_type"]
        }
        Insert: {
          assigned_admin_id?: string | null
          category: Database["public"]["Enums"]["support_category"]
          created_at?: string
          id?: string
          rated_at?: string | null
          rating?: number | null
          rating_comment?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          subject: string
          updated_at?: string
          user_id: string
          user_type: Database["public"]["Enums"]["support_user_type"]
        }
        Update: {
          assigned_admin_id?: string | null
          category?: Database["public"]["Enums"]["support_category"]
          created_at?: string
          id?: string
          rated_at?: string | null
          rating?: number | null
          rating_comment?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          subject?: string
          updated_at?: string
          user_id?: string
          user_type?: Database["public"]["Enums"]["support_user_type"]
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
          max_capacity: number | null
          name: string
          outlet_id: string | null
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
          max_capacity?: number | null
          name: string
          outlet_id?: string | null
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
          max_capacity?: number | null
          name?: string
          outlet_id?: string | null
          price?: number
          sort_order?: number | null
          threshold_type?: string
          threshold_value?: number
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeaway_packs_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
      vehicle_type_configs: {
        Row: {
          base_delivery_rate: number
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          max_delivery_distance_km: number
          per_km_rate: number | null
          sort_order: number
          updated_at: string
          vehicle_type: string
        }
        Insert: {
          base_delivery_rate?: number
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          max_delivery_distance_km?: number
          per_km_rate?: number | null
          sort_order?: number
          updated_at?: string
          vehicle_type: string
        }
        Update: {
          base_delivery_rate?: number
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          max_delivery_distance_km?: number
          per_km_rate?: number | null
          sort_order?: number
          updated_at?: string
          vehicle_type?: string
        }
        Relationships: []
      }
      vendor_commission_promos: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          is_active: boolean
          normal_commission_rate: number
          notes: string | null
          promo_commission_rate: number
          start_date: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          is_active?: boolean
          normal_commission_rate: number
          notes?: string | null
          promo_commission_rate: number
          start_date?: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          is_active?: boolean
          normal_commission_rate?: number
          notes?: string | null
          promo_commission_rate?: number
          start_date?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_commission_promos_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_location_logs: {
        Row: {
          action: string
          created_at: string | null
          device_latitude: number | null
          device_longitude: number | null
          distance_m: number | null
          id: string
          notes: string | null
          outlet_id: string | null
          performed_by: string | null
          result: string | null
          vendor_id: string
          verified_latitude: number | null
          verified_longitude: number | null
        }
        Insert: {
          action: string
          created_at?: string | null
          device_latitude?: number | null
          device_longitude?: number | null
          distance_m?: number | null
          id?: string
          notes?: string | null
          outlet_id?: string | null
          performed_by?: string | null
          result?: string | null
          vendor_id: string
          verified_latitude?: number | null
          verified_longitude?: number | null
        }
        Update: {
          action?: string
          created_at?: string | null
          device_latitude?: number | null
          device_longitude?: number | null
          distance_m?: number | null
          id?: string
          notes?: string | null
          outlet_id?: string | null
          performed_by?: string | null
          result?: string | null
          vendor_id?: string
          verified_latitude?: number | null
          verified_longitude?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_location_logs_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_location_logs_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_outlets: {
        Row: {
          address: string | null
          banner_url: string | null
          city: string | null
          created_at: string
          delivery_mode: string | null
          description: string | null
          estimated_delivery_minutes: number | null
          geo_lock_reason: string | null
          geo_locked_at: string | null
          geo_verification_status: string | null
          id: string
          is_active: boolean
          is_approved: boolean
          is_default: boolean
          is_open: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          min_order_amount: number | null
          outlet_code: string
          outlet_name: string
          outlet_surname: string | null
          rating: number | null
          sales_radius: number | null
          social_media_handles: Json | null
          state: string | null
          store_type: string | null
          tolerance_radius_m: number | null
          total_ratings: number | null
          updated_at: string
          vendor_id: string
          verified_latitude: number | null
          verified_longitude: number | null
        }
        Insert: {
          address?: string | null
          banner_url?: string | null
          city?: string | null
          created_at?: string
          delivery_mode?: string | null
          description?: string | null
          estimated_delivery_minutes?: number | null
          geo_lock_reason?: string | null
          geo_locked_at?: string | null
          geo_verification_status?: string | null
          id?: string
          is_active?: boolean
          is_approved?: boolean
          is_default?: boolean
          is_open?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          outlet_code?: string
          outlet_name?: string
          outlet_surname?: string | null
          rating?: number | null
          sales_radius?: number | null
          social_media_handles?: Json | null
          state?: string | null
          store_type?: string | null
          tolerance_radius_m?: number | null
          total_ratings?: number | null
          updated_at?: string
          vendor_id: string
          verified_latitude?: number | null
          verified_longitude?: number | null
        }
        Update: {
          address?: string | null
          banner_url?: string | null
          city?: string | null
          created_at?: string
          delivery_mode?: string | null
          description?: string | null
          estimated_delivery_minutes?: number | null
          geo_lock_reason?: string | null
          geo_locked_at?: string | null
          geo_verification_status?: string | null
          id?: string
          is_active?: boolean
          is_approved?: boolean
          is_default?: boolean
          is_open?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order_amount?: number | null
          outlet_code?: string
          outlet_name?: string
          outlet_surname?: string | null
          rating?: number | null
          sales_radius?: number | null
          social_media_handles?: Json | null
          state?: string | null
          store_type?: string | null
          tolerance_radius_m?: number | null
          total_ratings?: number | null
          updated_at?: string
          vendor_id?: string
          verified_latitude?: number | null
          verified_longitude?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_outlets_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_reverification_requests: {
        Row: {
          admin_notes: string | null
          created_at: string | null
          id: string
          new_latitude: number
          new_longitude: number
          outlet_id: string | null
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string | null
          id?: string
          new_latitude: number
          new_longitude: number
          outlet_id?: string | null
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string | null
          id?: string
          new_latitude?: number
          new_longitude?: number
          outlet_id?: string | null
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_reverification_requests_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_reverification_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_rider_invites: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          invite_code: string
          is_used: boolean | null
          outlet_id: string | null
          used_by: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invite_code: string
          is_used?: boolean | null
          outlet_id?: string | null
          used_by?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean | null
          outlet_id?: string | null
          used_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_rider_invites_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_rider_invites_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_rider_invites_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "rider_profiles_safe"
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
          restriction_mode?: string | null
          rider_profile_id?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_riders_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_riders_rider_profile_id_fkey"
            columns: ["rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_riders_rider_profile_id_fkey"
            columns: ["rider_profile_id"]
            isOneToOne: false
            referencedRelation: "rider_profiles_safe"
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
          permissions?: string[] | null
          role?: Database["public"]["Enums"]["vendor_staff_role"]
          updated_at?: string | null
          user_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_staff_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_staff_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_verification_documents: {
        Row: {
          created_at: string | null
          document_type: string
          file_name: string | null
          file_url: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          document_type: string
          file_name?: string | null
          file_url: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          document_type?: string
          file_name?: string | null
          file_url?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_verification_documents_vendor_id_fkey"
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
          outlet_id: string | null
          vendor_id: string
        }
        Insert: {
          close_time: string
          day_of_week: number
          id?: string
          is_closed?: boolean | null
          open_time: string
          outlet_id?: string | null
          vendor_id: string
        }
        Update: {
          close_time?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean | null
          open_time?: string
          outlet_id?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_working_hours_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
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
          allow_rider_external_jobs: boolean
          approved_for_live: boolean | null
          banner_url: string | null
          category: Database["public"]["Enums"]["vendor_category"]
          city: string
          combos_only: boolean
          commission_rate: number | null
          created_at: string
          delivery_fee: number | null
          delivery_mode: string | null
          description: string | null
          email: string | null
          estimated_delivery_minutes: number | null
          geo_lock_reason: string | null
          geo_locked_at: string | null
          geo_verification_status: string | null
          id: string
          is_active: boolean | null
          is_open: boolean
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
          sales_radius: number | null
          slug: string | null
          social_media_handles: Json | null
          state: string
          store_type: string
          tolerance_radius_m: number | null
          total_ratings: number | null
          updated_at: string
          user_id: string
          verified_latitude: number | null
          verified_longitude: number | null
        }
        Insert: {
          address: string
          allow_rider_external_jobs?: boolean
          approved_for_live?: boolean | null
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city: string
          combos_only?: boolean
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          delivery_mode?: string | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          geo_lock_reason?: string | null
          geo_locked_at?: string | null
          geo_verification_status?: string | null
          id?: string
          is_active?: boolean | null
          is_open?: boolean
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
          sales_radius?: number | null
          slug?: string | null
          social_media_handles?: Json | null
          state: string
          store_type?: string
          tolerance_radius_m?: number | null
          total_ratings?: number | null
          updated_at?: string
          user_id: string
          verified_latitude?: number | null
          verified_longitude?: number | null
        }
        Update: {
          address?: string
          allow_rider_external_jobs?: boolean
          approved_for_live?: boolean | null
          banner_url?: string | null
          category?: Database["public"]["Enums"]["vendor_category"]
          city?: string
          combos_only?: boolean
          commission_rate?: number | null
          created_at?: string
          delivery_fee?: number | null
          delivery_mode?: string | null
          description?: string | null
          email?: string | null
          estimated_delivery_minutes?: number | null
          geo_lock_reason?: string | null
          geo_locked_at?: string | null
          geo_verification_status?: string | null
          id?: string
          is_active?: boolean | null
          is_open?: boolean
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
          sales_radius?: number | null
          slug?: string | null
          social_media_handles?: Json | null
          state?: string
          store_type?: string
          tolerance_radius_m?: number | null
          total_ratings?: number | null
          updated_at?: string
          user_id?: string
          verified_latitude?: number | null
          verified_longitude?: number | null
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
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
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
            foreignKeyName: "wallet_transactions_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
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
          outlet_id: string | null
          paystack_customer_code: string | null
          paystack_customer_id: number | null
          paystack_recipient_code: string | null
          pending_balance: number | null
          pending_payouts: number | null
          referral_bonus_balance: number | null
          referral_bonus_expires_at: string | null
          rider_revenue_balance: number | null
          test_balance: number | null
          test_eligible_balance: number | null
          test_menu_earnings_balance: number | null
          test_menu_earnings_pending: number | null
          test_pending_balance: number | null
          test_referral_bonus_balance: number | null
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
          outlet_id?: string | null
          paystack_customer_code?: string | null
          paystack_customer_id?: number | null
          paystack_recipient_code?: string | null
          pending_balance?: number | null
          pending_payouts?: number | null
          referral_bonus_balance?: number | null
          referral_bonus_expires_at?: string | null
          rider_revenue_balance?: number | null
          test_balance?: number | null
          test_eligible_balance?: number | null
          test_menu_earnings_balance?: number | null
          test_menu_earnings_pending?: number | null
          test_pending_balance?: number | null
          test_referral_bonus_balance?: number | null
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
          outlet_id?: string | null
          paystack_customer_code?: string | null
          paystack_customer_id?: number | null
          paystack_recipient_code?: string | null
          pending_balance?: number | null
          pending_payouts?: number | null
          referral_bonus_balance?: number | null
          referral_bonus_expires_at?: string | null
          rider_revenue_balance?: number | null
          test_balance?: number | null
          test_eligible_balance?: number | null
          test_menu_earnings_balance?: number | null
          test_menu_earnings_pending?: number | null
          test_pending_balance?: number | null
          test_referral_bonus_balance?: number | null
          test_rider_revenue_balance?: number | null
          total_earned?: number | null
          total_withdrawn?: number | null
          updated_at?: string
          user_id?: string
          wallet_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "vendor_outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_otps: {
        Row: {
          amount: number
          created_at: string | null
          email: string
          expires_at: string
          id: string
          otp_code: string
          used: boolean | null
          used_at: string | null
          user_type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          otp_code: string
          used?: boolean | null
          used_at?: string | null
          user_type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          otp_code?: string
          used?: boolean | null
          used_at?: string | null
          user_type?: string
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
      rider_profiles_safe: {
        Row: {
          affiliated_vendor_id: string | null
          created_at: string | null
          current_latitude: number | null
          current_longitude: number | null
          delivery_company_id: string | null
          email: string | null
          id: string | null
          is_email_verified: boolean | null
          is_online: boolean | null
          is_test_rider: boolean | null
          is_verified: boolean | null
          nin_verified: boolean | null
          preferred_city: string | null
          preferred_latitude: number | null
          preferred_longitude: number | null
          preferred_state: string | null
          rating: number | null
          total_deliveries: number | null
          updated_at: string | null
          user_id: string | null
          vehicle_plate: string | null
          vehicle_type: string | null
          work_radius_km: number | null
        }
        Insert: {
          affiliated_vendor_id?: string | null
          created_at?: string | null
          current_latitude?: number | null
          current_longitude?: number | null
          delivery_company_id?: string | null
          email?: string | null
          id?: string | null
          is_email_verified?: boolean | null
          is_online?: boolean | null
          is_test_rider?: boolean | null
          is_verified?: boolean | null
          nin_verified?: boolean | null
          preferred_city?: string | null
          preferred_latitude?: number | null
          preferred_longitude?: number | null
          preferred_state?: string | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
          work_radius_km?: number | null
        }
        Update: {
          affiliated_vendor_id?: string | null
          created_at?: string | null
          current_latitude?: number | null
          current_longitude?: number | null
          delivery_company_id?: string | null
          email?: string | null
          id?: string | null
          is_email_verified?: boolean | null
          is_online?: boolean | null
          is_test_rider?: boolean | null
          is_verified?: boolean | null
          nin_verified?: boolean | null
          preferred_city?: string | null
          preferred_latitude?: number | null
          preferred_longitude?: number | null
          preferred_state?: string | null
          rating?: number | null
          total_deliveries?: number | null
          updated_at?: string | null
          user_id?: string | null
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
    }
    Functions: {
      add_vendor_role: { Args: never; Returns: undefined }
      admin_adjust_wallet_balance: {
        Args: {
          p_adjust_type: string
          p_amount: number
          p_environment?: string
          p_notes: string
          p_reference?: string
          p_wallet_id: string
        }
        Returns: Json
      }
      apply_vendor_commission_promos: { Args: never; Returns: undefined }
      bytea_to_text: { Args: { data: string }; Returns: string }
      cancel_stale_pending_orders: { Args: never; Returns: number }
      generate_slug: { Args: { input_text: string }; Returns: string }
      get_admin_staff_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["admin_staff_role"]
      }
      get_default_outlet_id: { Args: { _vendor_id: string }; Returns: string }
      get_delivery_company_staff_role: {
        Args: { _company_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["delivery_company_staff_role"]
      }
      get_platform_environment: { Args: never; Returns: string }
      get_rider_profile_id: { Args: { _user_id: string }; Returns: string }
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
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
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
      owns_outlet: {
        Args: { _outlet_id: string; _user_id: string }
        Returns: boolean
      }
      owns_vendor: {
        Args: { _user_id: string; _vendor_id: string }
        Returns: boolean
      }
      reconcile_customer_wallet: {
        Args: { p_wallet_id: string }
        Returns: undefined
      }
      reconcile_delivery_company_wallet: {
        Args: { p_wallet_id: string }
        Returns: undefined
      }
      reconcile_rider_wallet: {
        Args: { p_wallet_id: string }
        Returns: undefined
      }
      reconcile_vendor_wallet: {
        Args: { p_wallet_id: string }
        Returns: undefined
      }
      release_pending_vendor_earnings: { Args: never; Returns: number }
      resolve_commission_rate: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: number
      }
      resolve_workspace_slug: {
        Args: { workspace_slug: string }
        Returns: {
          logo_url: string
          workspace_id: string
          workspace_name: string
          workspace_type: string
        }[]
      }
      rider_belongs_to_company: {
        Args: { _rider_user_id: string }
        Returns: string
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
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
      support_category:
        | "refund"
        | "withdrawal"
        | "order_issue"
        | "account_issue"
        | "payment"
        | "delivery"
        | "general"
      support_ticket_status: "open" | "in_progress" | "resolved" | "closed"
      support_user_type: "customer" | "vendor" | "rider" | "logistics"
      vendor_category: "restaurant" | "pharmacy" | "market"
      vendor_staff_role: "owner" | "manager" | "cashier" | "viewer"
      vendor_verification_status:
        | "unverified"
        | "pending_verification"
        | "verified"
        | "locked_pending_reverify"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
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
      support_category: [
        "refund",
        "withdrawal",
        "order_issue",
        "account_issue",
        "payment",
        "delivery",
        "general",
      ],
      support_ticket_status: ["open", "in_progress", "resolved", "closed"],
      support_user_type: ["customer", "vendor", "rider", "logistics"],
      vendor_category: ["restaurant", "pharmacy", "market"],
      vendor_staff_role: ["owner", "manager", "cashier", "viewer"],
      vendor_verification_status: [
        "unverified",
        "pending_verification",
        "verified",
        "locked_pending_reverify",
      ],
    },
  },
} as const
