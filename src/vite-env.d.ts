/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Supabase project URL and anon/public key — safe to expose in the
   * browser by design (Supabase's anon key is meant to be public and is
   * constrained by Row Level Security policies on the server side; it is
   * NOT a secret). Both are optional: with neither set, the app runs
   * exactly as before with no Supabase backend and no live retrieval —
   * see src/assistant/supabase/client.ts.
   */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * URL of a developer-run relay/proxy for Gemini Live — NEVER a Gemini API
   * key. Safe to expose in the browser: it is just an endpoint address, the
   * same way VITE_SUPABASE_URL is safe. Optional: with it unset, the app
   * runs exactly as before with no Gemini Live provider available — see
   * src/assistant/voice/geminiLiveConfig.ts.
   */
  readonly VITE_GEMINI_LIVE_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
