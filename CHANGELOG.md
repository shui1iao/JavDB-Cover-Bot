# Changelog

## v0.3.13

- Bundle the MIT shared metadata core and its rebuildable source.
- Use original category labels, exact synonym normalization, per-result deduplication and promotional-category removal; preserve unknown glyphs and valid Telegram hashtag boundaries.
- Preserve original cast names with trusted Chinese display names and title-translation fallback/cache behavior.
- Recognize the explicit GANA / 200GANA same-work pair and stop genre parsing before Description text.
- Preserve strict full-product-code cover fallback, cover validation and recovery/cache behavior.
- Refresh standard Docker Compose deployment instructions and synthetic offline regressions.

Existing configuration and data directories can be retained when upgrading. No database migration or history editing is required. Source availability and rate limits still affect lookup results.
