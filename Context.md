# Jarod web (Tokenomics Arbitrage)

Static, in-browser port of the desktop Jarod app (`F:\Ctsgpyprojects\2026_to_market\tokenomics-v3`, PyInstaller build, source not available).

- `index.html` is built output. Do not hand-edit; run `py -I tools\build.py`.
- `src/dashboard.template.html` = original UI, unchanged.
- `src/engine.js` = replacement for the Flask backend (fetch('/api/*') is intercepted; data in IndexedDB; key in localStorage).
- `src/overrides.js` = print-to-PDF reports, restore-catalog button.
- `src/data.js` = seed catalog (80 models, 394 history rows) from `tools/gen_data.py` (reads pricing tables only).
- Roles, quality scores, onboarding and arbitrage logic were REBUILT from the UI contract (original backend logic was compiled); numbers will not match the desktop app exactly.
- Untested: Refresh Pricing (web search), Validate with AI, Test Key (need a real Anthropic key).
- Preview: `py -m http.server 8140 --directory <this folder>`.
- Not yet deployed: needs subdomain, GitHub repo, Pages workflow, CNAME, landing card (see custombiztools tool-launch process).
