const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");
const https = require("https");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const CONFIG = {
  SERVER_URL: process.env.SERVER_URL || "https://ton-serveur.com",
  UPLOAD_DIR: "./uploads/ipa",
  CERT_DIR: "./uploads/certs",
  SIGNED_DIR: "./uploads/signed",
  PLIST_DIR: "./uploads/plists",
  SSL_CERT: process.env.SSL_CERT || "./ssl/cert.pem",
  SSL_KEY: process.env.SSL_KEY || "./ssl/key.pem",
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
        <key>bundle-identifier</key><string>${bundleId}</string>
        <key>bundle-version</key><string>${version}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${name}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/apps/upload", auth, upload.single("ipa"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun .ipa reçu" });
  const db = loadDB();
  const entry = {
    id: crypto.randomUUID(),
    name: req.body.name || req.file.originalname.replace(".ipa", ""),
    version: req.body.version || "1.0.0",
    bundleId: req.body.bundleId || "com.example.app",
    filename: req.file.filename,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    certId: null, profileId: null, signed: false,
  };
  db.apps.push(entry);
  saveDB(db);
  res.json({ success: true, app: entry });
});

app.post("/api/certs/upload", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
  const isP12 = req.file.originalname.endsWith(".p12");
  const db = loadDB();
  const entry = {
    id: crypto.randomUUID(),
    name: req.body.name || req.file.originalname,
    type: isP12 ? "p12" : "mobileprovision",
    filename: req.file.filename,
    password: req.body.password || "",
    expiry: req.body.expiry || null,
    uploadedAt: new Date().toISOString(),
  };
  if (isP12) db.certs.push(entry);
  else db.profiles.push(entry);
  saveDB(db);
  res.json({ success: true, entry });
});

app.post("/api/apps/:id/assign", auth, (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "App non trouvée" });
  app.certId = req.body.certId;
  app.profileId = req.body.profileId;
  app.signed = false;
  saveDB(db);
  res.json({ success: true, app });
});

app.post("/api/apps/:id/sign", auth, async (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "App non trouvée" });
  const cert = db.certs.find(c => c.id === app.certId);
  const profile = db.profiles.find(p => p.id === app.profileId);
  if (!cert) return res.status(400).json({ error: "Aucun certificat associé" });
  if (!profile) return res.status(400).json({ error: "Aucun profil associé" });

  const ipaPath = path.join(CONFIG.UPLOAD_DIR, app.filename);
  const certPath = path.join(CONFIG.CERT_DIR, cert.filename);
  const profilePath = path.join(CONFIG.CERT_DIR, profile.filename);
  const signedFilename = `signed_${app.id}.ipa`;
  const signedPath = path.join(CONFIG.SIGNED_DIR, signedFilename);

  try {
    await resignIPA(ipaPath, certPath, cert.password, profilePath, signedPath);
    const plistFilename = `${app.id}.plist`;
    const plistPath = path.join(CONFIG.PLIST_DIR, plistFilename);
    const ipaUrl = `${CONFIG.SERVER_URL}/download/${signedFilename}`;
    fs.writeFileSync(plistPath, generatePlist(app.id, ipaUrl, app.bundleId, app.version, app.name));
    app.signed = true;
    app.signedFilename = signedFilename;
    app.plistFilename = plistFilename;
    saveDB(db);
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(`${CONFIG.SERVER_URL}/plist/${plistFilename}`)}`;
    res.json({ success: true, app, installUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/apps", auth, (req, res) => res.json(loadDB().apps));
app.get("/api/certs", auth, (req, res) => { const db = loadDB(); res.json({ certs: db.certs, profiles: db.profiles }); });

app.get("/download/:filename", (req, res) => {
  const filePath = path.join(CONFIG.SIGNED_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Fichier non trouvé");
  res.download(filePath);
});

app.get("/plist/:filename", (req, res) => {
  const filePath = path.join(CONFIG.PLIST_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Plist non trouvé");
  res.setHeader("Content-Type", "application/xml");
  res.sendFile(path.resolve(filePath));
});

app.get("/install/:appId", (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.appId);
  if (!app || !app.signed) return res.status(404).send("App non disponible");
  const plistUrl = `${CONFIG.SERVER_URL}/plist/${app.plistFilename}`;
  const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Installer ${app.name}</title><style>body{font-family:-apple-system,sans-serif;max-width:400px;margin:60px auto;text-align:center;padding:20px}.card{background:#fff;border-radius:20px;padding:30px;box-shadow:0 4px 20px rgba(0,0,0,.1)}a.btn{display:inline-block;margin-top:20px;padding:16px 32px;background:#111;color:#fff;border-radius:14px;text-decoration:none;font-weight:700}</style></head><body><div class="card"><h1>${app.name}</h1><p>v${app.version}</p><img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(installUrl)}&size=200x200" style="border-radius:12px;margin:20px 0"><p>Scanne depuis Safari ou appuie ci-dessous</p><a href="${installUrl}" class="btn">📲 Installer</a></div></body></html>`);
});

app.listen(CONFIG.PORT, () => console.log(`Serveur démarré sur le port ${CONFIG.PORT}`));
