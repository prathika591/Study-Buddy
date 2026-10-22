# Setting up Study Buddy

This takes about 20 minutes and costs nothing. You'll do everything in your browser.

You need:
- Your GitHub account, with the `study-buddy` repository and GitHub Pages already turned on
- A Google account, for a new Gemini API key
- An email address for Supabase

Supabase menus change from time to time. If a button has a slightly different name from what's written here, look for the closest match.

---

## 1. Create a Supabase project

1. Go to **supabase.com**, click **Start your project**, and sign up (signing in with GitHub is easiest).
2. Click **New project**.
   - **Name:** `study-buddy`
   - **Database password:** click **Generate a password** and save it somewhere safe.
   - **Region:** choose **Mumbai (South Asia)** so the app is fast in India.
3. Click **Create new project** and wait a minute or two while it sets up.

## 2. Create the database

1. In the left menu, open **SQL Editor**.
2. Click **New query**.
3. Open `supabase/schema.sql` from this folder, copy everything, and paste it in.
4. Click **Run**. You should see "Success. No rows returned".

This creates the tables for subjects, timetable, notes, chats and messages. Each table has Row Level Security turned on, which means a signed-in user can only ever see their own data.

## 3. Set up sign-in

1. Open **Authentication → URL Configuration** (sometimes under **Authentication → Sign In / Providers → URL Configuration**).
2. Set **Site URL** to your app's address, for example:
   `https://YOUR-GITHUB-USERNAME.github.io/study-buddy/`
3. Under **Redirect URLs**, click **Add URL** and add the same address. Click **Save**.
4. Open **Authentication → Sign In / Providers**, turn **Confirm email** off, and click **Save changes**. People then sign up with an email and password and are in straight away, with no email to open.

Study Buddy signs people in with an email and password. The only email it sends is the reset link when someone forgets their password; signed-in people can change their password in **Account** instead. Supabase's built-in email sender only sends a few emails per hour, which is fine for you and a few friends. If more people use the app later, add your own email sender under **Authentication → Emails → SMTP Settings**.

## 4. Create the server function that talks to Gemini

This is the part that keeps your Gemini key secret.

1. Go to **aistudio.google.com/apikey** and create a **new** Gemini key. Don't reuse any key that was ever shown in a screenshot or chat.
2. In Supabase, open **Edge Functions** in the left menu.
3. Click **Deploy a new function**, then choose **Via Editor**.
4. Name it exactly `gemini`.
5. Delete the sample code, then copy everything from `supabase/functions/gemini/index.ts` and paste it in.
6. Click **Deploy function**.
7. Open **Edge Functions → Secrets** (or **Project Settings → Edge Functions → Secrets**) and add:
   - Name `GEMINI_API_KEY`, value: your new Gemini key
   - Name `GROQ_API_KEY`, value: a free key from **console.groq.com → API Keys** (recommended; Groq also transcribes recordings with Whisper)
   - Name `MISTRAL_API_KEY`, value: a free key from **console.mistral.ai → API Keys** (choose the free **Experiment** plan; it asks to verify your phone number)
   - Name `OPENROUTER_API_KEY`, value: a free key from **openrouter.ai → Keys** (gives access to several free models)
8. Click **Save**.

You only need `GEMINI_API_KEY`, but every extra key is one more AI that can answer when the others are busy. Study Buddy tries them in order: Gemini, Groq, Mistral, then OpenRouter. If one is busy or out of free quota, the server moves to the next on its own. Answers from anything other than Gemini show a small "Backup AI" label. In **Account**, you can pick which AI to try first.

There is no daily limit in the app. Each AI service still has its own free limits, which is why having several keys helps.

## 5. Connect the app to Supabase

1. Open **Project Settings → API** (it may be called **API Keys** or **Data API**).
2. Copy the **Project URL**. It looks like `https://abcdxyz.supabase.co`.
3. Copy the **anon public** key (newer projects call it the **publishable** key). Don't copy the **service_role** or **secret** key, which must never go in the app.
4. Open `config.js` in Notepad and paste them in:

```js
window.STUDY_BUDDY_CONFIG = {
  supabaseUrl: "https://abcdxyz.supabase.co",
  supabaseAnonKey: "paste the anon public key here",
  googleSignIn: false
};
```

It's safe for these two values to be public. Row Level Security protects the data, and the Gemini key stays on the server.

## 6. Upload to GitHub

1. Open your `study-buddy` repository on GitHub.
2. Click **Add file → Upload files**.
3. Drag in everything inside this folder: `index.html`, `app.css`, `app.js`, `config.js`, `sw.js`, `manifest.json`, `README.md`, `SETUP.md`, and the `icons` and `supabase` folders.
4. Click **Commit changes** and wait a minute.

## 7. Try it

1. Open `https://YOUR-GITHUB-USERNAME.github.io/study-buddy/`. Reload it twice so your browser picks up the new version.
2. Enter your email and tap **Email me a sign-in link**.
3. Open the email **on the same device** and tap the link. You're in.
4. If you used the earlier version on this device, open **Notes** and tap **Move them** to bring your old notes into your account.
5. Add your subjects and timetable, then ask a question.

---

## Optional: Sign in with Google

1. In Google Cloud Console, create an **OAuth client ID** (type: Web application).
2. Add `https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback` as an authorised redirect URI.
3. In Supabase, open **Authentication → Sign In / Providers → Google**, turn it on, and paste the client ID and secret.
4. In `config.js`, set `googleSignIn: true` and upload it again.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Almost there" page | `config.js` still has the placeholder values. Check step 5. |
| Sign-in link says it's expired or invalid | Request a new link, and open it on the same device. Check the Site URL and Redirect URL in step 3. |
| No sign-in email arrives | Check spam. The built-in sender only sends a few emails per hour, so wait and try again. |
| "The gemini server function isn't set up yet" | The function name must be exactly `gemini`. Check step 4. |
| "The GEMINI_API_KEY secret isn't set" | Add the secret in step 4.7, then try again. |
| "The server's Gemini key isn't valid" | Create a new key in AI Studio and replace the secret. |
| "All the AI services are busy right now" | Every service you've added is overloaded or out of free quota. Wait a minute; notes retry on their own. Add more keys from step 4.7. |
| "Record an online meeting" is missing | It needs Chrome or Edge on a laptop. On a phone, upload the meeting's recording instead. |
| A meeting recording has only your voice | When sharing, pick the meeting's **tab** and switch on **Share tab audio**. |
| A long recording or video fails | Long files are split into 15-minute parts on your device first. If your browser runs out of memory, upload just the audio or a shorter part. |

## How it fits together

```
 Phone or laptop (GitHub Pages)            Supabase                         Google
 ┌───────────────────────────┐   sign in   ┌────────────────────┐
 │ Study Buddy app            │ ──────────▶ │ Auth (email link)  │
 │ HTML, CSS, JavaScript      │   data      │ Postgres + RLS     │
 │ Records audio as MP3       │ ──────────▶ │ subjects, notes…   │
 │ Keeps unsent files locally │   ask AI    │ Edge Function      │  Gemini key  ┌────────────┐
 └───────────────────────────┘ ──────────▶ │ "gemini"           │ ───────────▶ │ Gemini API │
                                            │ checks login +     │ ◀─ stream ── └────────────┘
                                            │ Groq, Mistral,     │
                                            │ OpenRouter backups │
                                            └────────────────────┘
```
