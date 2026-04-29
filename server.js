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
  SERVER_URL: process.env.SERVER_URL || "https://ipa-deploy-production.up.railway.app",
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
  if (!fs.existsSync(DB_FILE)) return { apps: [], certs: [], profiles: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
};

const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const auth = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== CONFIG.API_KEY) return res.status(401).json({ error: "Non autorise" });
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
    cb(null, id + ext);
  },
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const resignIPA = (ipaPath, certPath, certPassword, profilePath, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      execSync("which zsign");
    } catch {
      return reject(new Error("zsign non installe"));
    }

    const cmd =
      "zsign -k " +
      certPath +
      " -p " +
      certPassword +
      " -m " +
      profilePath +
      " -o " +
      outputPath +
      " -z 9 " +
      ipaPath;

    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(new Error("Echec signature: " + stderr));
      resolve(outputPath);
    });
  });
};

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/apps/upload", auth, upload.single("ipa"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun ipa recu" });

  const db = loadDB();
  const entry = {
    id: crypto.randomUUID(),
    name: req.body.name || req.file.originalname.replace(".ipa", ""),
    version: req.body.version || "1.0.0",
    bundleId: req.body.bundleId || "com.example.app",
    filename: req.file.filename,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    certId: null,
    profileId: null,
    signed: false,
  };

  db.apps.push(entry);
  saveDB(db);
  res.json({ success: true, app: entry });
});

app.post("/api/certs/upload", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier recu" });

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
  const a = db.apps.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "App non trouvee" });

  a.certId = req.body.certId;
  a.profileId = req.body.profileId;
  a.signed = false;
  saveDB(db);

  res.json({ success: true, app: a });
});

app.post("/api/apps/:id/sign", auth, async (req, res) => {
  const db = loadDB();
  const a = db.apps.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "App non trouvee" });

  const cert = db.certs.find((c) => c.id === a.certId);
  const profile = db.profiles.find((p) => p.id === a.profileId);

  if (!cert) return res.status(400).json({ error: "Aucun certificat" });
  if (!profile) return res.status(400).json({ error: "Aucun profil" });

  const ipaPath = path.join(CONFIG.UPLOAD_DIR, a.filename);
  const certPath = path.join(CONFIG.CERT_DIR, cert.filename);
  const profilePath = path.join(CONFIG.CERT_DIR, profile.filename);

  const signedFilename = "signed_" + a.id + ".ipa";
  const signedPath = path.join(CONFIG.SIGNED_DIR, signedFilename);

  try {
    await resignIPA(ipaPath, certPath, cert.password, profilePath, signedPath);

    const plistFilename = a.id + ".plist";
    const ipaUrl = CONFIG.SERVER_URL + "/download/" + signedFilename;

    const plist =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
      '<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>' +
      ipaUrl +
      "</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>" +
      a.bundleId +
      "</string><key>bundle-version</key><string>" +
      a.version +
      "</string><key>kind</key><string>software</string><key>title</key><string>" +
      a.name +
      "</string></dict></dict></array></dict></plist>";

    fs.writeFileSync(path.join(CONFIG.PLIST_DIR, plistFilename), plist);

    a.signed = true;
    a.signedFilename = signedFilename;
    a.plistFilename = plistFilename;
    saveDB(db);

    const installUrl =
      "itms-services://?action=download-manifest&url=" +
      encodeURIComponent(CONFIG.SERVER_URL + "/plist/" + plistFilename);

    res.json({ success: true, app: a, installUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/apps", auth, (req, res) => res.json(loadDB().apps));

app.get("/api/certs", auth, (req, res) => {
  const db = loadDB();
  res.json({ certs: db.certs, profiles: db.profiles });
});

app.get("/download/:filename", (req, res) => {
  const f = path.join(CONFIG.SIGNED_DIR, req.params.filename);
  if (!fs.existsSync(f)) return res.status(404).send("Fichier non trouve");
  res.download(f);
});

app.get("/plist/:filename", (req, res) => {
  const f = path.join(CONFIG.PLIST_DIR, req.params.filename);
  if (!fs.existsSync(f)) return res.status(404).send("Plist non trouve");
  res.setHeader("Content-Type", "application/xml");
  res.sendFile(path.resolve(f));
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log("Serveur demarre sur le port " + CONFIG.PORT);
});
