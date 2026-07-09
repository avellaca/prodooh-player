# Factory Content — Prodooh Branding

Pre-loaded content included with every player deployment. Shown as last-resort fallback when:

- Device boots for the first time (before initial playlist sync)
- Playlist is empty AND there is no connectivity

## Assets

| File | Orientation | Dimensions |
|------|-------------|------------|
| `prodooh-branding-landscape.svg` | Landscape (16:9) | 1920×1080 |
| `prodooh-branding-portrait.svg` | Portrait (9:16) | 1080×1920 |

## Behavior

- The player selects the appropriate asset based on the screen's configured orientation.
- Once the first real playlist is adopted, factory content stops showing in normal rotation.
- Factory content is never deleted from the device — it remains as an emergency fallback.
- Super-admins can update factory content for new device provisioning (Req 25.5).

## Updating

To update the factory branding:
1. Replace the SVG files in this directory
2. Rebuild and redeploy the player bundle
3. The `FactoryContent` module generates the branding programmatically for runtime use;
   these SVGs serve as reference assets and can be used for static rendering if needed.
