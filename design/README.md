# TrainMe – UI Mockups & Demo Video

TrainMe and its logo are a **dummy brand**, and all people and data shown are fictitious. Everything here is generated from code, so it can be edited and rebuilt.

| Deliverable | Path | How to use |
|---|---|---|
| **Demo video** (narrated, subtitled, 1080p) | `demo/TrainMe_Demo.mp4` | Play in any player. Subtitles are embedded, and also provided as `demo/TrainMe_Demo.srt` |
| Narration script with timestamps | `demo/narration_script.md` | For review or for re-recording with a professional voice |
| **Clickable mockups** | `mockups/index.html` | Open in Chrome and use the ← → arrow keys to move through all screens |
| Screen images (1920×1080 PNG) | `screens/NN_<scene>.png` | Use in decks, docs and reviews |
| Design system | `mockups/trainme.css` | Colours, type, components (phone, browser, cards, chips, toggles, charts) |
| Scene definitions | `mockups/shots.js` | Every screen's markup, caption, numbered callouts, requirement IDs and narration |
| Build tools | `tools/render_screens.sh`, `tools/build_video.py` | Re-render screens, then rebuild the video |

## Scenes

The numbered cyan markers on each mockup match the numbered bullets in the caption, so every function is easy to spot. The caption also lists the SRS requirement IDs the screen demonstrates.

| # | Chapter | Scene | What it shows | Requirements |
|---|---|---|---|---|
| 1 | Intro | Title | Brand, tagline, supported sports | – |
| 2 | Intro | One platform, three apps | Mobile, web and admin | TR-4, TR-5 |
| 3 | Member onboarding | **Registration** | Apple/Google one-tap, live password strength, consent | FR-IAM-01/02, NFR-USE-05 |
| 4 | Member onboarding | Personalise | Interests, cricket role, units | FR-PRF-01/02, FR-CAT-01 |
| 5 | Member onboarding | **Login (mobile)** | Face ID / passkey, email, forgot password, social | FR-IAM-03/04/05 |
| 6 | Member onboarding | **Login (web)** | Split-screen sign-in with progress preview | FR-IAM-02/08 |
| 7 | Track a session | Home | Streak, weekly goal ring, one-tap start, recent sessions | FR-ANL-03/04 |
| 8 | Track a session | Explore catalog | Typo-tolerant search, tree, filters | FR-CAT-01/12 |
| 9 | Track a session | Template → tracker | Fast Bowler template, attempted → accurate skills | FR-TRK-01, FR-CAT-02/09 |
| 10 | Track a session | Customise | Add a custom parameter plus an auto ratio metric | FR-TRK-02/03, FR-CAT-10 |
| 11 | Track a session | Live session | Timer, over.ball, live stats, sync status | FR-REC-09/14 |
| 12 | Track a session | **Log a ball** | Speed stepper, pitch line picker; "Accurate?" appears only after "Yorker attempted" | FR-REC-01..03, FR-CAT-09 |
| 13 | Track a session | Offline & sync | Saved on device; checkpoint every 3–5 min; synced once | FR-REC-04/10/11 |
| 14 | Track a session | End & submit | Count check, ratio metrics 12/18 etc., personal best | FR-REC-12, FR-ANL-02/08 |
| 15 | Insights | **Progress charts** | Day/Week/Month, ratio tooltip "66.7 % · 12 of 18" | FR-ANL-01/02/06/08 |
| 16 | Insights | **History & search** | Date filter, notes search, metric filter, 84 ms | FR-REC-16, NFR-PERF-09 |
| 17 | Insights | **Compare sessions** | Grouped bars, speed by over, deltas | FR-ANL-05/09 |
| 18 | Insights | Gym | Sets, failure → assisted reps, volume, estimated 1RM | FR-CAT-14/08 |
| 19 | Insights | Plans | Free / Pro / Elite, trial, secure checkout | FR-SUB-01..05 |
| 20 | Admin console | Admin MFA | Mandatory two-step verification | FR-IAM-04/06, NFR-SEC-08 |
| 21 | Admin console | Overview | KPIs, sessions by hour, SLO health | FR-ADM-04, NFR-OBS-04/05 |
| 22 | Admin console | **Catalog manager** | Tree, fields with conditions, metric builder, validate and publish v3 | FR-CAT-04/06/09/10 |
| 23 | Admin console | Users & support | Masked data, devices/sync, safe actions, audit | FR-ADM-02, NFR-PRIV-02/03 |
| 24 | Admin console | Releases | Feature flags with rollout %, canary, audit log | NFR-MNT-05, NFR-REL-06 |
| 25 | Wrap-up | Outro | Feature recap | – |

## Rebuild

```bash
cd design
./tools/render_screens.sh                      # all screens (or: ./tools/render_screens.sh "11 14" for scenes 12 and 15)
python3 tools/build_video.py                   # narration (macOS say), clips, cross-fades, subtitles
python3 tools/build_video.py --voice Daniel    # British English voice; also try "Rishi" (en-IN) or any `say -v '?'` voice
```

To edit a screen, change its markup in `mockups/shots.js`, preview it in `mockups/index.html`, then rebuild.

**Better voice quality:** install an Enhanced or Premium voice (System Settings → Accessibility → Spoken Content → System Voice → Manage Voices) and pass it with `--voice`. Alternatively, record `narration_script.md` with a professional text-to-speech service or a human voice and replace the narration audio.
