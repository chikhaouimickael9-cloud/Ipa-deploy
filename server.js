const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");
const crypto = require("crypto");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "x-api-key, Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

const CONFIG = {
  SERVER_URL: process.env.SERVER_URL || "https://ton-serveur.com",
  UPLOAD_DIR: "./uploads/ipa",
  CERT_DIR: "./uploads/certs",
  SIGNED_DIR: "./uploads/signed",
  PLIST_DIR: "./uploads/plists",
  API_KEY: process.env.API_KEY || "change-moi-en-production",
  PORT: process.env.PORT || 3000,
};

[CONFIG.UPLOAD_DIR, CONFIG.CERT_DIR, CONFIG.SIGNED_DIR, CONFIG.PLIST_DIR].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

const DB_FILE = "./db.json";
const loadDB = () => {
  if (!fs.existsSync(DB_FILE)) return { apps: [], certs: [], profiles: [], deployments: [] };
  return JSON.parse(fs.readFileSync(DB_FILE));
};
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const auth = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== CONFIG.API_KEY) return res.status(401).json({ error: "Non autorisé" });
  next();
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.originalname.endsWith(".ipa")) cb(null, CONFIG.UPLOAD_DIR);
    else cb(null, CONFIG.CERT_DIR);
  },
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const resignIPA = (ipaPath, certPath, certPassword, profilePath, outputPath) => {
  return new Promise((resolve, reject) => {
    try { execSync("which zsign"); } catch { return reject(new Error("zsign non installé")); }
    const cmd = `zsign -k "${certPath}" -p "${certPassword}" -m "${profilePath}" -o "${outputPath}" -z 9 "${ipaPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Échec signature: ${stderr}`));
      resolve(outputPath);
    });
  });
};

const generatePlist = (appId, ipaUrl, bundleId, version, name) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier​​​​​​​​​​​​​​​​
