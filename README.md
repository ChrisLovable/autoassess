# AutoAssess

Mobile-first damage assessment for South African panel beaters.
**Stack:** Next.js 14 App Router · TypeScript · Tailwind · Supabase · Claude Sonnet 4 Vision.

This bundle is v0.1 — Home screen + disc capture + vehicle details.

---

## Quick start (PowerShell)

```powershell
# 1. Bootstrap the project
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\setup.ps1

# 2. Drop these source files over C:\Dev\AutoAssess (overwriting defaults)

# 3. Configure env
cd C:\Dev\AutoAssess
Copy-Item .env.local.example .env.local
notepad .env.local   # fill in keys

# 4. Run
npm run dev

# 5. Open
start http://localhost:3000
```

---

## File structure

```
C:\Dev\AutoAssess\
├── .cursor/
│   └── rules/
│       ├── project.mdc          ← Always-applied: brand, stack, conventions
│       ├── nextjs.mdc           ← App Router patterns (auto-applied to app/**)
│       ├── supabase.mdc         ← Supabase patterns (auto-applied to lib/supabase/**)
│       └── ai.mdc               ← Claude integration patterns
├── .vscode/
│   ├── settings.json            ← Format on save, Prettier, Tailwind autocomplete
│   └── extensions.json          ← Recommended extensions
├── app/
│   ├── layout.tsx               ← Fonts + dark theme + metadata
│   ├── page.tsx                 ← Home: New / Active / Completed
│   ├── globals.css              ← Tailwind directives + animations
│   └── assessments/
│       └── new/
│           ├── page.tsx         ← Mounts <DiscScanner />
│           └── vehicle/
│               └── page.tsx     ← Vehicle details after scan
├── components/
│   ├── DiscScanner.tsx          ← Camera viewfinder client component
│   └── ui/
│       └── Icons.tsx            ← Inline SVG icons
├── lib/
│   └── disc.ts                  ← SA disc PDF417 parser + mock data
├── .env.local.example           ← Copy to .env.local
├── .gitignore
├── tailwind.config.ts           ← Brand tokens (bg-gold, bg-surface, font-display)
├── setup.ps1                    ← Bootstrap script
└── README.md
```

---

## Cursor integration

The `.cursor/rules/` folder contains rule files that Cursor's AI reads automatically:

| Rule file | When it applies | Purpose |
|---|---|---|
| `project.mdc` | **Always** | Brand, stack, file conventions, ZA terminology |
| `nextjs.mdc` | When editing `app/**/*.{ts,tsx}` | App Router patterns, Server/Client split, Suspense |
| `supabase.mdc` | When editing `lib/supabase/**` or `app/api/**` | Client setup, RLS, type generation |
| `ai.mdc` | When editing AI-related files | Claude model selection, tool use, error handling |

These are read every time you use Cmd+K / Cmd+L / Composer in Cursor. The AI will write code that matches the existing patterns without you having to remind it each time.

**Tip:** if Cursor suggests something off-pattern (e.g. uses `lucide-react` icons when we use inline SVGs), tell it "follow the project.mdc rules" and it'll correct itself.

---

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

| Variable | Required? | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (Phase 2) | https://app.supabase.com → Project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (Phase 2) | Same place |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (Phase 2) | Same place — **server-only** |
| `ANTHROPIC_API_KEY` | Yes (Phase 2) | https://console.anthropic.com/settings/keys |
| `APP_ID_SALT` | Yes | Generate a long random string (POPIA ID hashing) |

For v0.1, the app runs without any env vars — they're only needed when we wire up Supabase + Claude in the next slice.

---

## What's real vs mocked (v0.1)

| Feature | Status |
|---|---|
| Home screen with 3 buttons | Real |
| Real camera (`getUserMedia`, rear camera) | Real |
| Circle viewfinder + photo capture | Real |
| Captured image preview on next screen (via sessionStorage) | Real |
| Manual entry path (`?manual=1`) | Real |
| Error handling (camera denied / no camera / HTTPS required) | Real |
| Vehicle details rendering | Real |
| **PDF417 barcode decoding** | **Mocked** — returns hardcoded Toyota Hilux |
| SA disc text parser (`lib/disc.ts`) | Real but not yet invoked |
| Active / Completed lists | Stub routes only |
| Supabase persistence | Not wired |
| AI analysis | Not wired |

---

## Testing on a real phone

`getUserMedia` requires HTTPS or `localhost`. To test on a phone, use a tunnel:

```powershell
# In one terminal:
npm run dev

# In another:
npm install -g localtunnel
lt --port 3000 --subdomain autoassess-dev
```

Open the HTTPS URL on your phone. Works on both iOS Safari and Android Chrome.

---

## Design tokens (Tailwind)

| Class | Value | Use |
|---|---|---|
| `bg-bg` | `#0A0A0A` | Page background |
| `bg-surface` | `#141414` | Cards |
| `bg-surface-2` | `#1C1C1C` | Card headers, nested |
| `bg-surface-3` | `#262626` | Deeper nesting |
| `border-border` | `#2A2A2A` | Standard borders |
| `bg-gold` / `text-gold` | `#D4AF37` | Primary brand colour |
| `font-display` | Bricolage Grotesque | Headings |
| `font-sans` | Geist | Body |
| `font-mono` | Geist Mono | VINs, regs, codes, timestamps |
| `haptic-tap` | scale(0.97) on :active | All tappable elements |
| `safe-top` / `safe-bottom` | env(safe-area-inset-...) | iOS notch / home bar |

---

## Next slice (when you're ready)

1. **Wire real PDF417 decode** with ZXing — ~30 lines, replaces `MOCK_PARSED_DISC` in `vehicle/page.tsx`
2. **Add Supabase** — `lib/supabase/{client,server}.ts`, run `schema.sql`, persist incidents
3. **Add incident screen** — date / location / voice description (Dikta-Tor STT slots in here)
4. **Add photo capture screen** — guided multi-photo sequence
5. **Wire Claude vision** — `/api/incidents/[id]/analyze` route handler

Ask for any of these by number.
