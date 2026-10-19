# Study Buddy

A full-stack study app for college students, built by Prathika Mahalingam Thamizharasu.

Record a lecture and get clean notes, homework and a transcript, filed under the right subject from your timetable. Revise with flashcards and quizzes, search every class, and ask questions like "What did sir say about the homework on Tuesday?"

## Features
- **Sign in with email** (or Google). Notes and chats sync across phone and laptop.
- **Record classes** with one tap. Audio is compressed to MP3 in the browser, then turned into notes with a summary, key terms, formulas, homework and a full transcript.
- **Timetable-aware filing**: recordings and uploads go under the class that's on at that time.
- **Photos, PDFs, audio files and pasted text** all become notes.
- **Flashcards and scored quizzes** generated from each class.
- **Search and ask your notes**: local search across every class, and chat answers that cite which class they came from.
- **Chat with streaming answers**, Google Search for current affairs, and saved chat history.
- **Share notes** with classmates through a private link that can be turned off at any time.
- **Installable app** (PWA) with light and dark themes.

## Tech stack
| Layer | Technology |
|---|---|
| Frontend | HTML, CSS and JavaScript with no framework or build step; hosted on GitHub Pages |
| Auth | Supabase Auth (email magic link or code, optional Google) |
| Database | Supabase Postgres with Row Level Security on every table |
| Backend | Supabase Edge Function (Deno, TypeScript) that verifies the user, enforces a daily limit and calls Gemini |
| AI | Google Gemini, with automatic fallback between models and streamed responses |
| Device | IndexedDB keeps recordings safe until notes are made; Web Audio and lamejs for MP3 encoding; service worker for install and offline shell |

## Security
- The Gemini API key exists only as a server secret, never in the browser or this repository.
- Row Level Security means each user can only read and write their own rows.
- Shared notes are read through a single database function that returns one note by its unguessable link ID.
- Every Gemini request is counted, with a per-user daily limit to protect the free quota.

## Project structure
```
index.html, app.css, app.js   the app
config.js                     public Supabase URL and anon key
sw.js, manifest.json, icons/  installable app files
supabase/schema.sql           tables, security policies and functions
supabase/functions/gemini/    server function that calls Gemini
SETUP.md                      step-by-step setup guide
```

See **SETUP.md** to run your own copy.
