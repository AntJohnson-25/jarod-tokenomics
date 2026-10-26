"""Assemble index.html = desktop dashboard template + in-browser engine.
Run:  py -I tools/build.py   (from the repo root)"""
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def rd(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


html = rd("src", "dashboard.template.html")


def swap(old, new, count=1):
    global html
    assert html.count(old) == count, (old[:60], html.count(old))
    html = html.replace(old, new)


# meta description for search/sharing
swap('<title>Jarod — Tokenomics Arbitrage</title>',
     '<title>Jarod — Tokenomics Arbitrage</title>\n'
     '<meta name="description" content="Compare AI model prices, find cheaper models for each task, size token budgets by role, and plan AI onboarding. Runs entirely in your browser.">')

# engine goes in before the dashboard script so fetch('/api/...') is already served locally
marker = "<script>\n// ── STATE ──"
swap(marker, "<script>\n" + rd("src", "data.js") + "</script>\n<script>\n" + rd("src", "engine.js") + "</script>\n" + marker)

# overrides run after the dashboard script has defined its globals
swap("</script>\n</body>", "</script>\n<script>\n" + rd("src", "overrides.js") + "</script>\n</body>")

# key storage wording
swap("sends your onboarding plan to Anthropic's API for an AI review.",
     "sends your onboarding plan to Anthropic's or OpenAI's API (auto-detected from your key) for an AI review.")
swap('This uses <strong style="color:var(--text-secondary);">your own Anthropic account</strong> and bills to you. All other features work without a key.',
     'This uses <strong style="color:var(--text-secondary);">your own account</strong> and bills to you. '
     'Your key is stored only in this browser and is sent only to api.anthropic.com (sk-ant- keys) or api.openai.com (other sk- keys). '
     'It also powers the live Refresh Pricing search. All other features work without a key.')

# restore button next to Clear All Pricing Data
swap('<button class="btn btn-danger" onclick="clearPricingData()" id="clearPricingBtn">Clear All Pricing Data</button>',
     '<button class="btn btn-danger" onclick="clearPricingData()" id="clearPricingBtn">Clear All Pricing Data</button>\n'
     '          <button class="btn btn-secondary" onclick="restorePricing()" style="margin-left:8px;">Choose Providers</button>')

swap('Clear the pricing catalog to start fresh — useful when you want to hand-pick which providers to track. After clearing, use <strong style="color:var(--text-primary)">Refresh Pricing</strong> in the sidebar to pull the live catalog, then approve only the providers you want from the Proposals panel.',
     'Jarod starts empty: use Choose Providers to pick which providers to track, or clear everything to start over. With an Anthropic or OpenAI API key saved, <strong style="color:var(--text-primary)">Refresh Pricing</strong> in the sidebar searches for live prices and lists changes in the Proposals panel for you to approve.')

with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print("index.html", len(html), "bytes")
