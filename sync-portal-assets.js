/**
 * sync-portal-assets.js
 * Automatically copies web assets from portal/public into mobile-app/www
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../portal/public');
const destDir = path.resolve(__dirname, 'www');

function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('🔄 Syncing portal/public web assets to mobile-app/www...');
copyRecursive(srcDir, destDir);
console.log('✅ Web assets successfully copied to mobile-app/www!');
