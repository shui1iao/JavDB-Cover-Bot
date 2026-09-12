# JavDB Cover Bot

[中文](README.md) | **English**

**A lightweight Telegram bot that returns cover images and Simplified Chinese metadata after receiving a JAV code.**

> Docker Compose deployment is supported. Cover photos can be sent with Telegram spoiler masking.

---

## 🎯 Features

- Query by sending a code, for example `SSIS-001`
- Supports FC2 shorthand: `FC2-PPV-2767346`, `FC2-2767346`, and `2767346` normalize to `FC2-PPV-2767346`
- Supports `/av`, `/jav`, `/javdb`, and `/jd`
- Returns cover image, Simplified Chinese title, release date, actresses and tags
- Prefers Chinese title candidates among already-fetched exact-code metadata, then checks the persistent translation cache, Google, and a Microsoft Bing web-translation fallback requiring no personal API key. Covers and source crawling are unchanged. The Han-without-kana heuristic cannot reliably distinguish Chinese from Japanese titles written entirely in kanji.
- Google HTTP 429 pauses title requests to that provider for five minutes. Identical concurrent titles share one request. Successful translations are atomically cached in `translations/` beside `TMP_DIR`, bounded to 2000 entries / 8 MiB. Failures, refusals and untranslated Japanese are not cached; if both providers fail, the original title remains.
- Prefers work details and structured genres from official studio pages (currently S1, MOODYZ, and Aircontrol), then falls back to aggregator metadata
- Uses JavDB only as a metadata fallback; JavDB/JDBStatic watermarked covers are never sent, and the bot sends text only when no other cover is available
- Keeps the original landscape cover first. Each image request is bounded to 8 seconds; failures trigger exact-code alternatives from 3xplanet, MissAV and supported studios (Prestige official art is also fallback-only).
- Measures actual image dimensions: alternate landscape covers are preferred; portrait/square candidates and portrait caches are held until landscape sources are exhausted.
- Caches successful covers by product code in `covers/` beside `TMP_DIR`, capped at 64 MiB. Cached art is used only after the original source fails.
- Uses bold Telegram HTML labels in captions
- Optional user allowlist
- Docker Compose deployment

## Title translation fallback

When Google fails, Microsoft Bing web translation is used automatically without a personal API key or GPT/Parrot calls. A temporary token is obtained from the fixed Bing translator page before submitting the title to the same site. Each request has a 12-second timeout and rejects redirects. No user model keys or Telegram credentials are read or sent; title text is still sent to the translation service. This web interface is not the official Azure subscription API and may be rate-limited or change. Failure preserves the original title.

`TITLE_TRANSLATION_CACHE_DIR` overrides the cache directory. Verified Japanese proper names may remain unchanged, but the title body must be Chinese; names and their Simplified variants are part of the cache key. Actress-name and genre translation flows are unchanged.

## 🚀 Quick Start

Create a directory and download the Compose file:

```bash
mkdir -p ~/javdb-cover-bot && cd ~/javdb-cover-bot
curl -Lo docker-compose.yml https://github.com/shui1iao/JavDB-Cover-Bot/releases/latest/download/docker-compose.yml
```

Create the config file:

```bash
cat > .env <<'EOF_ENV'
BOT_TOKEN=your Telegram Bot Token
ALLOWED_USER_IDS=
SPOILER=true
EOF_ENV
```

Start the bot:

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

> Leave `ALLOWED_USER_IDS` empty for public access, or set comma-separated Telegram numeric IDs to restrict usage.

## 💬 Usage

Send a code directly:

```text
SSIS-001
```

Or use commands:

```text
/av SSIS-001
/jav SSIS-001
```

## ⚙️ Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `BOT_TOKEN` | Telegram Bot Token | Required |
| `ALLOWED_USER_IDS` | Comma-separated Telegram numeric IDs; empty means public | Empty |
| `SPOILER` | Send cover photos with spoiler masking | `true` |
| `TMP_DIR` | Temporary file directory; Compose sets it to `/app/data/tmp` | `./data/tmp` |

## 🛠 Operations

Check status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

Update:

```bash
docker compose pull
docker compose up -d
```

## 🔐 Privacy

The bot queries public pages on demand and does not require a database. Keep `BOT_TOKEN` private and consider setting `ALLOWED_USER_IDS` for public deployments.

## 📄 License

MIT
