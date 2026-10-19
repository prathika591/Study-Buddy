// Fill these in from Supabase → Project Settings → API (see SETUP.md).
// Both values are safe to publish: your data is protected by Row Level Security,
// and the Gemini key lives only on the server.
window.STUDY_BUDDY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT-ID.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",
  dailyLimit: 150,          // keep the same as DAILY_LIMIT on the server
  googleSignIn: false       // set to true after you turn on Google in Supabase (optional)
};
