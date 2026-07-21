const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const mapping = {};

for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const matches = content.match(/\{\{DATA:SCREEN:[^}]+\}\}/g);
    if (matches) {
        console.log(`File: ${file} contains links:`, [...new Set(matches)]);
    }
}
