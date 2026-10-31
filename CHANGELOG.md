# Changelog

## v0.3.14

- Update the pinned official Node 24 Bookworm-slim runtime to 24.22.2 with bundled undici 7.30.1, and the existing transitive npm undici lock to 7.30.1. Preserve business source and all other dependency versions.
- Add loopback/subprocess regressions for excessive content-encodings and TLS 1.2 certificate-changing renegotiation, Bing transport success/error/timeout, and rejection of untrusted or wrong-host certificates. Original Node/dependency notices remain intact; no security-completeness claim.
- Correct the ambiguous bare YUJ prefix: YUJ-038 follows the existing strict Japanese-work lookup instead of an empty Korean-MIB route. Other MIB prefixes and filename recognition are unchanged.
- Bundle clean shared core 2026.10.31.1 and synthetic identity/route regressions. Existing cover, category, actor, translation and cache policies remain unchanged. No database migration or catalogue refresh is required.

## v0.3.13

- Bundle the MIT shared metadata core and its rebuildable source.
- Use original category labels, exact synonym normalization, per-result deduplication and promotional-category removal; preserve unknown glyphs and valid Telegram hashtag boundaries.
- Preserve original cast names with trusted Chinese display names and title-translation fallback/cache behavior.
- Recognize the explicit GANA / 200GANA same-work pair and stop genre parsing before Description text.
- Preserve strict full-product-code cover fallback, cover validation and recovery/cache behavior.
- Refresh standard Docker Compose deployment instructions and synthetic offline regressions.

Existing configuration and data directories can be retained when upgrading. No database migration or history editing is required. Source availability and rate limits still affect lookup results.
