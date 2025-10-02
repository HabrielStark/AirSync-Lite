# Icons Directory

This directory should contain the application icons in various formats:

## Required Icons:

### Application Icons:
- `icon.png` - Main application icon (512x512)
- `icon.ico` - Windows icon file
- `icon.icns` - macOS icon file

### Tray Icons:
- `tray-normal.png` - Default tray icon (16x16, 32x32)
- `tray-syncing.png` - Syncing state icon
- `tray-paused.png` - Paused state icon
- `tray-error.png` - Error state icon
- `tray-offline.png` - Offline state icon

### Dark Mode Variants (macOS):
- `tray-normal-dark.png`
- `tray-syncing-dark.png`
- `tray-paused-dark.png`
- `tray-error-dark.png`
- `tray-offline-dark.png`

### Device Icons:
- `device-online.png` - Online device indicator
- `device-offline.png` - Offline device indicator

## Icon Generation:

You can generate these icons from a high-resolution source image using tools like:
- ImageMagick
- electron-icon-builder
- Online icon generators

Example command to generate app icon:
```bash
# Generate .ico file for Windows
magick convert icon.png -resize 256x256 icon.ico

# Generate .icns file for macOS
iconutil -c icns icon.iconset
```
