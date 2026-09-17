// Edge-function modules under supabase/functions are written for Deno. A few of
// them are imported directly by tests (pure helpers only), which pulls their
// `Deno.env` references into the app typecheck. This ambient declaration keeps
// that typecheck honest without adding a runtime dependency.
declare const Deno: {
  env: { get(key: string): string | undefined };
};
