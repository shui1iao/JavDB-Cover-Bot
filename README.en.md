# JavDB Cover Bot

[中文](README.md) | **English**

A Telegram product-code lookup bot returning available cover art, a Chinese title, release date, cast and category hashtags. Supports Docker Compose, an optional user allowlist and spoiler-masked covers.

## v0.3.13

- Bundles the MIT-licensed `se-catalog-core 2026.10.25.1` for consistent identity checks, metadata and cover selection. No extra service or database.
- Original category labels: 83 exact synonym groups, 306 canonical categories and 21 exact promotional/price drops. Duplicates are removed per result. Unknown labels retain their glyphs; categories are neither machine-translated nor simplified. Punctuation is encoded into valid clickable hashtags.
- Cast retains original names, adding Chinese names only from the trusted display-name table. No inferred names or actor identity aliases.
- Explicit same-work recognition for `GANA-3342` / `200GANA-3342`; the 3xplanet genre parser stops at `Description` instead of turning synopsis text into tags.
- Preserves v0.3.12's strict numeric-prefix cover fallback: only a unique full-code filename from the exact detail can nominate another cover page, whose full code and title must match. Arbitrary prefix stripping remains prohibited.

## Queries and covers

Send `SSIS-001` directly or use `/av`, `/jav`, `/javdb`, `/jd`. FC2 shorthand normalizes to `FC2-PPV-`; FC2 categories remain omitted. Other categories retain the existing priority order and 20-item presentation limit.

Applicable official metadata comes first, followed by source-specific fallbacks. The shared core selects covers using source, measured dimensions and image evidence, rejecting mismatched codes, undersized images and JavDB/JDBStatic watermarks. No safe cover means a text reply. Successful art is atomically cached in `covers/` beside `TMP_DIR`, bounded to 64 MiB; cache can be used when a new cover is unavailable. Source outages and rate limits can still leave fields or covers missing.

Titles still use Google translation with a Microsoft Bing web fallback, requiring no personal translation key. Google 429 pauses that provider for five minutes. Concurrent identical titles share work; successful translations are cached in `translations/` beside `TMP_DIR`, bounded to 2000 entries / 8 MiB. Both providers failing preserves the original title. Title and verified-name handling are separate from category rules. The web interfaces may change; title text is sent to translation providers, never Telegram credentials.

## Docker Compose quick start

```sh
mkdir -p ~/javdb-cover-bot && cd ~/javdb-cover-bot
curl -fLo docker-compose.yml https://github.com/shui1iao/JavDB-Cover-Bot/releases/latest/download/docker-compose.yml
cp /dev/null .env
```

Edit `.env` without publishing it:

```dotenv
BOT_TOKEN=
ALLOWED_USER_IDS=
SPOILER=true
```

Fill in your own token from BotFather, then:

```sh
docker compose pull
docker compose up -d
docker compose logs -f
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `BOT_TOKEN` | Required: your Telegram Bot Token | Empty |
| `ALLOWED_USER_IDS` | Comma-separated numeric IDs; empty allows everyone | Empty |
| `SPOILER` | Mask cover photos | `true` |
| `TMP_DIR` | Temporary directory; Compose sets `/app/data/tmp` | `./data/tmp` |
| `TITLE_TRANSLATION_CACHE_DIR` | Optional title-cache directory | `translations/` beside `TMP_DIR` |

Upgrade with `docker compose pull && docker compose up -d`, retaining `.env` and `data/`. Do not run multiple instances using the same token.

## Source build and offline tests

Requires Docker. The Dockerfile pins Node/Python base images and dependencies, installing the bundled public MIT wheel:

```sh
docker build -t javdb-cover-bot:local .
docker run --rm --network none --entrypoint node -v "$PWD/test:/app/test:ro" javdb-cover-bot:local --test
```

Tests use synthetic metadata and temporarily generated images, without starting the Bot or sending Telegram messages. Title-provider requests are mocked.

Core source and licensing are in `core/`. With Python 3.14, `setuptools==82.0.1` and pip installed, run `SOURCE_DATE_EPOCH=0 python tools/build-core.py` to refresh public build fingerprints and rebuild the wheel in `vendor/`. Runtime Python dependencies are pinned in `vendor/requirements.lock`. Locally maintained builds may have different metadata; use this release's SHA256SUMS to verify downloaded assets.

## Privacy and licensing

The bot queries public metadata on demand and caches necessary covers and successful translations. Protect your token, allowlist, cache and logs; consider an allowlist for public deployments. The source package contains no deployment configuration, user data, channel history or credentials.

MIT, JavDB Cover Bot authors. The bundled core is MIT; OpenCC and other third-party components retain their own licenses and authorship notices.
