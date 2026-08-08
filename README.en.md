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
- Prefers structured genres from official studio pages (currently S1 and MOODYZ), then falls back to aggregator metadata
- Uses JavDB only as a metadata fallback; JavDB/JDBStatic watermarked covers are never sent, and the bot sends text only when no other cover is available
- Uses bold Telegram HTML labels in captions
- Optional user allowlist
- Docker Compose deployment

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
