/**
 * sync-portal-assets.js
 * Automatically copies web assets and applies school logo icons during Appflow builds
 */

const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        // Skip user uploads and unused source files
        if (entry.name === 'uploads') continue;
        if (['svgs', 'sprites', 'metadata', 'scss', 'less'].includes(entry.name)) continue;

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// 1. Copy school logo icons from /res (root) to android/app/src/main/res
const rootResDir = path.resolve(__dirname, 'res');
const androidResDir = path.resolve(__dirname, 'android/app/src/main/res');

if (fs.existsSync(rootResDir) && fs.existsSync(androidResDir)) {
    console.log('🔄 Copying school logo icons from /res to android/app/src/main/res...');
    copyRecursive(rootResDir, androidResDir);
    console.log('✅ School logo icons successfully applied to Android build!');
}

// 2. In CI/Cloud build runners (like Appflow), www is already committed to the repo
const srcDir = path.resolve(__dirname, '../portal/public');
const destDir = path.resolve(__dirname, 'www');

if (!fs.existsSync(srcDir)) {
    if (fs.existsSync(destDir)) {
        console.log('✅ CI environment: Using pre-built www directory.');
        process.exit(0);
    } else {
        console.error('Error: Neither portal/public nor www directory found.');
        process.exit(1);
    }
}

// 3. Local development: Sync from portal/public to mobile-app/www
console.log('🔄 Syncing portal/public web assets to mobile-app/www...');
copyRecursive(srcDir, destDir);
console.log('✅ Web assets successfully copied to mobile-app/www!');
