const fs = require('fs');
const path = require('path');

const dir = 'c:\\\\ED TECH\\\\photobooth';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.match(/^\d{2}_/));

const metaTags = `
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="manifest.json">
`;

files.forEach(file => {
    let content = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!content.includes('apple-mobile-web-app-capable')) {
        content = content.replace('</head>', `${metaTags}</head>`);
        fs.writeFileSync(path.join(dir, file), content, 'utf8');
        console.log('Updated ' + file);
    }
});
