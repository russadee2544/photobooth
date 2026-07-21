const fs = require('fs');
const path = require('path');

const filesList = [
  "01_Design_System.json",
  "02_Home_Tap_to_Start.html",
  "03_Select_Layout.html",
  "04_Capture_Moments.html",
  "05_Choose_Template.html",
  "06_Gallery_Your_Moments.html",
  "07_Payment_Scan_QR.html",
  "08_Print_and_Download.html",
  "09_Capture_Moments.html",
  "10_Select_Layout.html",
  "11_Print_and_Download.html",
  "12_Processing_Your_Snap.html",
  "13_Processing_Your_Snap.html"
];

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

for (const file of files) {
    let content = fs.readFileSync(path.join(dir, file), 'utf-8');
    
    // Replace all occurrences of {{DATA:SCREEN:SCREEN_X}}
    let hasChanges = false;
    content = content.replace(/\{\{DATA:SCREEN:SCREEN_(\d+)\}\}/g, (match, p1) => {
        const index = parseInt(p1, 10);
        if (filesList[index]) {
            console.log(`Replaced ${match} with ${filesList[index]} in ${file}`);
            hasChanges = true;
            return filesList[index];
        }
        return match;
    });

    if (hasChanges) {
        fs.writeFileSync(path.join(dir, file), content, 'utf-8');
    }
}
