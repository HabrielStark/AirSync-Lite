// Icon generation script using SVG to multiple formats
// Run: node assets/icons/generate-icons.js

const fs = require('fs');
const path = require('path');

// Base SVG icon (512x512)
const iconSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1565C0;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background circle -->
  <circle cx="256" cy="256" r="240" fill="url(#grad1)"/>
  
  <!-- Sync arrows -->
  <g transform="translate(256,256)">
    <!-- Top arrow (cloud up) -->
    <path d="M -80,-40 L -80,40 L -100,40 L -60,80 L -20,40 L -40,40 L -40,-40 Z" 
          fill="white" opacity="0.9"/>
    
    <!-- Bottom arrow (cloud down) -->
    <path d="M 80,40 L 80,-40 L 100,-40 L 60,-80 L 20,-40 L 40,-40 L 40,40 Z" 
          fill="white" opacity="0.9"/>
    
    <!-- Connecting line -->
    <line x1="-60" y1="0" x2="60" y2="0" stroke="white" stroke-width="12" opacity="0.6"/>
  </g>
  
  <!-- Brand text -->
  <text x="256" y="420" font-family="Arial, sans-serif" font-size="48" 
        font-weight="bold" fill="white" text-anchor="middle">AIRSYNC</text>
</svg>`;

// Tray icon SVG (simpler, 16x16 base)
const trayNormalSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#2196F3"/>
  <path d="M 5,6 L 5,10 L 11,8 Z" fill="white"/>
</svg>`;

const traySyncingSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#4CAF50"/>
  <path d="M 6,5 L 6,11 L 4,11 L 8,14 L 12,11 L 10,11 L 10,5 Z" fill="white"/>
</svg>`;

const trayPausedSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#FF9800"/>
  <rect x="5" y="5" width="2" height="6" fill="white"/>
  <rect x="9" y="5" width="2" height="6" fill="white"/>
</svg>`;

const trayErrorSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#F44336"/>
  <text x="8" y="12" font-family="Arial" font-size="10" font-weight="bold" 
        fill="white" text-anchor="middle">!</text>
</svg>`;

const trayOfflineSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="7" fill="#9E9E9E"/>
  <line x1="5" y1="5" x2="11" y2="11" stroke="white" stroke-width="2"/>
  <line x1="11" y1="5" x2="5" y2="11" stroke="white" stroke-width="2"/>
</svg>`;

// Write SVG files
const iconsDir = __dirname;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), iconSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-normal.svg'), trayNormalSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-syncing.svg'), traySyncingSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-paused.svg'), trayPausedSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-error.svg'), trayErrorSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-offline.svg'), trayOfflineSVG);

// Dark mode variants (inverted colors for macOS)
const trayNormalDarkSVG = trayNormalSVG.replace('fill="#2196F3"', 'fill="#BBDEFB"');
const traySyncingDarkSVG = traySyncingSVG.replace('fill="#4CAF50"', 'fill="#C8E6C9"');
const trayPausedDarkSVG = trayPausedSVG.replace('fill="#FF9800"', 'fill="#FFE0B2"');
const trayErrorDarkSVG = trayErrorSVG.replace('fill="#F44336"', 'fill="#FFCDD2"');
const trayOfflineDarkSVG = trayOfflineSVG.replace('fill="#9E9E9E"', 'fill="#E0E0E0"');

fs.writeFileSync(path.join(iconsDir, 'tray-normal-dark.svg'), trayNormalDarkSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-syncing-dark.svg'), traySyncingDarkSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-paused-dark.svg'), trayPausedDarkSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-error-dark.svg'), trayErrorDarkSVG);
fs.writeFileSync(path.join(iconsDir, 'tray-offline-dark.svg'), trayOfflineDarkSVG);

console.log('✅ Generated SVG icons in', iconsDir);
console.log('');
console.log('📝 Next steps to create full icon set:');
console.log('1. Install ImageMagick or use online converter');
console.log('2. Convert SVG to PNG 512x512:');
console.log('   magick convert icon.svg -resize 512x512 icon.png');
console.log('3. Convert PNG to ICO (Windows):');
console.log('   magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico');
console.log('4. Convert PNG to ICNS (macOS) - requires iconutil:');
console.log('   mkdir icon.iconset');
console.log('   sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png');
console.log('   sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png');
console.log('   sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png');
console.log('   sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png');
console.log('   sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png');
console.log('   sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png');
console.log('   sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png');
console.log('   sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png');
console.log('   sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png');
console.log('   cp icon.png icon.iconset/icon_512x512@2x.png');
console.log('   iconutil -c icns icon.iconset');
console.log('');
