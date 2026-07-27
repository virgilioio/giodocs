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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      allowed_domains: {
        Row: {
          domain: string
          workspace_id: string
        }
        Insert: {
          domain: string
          workspace_id: string
        }
        Update: {
          domain?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      page_access: {
        Row: {
          capability: string
          created_at: string
          guest_email: string | null
          page_id: string
          user_id: string | null
        }
        Insert: {
          capability?: string
          created_at?: string
          guest_email?: string | null
          page_id: string
          user_id?: string | null
        }
        Update: {
          capability?: string
          created_at?: string
          guest_email?: string | null
          page_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_access_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_verifications: {
        Row: {
          id: string
          page_id: string
          verified_at: string
          verified_by: string
        }
        Insert: {
          id?: string
          page_id: string
          verified_at?: string
          verified_by: string
        }
        Update: {
          id?: string
          page_id?: string
          verified_at?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_verifications_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_versions: {
        Row: {
          blocks: Json
          created_at: string
          edited_by: string | null
          icon: string | null
          id: string
          page_id: string
          props: Json
          title: string
          workspace_id: string
        }
        Insert: {
          blocks: Json
          created_at?: string
          edited_by?: string | null
          icon?: string | null
          id?: string
          page_id: string
          props: Json
          title: string
          workspace_id: string
        }
        Update: {
          blocks?: Json
          created_at?: string
          edited_by?: string | null
          icon?: string | null
          id?: string
          page_id?: string
          props?: Json
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_versions_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          access_type: string
          archived_at: string | null
          blocks: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          edited_at: string
          edited_by: string | null
          icon: string
          id: string
          props: Json
          search_tsv: unknown
          title: string
          verified_at: string
          verified_by: string | null
          workspace_id: string
          ws_role: string
        }
        Insert: {
          access_type?: string
          archived_at?: string | null
          blocks?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edited_at?: string
          edited_by?: string | null
          icon?: string
          id?: string
          props?: Json
          search_tsv?: unknown
          title?: string
          verified_at?: string
          verified_by?: string | null
          workspace_id: string
          ws_role?: string
        }
        Update: {
          access_type?: string
          archived_at?: string | null
          blocks?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edited_at?: string
          edited_by?: string | null
          icon?: string
          id?: string
          props?: Json
          search_tsv?: unknown
          title?: string
          verified_at?: string
          verified_by?: string | null
          workspace_id?: string
          ws_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_ink: string
          avatar_tint: string
          created_at: string
          email: string
          full_name: string
          id: string
        }
        Insert: {
          avatar_ink?: string
          avatar_tint?: string
          created_at?: string
          email: string
          full_name?: string
          id: string
        }
        Update: {
          avatar_ink?: string
          avatar_tint?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
        }
        Relationships: []
      }
      property_defs: {
        Row: {
          id: string
          is_system: boolean
          key: string
          label: string
          open_values: boolean
          options: Json
          position: number
          type: Database["public"]["Enums"]["property_type"]
          workspace_id: string
        }
        Insert: {
          id?: string
          is_system?: boolean
          key: string
          label: string
          open_values?: boolean
          options?: Json
          position?: number
          type: Database["public"]["Enums"]["property_type"]
          workspace_id: string
        }
        Update: {
          id?: string
          is_system?: boolean
          key?: string
          label?: string
          open_values?: boolean
          options?: Json
          position?: number
          type?: Database["public"]["Enums"]["property_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_defs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      views: {
        Row: {
          created_at: string
          filter: Json
          group_by: string | null
          icon: string | null
          id: string
          layout: Database["public"]["Enums"]["view_layout"]
          name: string
          owner_id: string
          position: number
          scope: Database["public"]["Enums"]["view_scope"]
          sort: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          filter?: Json
          group_by?: string | null
          icon?: string | null
          id?: string
          layout?: Database["public"]["Enums"]["view_layout"]
          name: string
          owner_id: string
          position?: number
          scope?: Database["public"]["Enums"]["view_scope"]
          sort?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          filter?: Json
          group_by?: string | null
          icon?: string | null
          id?: string
          layout?: Database["public"]["Enums"]["view_layout"]
          name?: string
          owner_id?: string
          position?: number
          scope?: Database["public"]["Enums"]["view_scope"]
          sort?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          email: string
          email_error: string | null
          email_status: string
          expires_at: string
          id: string
          invited_at: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          email: string
          email_error?: string | null
          email_status?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          email?: string
          email_error?: string | null
          email_status?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          icon: string
          id: string
          name: string
          slug: string
          stale_days: number
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          name: string
          slug: string
          stale_days?: number
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          name?: string
          slug?: string
          stale_days?: number
        }
        Relationships: []
      }
    }
    Views: {
      workspace_invites_public: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          email: string | null
          email_status: string | null
          expires_at: string | null
          id: string | null
          invited_at: string | null
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"] | null
          workspace_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          email?: string | null
          email_status?: string | null
          expires_at?: string | null
          id?: string | null
          invited_at?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          workspace_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          email?: string | null
          email_status?: string | null
          expires_at?: string | null
          id?: string | null
          invited_at?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_workspace_invite: { Args: { p_token: string }; Returns: string }
      can_manage_page_access: { Args: { p_page: string }; Returns: boolean }
      can_read_page: { Args: { p_page: string }; Returns: boolean }
      create_workspace_invite: {
        Args: {
          p_email: string
          p_invited_by: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_workspace: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          email: string
          email_error: string | null
          email_status: string
          expires_at: string
          id: string
          invited_at: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_page: { Args: { p_page: string }; Returns: undefined }
      domain_status: { Args: { p_email: string }; Returns: string }
      fork_view: {
        Args: {
          p_filter: Json
          p_layout: Database["public"]["Enums"]["view_layout"]
          p_name: string
          p_sort: Json
          p_view: string
        }
        Returns: {
          created_at: string
          filter: Json
          group_by: string | null
          icon: string | null
          id: string
          layout: Database["public"]["Enums"]["view_layout"]
          name: string
          owner_id: string
          position: number
          scope: Database["public"]["Enums"]["view_scope"]
          sort: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_member: { Args: { p_ws: string }; Returns: boolean }
      is_owner: { Args: { p_ws: string }; Returns: boolean }
      list_areas: {
        Args: { p_workspace: string }
        Returns: {
          area: string
          page_count: number
        }[]
      }
      page_search_text: {
        Args: { p_blocks: Json; p_title: string }
        Returns: string
      }
      publish_view: {
        Args: { p_view: string }
        Returns: {
          created_at: string
          filter: Json
          group_by: string | null
          icon: string | null
          id: string
          layout: Database["public"]["Enums"]["view_layout"]
          name: string
          owner_id: string
          position: number
          scope: Database["public"]["Enums"]["view_scope"]
          sort: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_page: { Args: { p_page: string }; Returns: undefined }
      restore_page_version: { Args: { p_version: string }; Returns: undefined }
      search_pages: {
        Args: { p_limit?: number; p_q: string; p_workspace: string }
        Returns: {
          icon: string
          id: string
          props: Json
          rank: number
          snippets: Json
          title: string
        }[]
      }
      set_page_access: {
        Args: {
          p_guests: Json
          p_page: string
          p_people: Json
          p_type: string
          p_ws_role: string
        }
        Returns: undefined
      }
      set_page_property: {
        Args: { p_key: string; p_page: string; p_value: Json }
        Returns: {
          access_type: string
          archived_at: string | null
          blocks: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          edited_at: string
          edited_by: string | null
          icon: string
          id: string
          props: Json
          search_tsv: unknown
          title: string
          verified_at: string
          verified_by: string | null
          workspace_id: string
          ws_role: string
        }
        SetofOptions: {
          from: "*"
          to: "pages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_page: {
        Args: { p_page: string }
        Returns: {
          access_type: string
          archived_at: string | null
          blocks: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          edited_at: string
          edited_by: string | null
          icon: string
          id: string
          props: Json
          search_tsv: unknown
          title: string
          verified_at: string
          verified_by: string | null
          workspace_id: string
          ws_role: string
        }
        SetofOptions: {
          from: "*"
          to: "pages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      member_role: "owner" | "member"
      property_type:
        | "text"
        | "select"
        | "multi_select"
        | "person"
        | "date"
        | "number"
        | "checkbox"
        | "status"
      view_layout: "table" | "board" | "list"
      view_scope: "personal" | "team"
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
      member_role: ["owner", "member"],
      property_type: [
        "text",
        "select",
        "multi_select",
        "person",
        "date",
        "number",
        "checkbox",
        "status",
      ],
      view_layout: ["table", "board", "list"],
      view_scope: ["personal", "team"],
    },
  },
} as const
