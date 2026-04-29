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

[CONFIG.UPLOAD_DIR, CONFIG.CERT_DIR, CONFIG.SIGNED_DIR, CONFIG.PLIST_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

const DB_FILE = "./db.json";
const loadDB = () => { if (!fs.existsSync(DB_FILE)) return { apps: [], certs: [], profiles: [] }; return JSON.parse(fs.readFileSync(DB_FILE)); };
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const auth = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== CONFIG.API_KEY) return res.status(401).json({ error: "Non autorise" });
  next();
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => { if (file.originalname.endsWith(".ipa")) cb(null, CONFIG.UPLOAD_DIR); else cb(null, CONFIG.CERT_DIR); },
  filename: (req, file, cb) => { cb(null, crypto.randomUUID() + path.extname(file.originalname)); },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const resignIPA = (ipaPath, certPath, certPassword, profilePath, outputPath) => new Promise((resolve, reject) => {
  try { execSync("which zsign"); } catch { return reject(new Error("zsign non installe")); }
  exec("zsign -k " + certPath + " -p " + certPassword + " -m " + profilePath + " -o " + outputPath + " -z 9 " + ipaPath, (error, stdout, stderr) => {
    if (error) return reject(new Error("Echec: " + stderr));
    resolve(outputPath);
  });
});

// Interface web
app.get("/", (req, res) => {
  const db = loadDB();
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IPA Deploy</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, sans-serif; background: #F5F5F3; min-height: 100vh; }
.header { background: #fff; padding: 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 12px; }
.logo { width: 36px; height: 36px; background: #111; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
h1 { font-size: 18px; font-weight: 800; }
.sub { font-size: 12px; color: #aaa; }
.content { padding: 16px; max-width: 500px; margin: 0 auto; }
.card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.card h2 { font-size: 14px; font-weight: 700; margin-bottom: 14px; }
label { font-size: 12px; color: #888; font-weight: 600; display: block; margin-bottom: 5px; }
input, select { width: 100%; padding: 11px 14px; border: 1.5px solid #E5E5E3; border-radius: 12px; font-size: 14px; background: #FAFAF8; margin-bottom: 12px; }
.btn { width: 100%; padding: 14px; border: none; border-radius: 13px; font-size: 15px; font-weight: 700; background: #111; color: #fff; cursor: pointer; }
.btn-blue { background: #007AFF; }
.btn-green { background: #22C55E; }
.app-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f5f5f5; }
.app-icon { width: 44px; height: 44px; border-radius: 10px; background: #F0F0EE; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.app-name { font-weight: 700; font-size: 14px; }
.app-sub { font-size: 12px; color: #aaa; }
.badge { font-size: 10px; padding: 2px 7px; border-radius: 20px; font-weight: 700; background: #F0FDF4; color: #16A34A; }
.install-box { background: #F0FDF4; border: 1.5px solid #22C55E; border-radius: 14px; padding: 14px; margin-top: 14px; }
.install-url { font-family: monospace; font-size: 11px; word-break: break-all; color: #111; background: #fff; padding: 10px; border-radius: 8px; margin: 8px 0; }
.section-label { font-size: 11px; color: #aaa; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">📦</div>
  <div><h1>IPA Deploy</h1><div class="sub">Distribution iOS sans l'App Store</div></div>
</div>
<div class="content">

  <!-- Upload IPA -->
  <div class="card">
    <h2>📥 Uploader un .ipa</h2>
    <form action="/ui/upload-ipa" method="POST" enctype="multipart/form-data">
      <label>Nom de l'app</label>
      <input type="text" name="name" placeholder="MonApp" required>
      <label>Version</label>
      <input type="text" name="version" value="1.0.0">
      <label>Bundle ID</label>
      <input type="text" name="bundleId" placeholder="com.exemple.monapp">
      <label>Fichier .ipa</label>
      <input type="file" name="ipa" accept=".ipa" required>
      <button type="submit" class="btn">Uploader</button>
    </form>
  </div>

  <!-- Upload Cert -->
  <div class="card">
    <h2>🔐 Ajouter un certificat / profil</h2>
    <form action="/ui/upload-cert" method="POST" enctype="multipart/form-data">
      <label>Nom</label>
      <input type="text" name="name" placeholder="Distribution Cert" required>
      <label>Type</label>
      <select name="type">
        <option value="p12">.p12 (certificat)</option>
        <option value="mobileprovision">.mobileprovision (profil)</option>
      </select>
      <label>Mot de passe (si .p12)</label>
      <input type="password" name="password" placeholder="Mot de passe">
      <label>Fichier</label>
      <input type="file" name="file" accept=".p12,.mobileprovision" required>
      <button type="submit" class="btn">Uploader</button>
    </form>
  </div>

  <!-- Apps -->
  <div class="card">
    <h2>📱 Apps (${db.apps.length})</h2>
    ${db.apps.length === 0 ? '<p style="color:#aaa;font-size:13px;">Aucune app uploadée</p>' : db.apps.map(app => `
    <div class="app-row">
      <div class="app-icon">📱</div>
      <div style="flex:1">
        <div class="app-name">${app.name} ${app.signed ? '<span class="badge">✅ Signé</span>' : ''}</div>
        <div class="app-sub">v${app.version}</div>
      </div>
      <a href="/ui/app/${app.id}" style="background:#111;color:#fff;padding:8px 14px;border-radius:10px;text-decoration:none;font-size:12px;font-weight:700;">Gérer →</a>
    </div>`).join("")}
  </div>

  <!-- Certs -->
  <div class="card">
    <h2>🔐 Certificats (${db.certs.length}) · Profils (${db.profiles.length})</h2>
    ${[...db.certs, ...db.profiles].length === 0 ? '<p style="color:#aaa;font-size:13px;">Aucun certificat</p>' : [...db.certs, ...db.profiles].map(c => `<div style="padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:13px;"><strong>${c.type === "p12" ? "🔐" : "📋"} ${c.name}</strong></div>`).join("")}
  </div>

</div>
</body>
</html>`);
});

// Page gestion d'une app
app.get("/ui/app/:id", (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).send("App non trouvée");
  const installUrl = app.plistFilename ? "itms-services://?action=download-manifest&url=" + encodeURIComponent(CONFIG.SERVER_URL + "/plist/" + app.plistFilename) : null;
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${app.name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, sans-serif; background: #F5F5F3; }
.header { background: #fff; padding: 20px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 12px; }
.back { font-size: 14px; color: #007AFF; text-decoration: none; font-weight: 600; }
h1 { font-size: 18px; font-weight: 800; }
.content { padding: 16px; max-width: 500px; margin: 0 auto; }
.card { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.card h2 { font-size: 14px; font-weight: 700; margin-bottom: 14px; }
label { font-size: 12px; color: #888; font-weight: 600; display: block; margin-bottom: 5px; }
select { width: 100%; padding: 11px 14px; border: 1.5px solid #E5E5E3; border-radius: 12px; font-size: 14px; background: #FAFAF8; margin-bottom: 12px; }
.btn { width: 100%; padding: 14px; border: none; border-radius: 13px; font-size: 15px; font-weight: 700; background: #111; color: #fff; cursor: pointer; margin-bottom: 10px; }
.btn-blue { background: #007AFF; }
.install-box { background: #F0FDF4; border: 1.5px solid #22C55E; border-radius: 14px; padding: 16px; }
.install-url { font-family: monospace; font-size: 11px; word-break: break-all; color: #111; background: #fff; padding: 10px; border-radius: 8px; margin: 10px 0; border: 1px solid #ddd; user-select: all; }
</style>
</head>
<body>
<div class="header">
  <a href="/" class="back">← Retour</a>
  <h1 style="margin-left:8px;">📱 ${app.name}</h1>
</div>
<div class="content">

  <div class="card">
    <h2>ℹ️ Infos</h2>
    <p style="font-size:13px;color:#555;">Version : <strong>${app.version}</strong></p>
    <p style="font-size:13px;color:#555;margin-top:6px;">Bundle ID : <strong>${app.bundleId}</strong></p>
    <p style="font-size:13px;color:#555;margin-top:6px;">Signé : <strong>${app.signed ? "✅ Oui" : "❌ Non"}</strong></p>
  </div>

  <!-- Assigner cert + profil -->
  <div class="card">
    <h2>⚙️ Configurer</h2>
    <form action="/ui/assign/${app.id}" method="POST">
      <label>Certificat .p12</label>
      <select name="certId">
        <option value="">-- Choisir --</option>
        ${db.certs.map(c => `<option value="${c.id}" ${app.certId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
      </select>
      <label>Profil .mobileprovision</label>
      <select name="profileId">
        <option value="">-- Choisir --</option>
        ${db.profiles.map(p => `<option value="${p.id}" ${app.profileId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
      </select>
      <button type="submit" class="btn">Enregistrer</button>
    </form>
  </div>

  <!-- Signer -->
  ${app.certId && app.profileId ? `
  <div class="card">
    <h2>✍️ Signer & Installer</h2>
    <form action="/ui/sign/${app.id}" method="POST">
      <button type="submit" class="btn">✍️ Re-signer l'app</button>
    </form>
  </div>` : '<div class="card"><p style="color:#F59E0B;font-size:13px;">⚠️ Configure d\'abord un certificat et un profil</p></div>'}

  <!-- Lien installation -->
  ${installUrl ? `
  <div class="install-box">
    <p style="font-weight:700;font-size:14px;margin-bottom:4px;">🎉 Lien d'installation</p>
    <p style="font-size:12px;color:#555;margin-bottom:8px;">Appuie longuement pour copier, ou utilise le bouton</p>
    <div class="install-url" id="iurl">${installUrl}</div>
    <a href="${installUrl}" style="display:block;padding:14px;background:#007AFF;color:#fff;border-radius:13px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;margin-bottom:10px;">📲 Installer maintenant</a>
    <button onclick="copyUrl()" style="width:100%;padding:12px;border:1.5px solid #111;border-radius:13px;background:#fff;font-size:14px;font-weight:700;cursor:pointer;">📋 Copier le lien</button>
    <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(installUrl)}&size=180x180" style="display:block;margin:14px auto 0;border-radius:10px;">
  </div>
  <script>
  function copyUrl() {
    var t = document.getElementById("iurl").innerText;
    navigator.clipboard.writeText(t).then(function() { alert("Lien copié !"); });
  }
  </script>` : ""}

</div>
</body>
</html>`);
});

// Actions UI
app.post("/ui/upload-ipa", upload.single("ipa"), (req, res) => {
  if (!req.file) return res.redirect("/?error=no-file");
  const db = loadDB();
  db.apps.push({ id: crypto.randomUUID(), name: req.body.name || req.file.originalname.replace(".ipa", ""), version: req.body.version || "1.0.0", bundleId: req.body.bundleId || "com.example.app", filename: req.file.filename, size: req.file.size, uploadedAt: new Date().toISOString(), certId: null, profileId: null, signed: false });
  saveDB(db);
  res.redirect("/");
});

app.post("/ui/upload-cert", upload.single("file"), (req, res) => {
  if (!req.file) return res.redirect("/?error=no-file");
  const db = loadDB();
  const entry = { id: crypto.randomUUID(), name: req.body.name, type: req.body.type, filename: req.file.filename, password: req.body.password || "", uploadedAt: new Date().toISOString() };
  if (req.body.type === "p12") db.certs.push(entry);
  else db.profiles.push(entry);
  saveDB(db);
  res.redirect("/");
});

app.post("/ui/assign/:id", (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.id);
  if (app) { app.certId = req.body.certId; app.profileId = req.body.profileId; app.signed = false; saveDB(db); }
  res.redirect("/ui/app/" + req.params.id);
});

app.post("/ui/sign/:id", async (req, res) => {
  const db = loadDB();
  const app = db.apps.find(a => a.id === req.params.id);
  if (!app) return res.redirect("/");
  const cert = db.certs.find(c => c.id === app.certId);
  const profile = db.profiles.find(p => p.id === app.profileId);
  if (!cert || !profile) return res.redirect("/ui/app/" + req.params.id);
  const signedFilename = "signed_" + app.id + ".ipa";
  const plistFilename = app.id + ".plist";
  try {
    await resignIPA(path.join(CONFIG.UPLOAD_DIR, app.filename), path.join(CONFIG.CERT_DIR, cert.filename), cert.password, path.join(CONFIG.CERT_DIR, profile.filename), path.join(CONFIG.SIGNED_DIR, signedFilename));
    const ipaUrl = CONFIG.SERVER_URL + "/download/" + signedFilename;
    const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>' + ipaUrl + '</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>' + app.bundleId + '</string><key>bundle-version</key><string>' + app.version + '</string><key>kind</key><string>software</string><key>title</key><string>' + app.name + '</string></dict></dict></array></dict></plist>';
    fs.writeFileSync(path.join(CONFIG.PLIST_DIR, plistFilename), plist);
    app.signed = true; app.signedFilename = signedFilename; app.plistFilename = plistFilename;
    saveDB(db);
  } catch (e) { console.error(e); }
  res.redirect("/ui/app/" + req.params.id);
});

// API JSON
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/api/apps", auth, (req, res) => res.json(loadDB().apps));
app.get("/api/certs", auth, (req, res) => { const db = loadDB(); res.json({ certs: db.certs, profiles: db.profiles }); });
app.post("/api/apps/upload", auth, upload.single("ipa"), (req, res) => { if (!req.file) return res.status(400).json({ error: "no file" }); const db = loadDB(); const entry = { id: crypto.randomUUID(), name: req.body.name || req.file.originalname.replace(".ipa",""), version: req.body.version||"1.0.0", bundleId: req.body.bundleId||"com.example.app", filename: req.file.filename, size: req.file.size, uploadedAt: new Date().toISOString(), certId:null, profileId:null, signed:false }; db.apps.push(entry); saveDB(db); res.json({ success:true, app:entry }); });
app.post("/api/certs/upload", auth, upload.single("file"), (req, res) => { if (!req.file) return res.status(400).json({ error: "no file" }); const db = loadDB(); const isP12 = req.file.originalname.endsWith(".p12"); const entry = { id: crypto.randomUUID(), name: req.body.name||req.file.originalname, type: isP12?"p12":"mobileprovision", filename: req.file.filename, password: req.body.password||"", expiry: req.body.expiry||null, uploadedAt: new Date().toISOString() }; if(isP12) db.certs.push(entry); else db.profiles.push(entry); saveDB(db); res.json({ success:true, entry }); });
app.post("/api/apps/:id/assign", auth, (req, res) => { const db = loadDB(); const a = db.apps.find(x=>x.id===req.params.id); if(!a) return res.status(404).json({error:"not found"}); a.certId=req.body.certId; a.profileId=req.body.profileId; a.signed=false; saveDB(db); res.json({success:true,app:a}); });
app.post("/api/apps/:id/sign", auth, async (req, res) => { const db = loadDB(); const a = db.apps.find(x=>x.id===req.params.id); if(!a) return res.status(404).json({error:"not found"}); const cert = db.certs.find(c=>c.id===a.certId); const profile = db.profiles.find(p=>p.id===a.profileId); if(!cert||!profile) return res.status(400).json({error:"missing cert or profile"}); const sf="signed_"+a.id+".ipa"; const pf=a.id+".plist"; try { await resignIPA(path.join(CONFIG.UPLOAD_DIR,a.filename),path.join(CONFIG.CERT_DIR,cert.filename),cert.password,path.join(CONFIG.CERT_DIR,profile.filename),path.join(CONFIG.SIGNED_DIR,sf)); const iu=CONFIG.SERVER_URL+"/download/"+sf; const pl='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>'+iu+'</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>'+a.bundleId+'</string><key>bundle-version</key><string>'+a.version+'</string><key>kind</key><string>software</string><key>title</key><string>'+a.name+'</string></dict></dict></array></dict></plist>'; fs.writeFileSync(path.join(CONFIG.PLIST_DIR,pf),pl); a.signed=true; a.signedFilename=sf; a.plistFilename=pf; saveDB(db); const installUrl="itms-services://?action=download-manifest&url="+encodeURIComponent(CONFIG.SERVER_URL+"/plist/"+pf); res.json({success:true,app:a,installUrl}); } catch(e) { res.status(500).json({error:e.message}); } });
app.get("/download/:filename", (req, res) => { const f=path.join(CONFIG.SIGNED_DIR,req.params.filename); if(!fs.existsSync(f)) return res.status(404).send("not found"); res.download(f); });
app.get("/plist/:filename", (req, res) => { const f=path.join(CONFIG.PLIST_DIR,req.params.filename); if(!fs.existsSync(f)) return res.status(404).send("not found"); res.setHeader("Content-Type","application/xml"); res.sendFile(path.resolve(f)); });

app.listen(CONFIG.PORT, () => console.log("Serveur sur port " + CONFIG.PORT));
