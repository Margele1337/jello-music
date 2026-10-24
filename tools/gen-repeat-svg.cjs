// Generate vector SVG replicas of repeat.png's three frames (pixel-run rects).
// Vector edges stay clean at any DPI (vs bitmap upscale = blurry/jagged).
// ASCII only. Run: electron.exe tools/gen-repeat-svg.cjs
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
    const src = path.join(__dirname, '..', 'src', 'assets', 'sigma', 'music', 'repeat.png');
    const img = nativeImage.createFromPath(src);
    const { width, height } = img.getSize();
    const data = img.toBitmap(); // BGRA
    const fw = Math.floor(width / 3);

    for (let f = 0; f < 3; f++) {
        const rects = [];
        for (let y = 0; y < height; y++) {
            let x = 0;
            while (x < fw) {
                const i = (y * width + (f * fw + x)) * 4;
                const a = data[i + 3];
                if (a <= 40) { x++; continue; }
                // horizontal run of consecutive pixels with same quantized alpha
                const q = Math.round((a / 255) * 20) / 20;
                let run = 1;
                while (x + run < fw) {
                    const j = (y * width + (f * fw + x + run)) * 4;
                    if (Math.round((data[j + 3] / 255) * 20) / 20 !== q) break;
                    run++;
                }
                rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="#fff"${q < 0.98 ? ` fill-opacity="${q}"` : ''}/>`);
                x += run;
            }
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fw} ${height}">${rects.join('')}</svg>`;
        const out = path.join(__dirname, '..', 'src', 'assets', 'sigma', 'music', `repeat-${f}.svg`);
        fs.writeFileSync(out, svg);
        console.log(`frame ${f}: ${rects.length} rects -> ${out} (${svg.length} bytes)`);
    }
    app.quit();
});
app.on('window-all-closed', () => {});
