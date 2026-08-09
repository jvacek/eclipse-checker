import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');

const SITE_URL = process.env.QR_URL ?? 'https://eclipse-checker.vercel.app';
const OUT = 'public/eclipse-checker-qr.svg';

const qr = qrcode(0, 'M');
qr.addData(SITE_URL);
qr.make();
const svg = qr.createSvgTag(6, 2);

mkdirSync(new URL('../public', import.meta.url), { recursive: true });
writeFileSync(new URL('../' + OUT, import.meta.url), svg);
console.log(`Wrote ${OUT} for ${SITE_URL}`);
