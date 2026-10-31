/**
 * Attendance System - Automated Database Backup & Google Drive Sync
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const archiverPkg = require("archiver");
const { google } = require("googleapis");

const BACKUP_DIR = path.join(process.cwd(), "backups");
if (!fs.existsSync(BACKUP_DIR)) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (e) {}
}

function createZipArchive(options = { zlib: { level: 9 } }) {
  if (typeof archiverPkg === "function") return archiverPkg("zip", options);
  if (archiverPkg.ZipArchive) return new archiverPkg.ZipArchive(options);
  if (archiverPkg.default && typeof archiverPkg.default === "function") return archiverPkg.default("zip", options);
  return new archiverPkg.Archiver("zip", options);
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DATABASE_URL_UNPOOLED) return process.env.DATABASE_URL_UNPOOLED;

  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/DATABASE_URL="?([^"\r\n]+)"?/);
    if (match) return match[1];
  }
  return "postgresql://neondb_owner:npg_guniGMWqBY45@ep-icy-unit-b5ofu0n4-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
}

class AttendanceBackupManager {
  constructor() {
    this.folderName = "Attendance_System_Backups";
    this.notifyPhone = process.env.BACKUP_NOTIFY_PHONE || "201554826209";
  }

  getGoogleDriveClient() {
    const tokenPath = path.join(process.cwd(), "data", "google_drive_token.json");
    const oauthCredsPath = path.join(process.cwd(), "oauth-credentials.json");

    let creds = null;
    let tokens = null;

    if (process.env.GOOGLE_DRIVE_CREDENTIALS_JSON && process.env.GOOGLE_DRIVE_TOKEN_JSON) {
      try {
        creds = JSON.parse(process.env.GOOGLE_DRIVE_CREDENTIALS_JSON);
        tokens = JSON.parse(process.env.GOOGLE_DRIVE_TOKEN_JSON);
      } catch (e) {}
    } else if (fs.existsSync(tokenPath) && fs.existsSync(oauthCredsPath)) {
      try {
        creds = JSON.parse(fs.readFileSync(oauthCredsPath, "utf-8"));
        tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      } catch (e) {}
    }

    if (creds && tokens) {
      const { client_secret, client_id } = creds.installed || creds.web;
      const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
      oauth2Client.setCredentials(tokens);

      return { drive: google.drive({ version: "v3", auth: oauth2Client }), type: "oauth2" };
    }

    return null;
  }

  async getOrCreateBackupFolder(drive) {
    try {
      const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${this.folderName}' and trashed=false`,
        fields: "files(id, name)",
        spaces: "drive",
      });
      if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
      }
      const createRes = await drive.files.create({
        resource: {
          name: this.folderName,
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      console.log(`📁 [Attendance Backup] Created folder '${this.folderName}' (ID: ${createRes.data.id})`);
      return createRes.data.id;
    } catch (e) {
      console.warn("[Attendance Backup] Could not create folder:", e.message);
      return null;
    }
  }

  async dumpPostgresToSql(pgUrl, outputSqlPath) {
    const pool = new Pool({
      connectionString: pgUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });

    const stream = fs.createWriteStream(outputSqlPath, { encoding: "utf-8" });
    const writeLine = (line) => stream.write(line + "\n");

    const stats = {
      schemas: ["public"],
      tables: {},
      totalRows: 0,
    };

    try {
      writeLine("-- ========================================================");
      writeLine(`-- Attendance System Neon PostgreSQL Backup`);
      writeLine(`-- Timestamp: ${new Date().toISOString()}`);
      writeLine("-- ========================================================\n");

      const tablesRes = await pool.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog') AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);

      for (const t of tablesRes.rows) {
        const fullTableName = `"${t.table_schema}"."${t.table_name}"`;

        const colsRes = await pool.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `, [t.table_schema, t.table_name]);

        if (colsRes.rows.length === 0) continue;

        writeLine(`-- Table: ${fullTableName}`);
        writeLine(`CREATE TABLE IF NOT EXISTS ${fullTableName} (`);
        const colDefs = colsRes.rows.map((c) => {
          let def = `  "${c.column_name}" ${c.data_type.toUpperCase()}`;
          if (c.column_default) def += ` DEFAULT ${c.column_default}`;
          if (c.is_nullable === "NO") def += ` NOT NULL`;
          return def;
        });
        writeLine(colDefs.join(",\n"));
        writeLine(`);\n`);

        const rowsRes = await pool.query(`SELECT * FROM ${fullTableName}`);
        const rowCount = rowsRes.rows.length;
        stats.tables[t.table_name] = rowCount;
        stats.totalRows += rowCount;

        if (rowCount > 0) {
          const colNames = colsRes.rows.map((c) => `"${c.column_name}"`).join(", ");

          for (let i = 0; i < rowCount; i += 100) {
            const batch = rowsRes.rows.slice(i, i + 100);
            const valuesList = batch
              .map((row) => {
                const valArr = colsRes.rows.map((c) => {
                  const v = row[c.column_name];
                  if (v === null || v === undefined) return "NULL";
                  if (typeof v === "number" || typeof v === "boolean") return v;
                  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                  if (Buffer.isBuffer(v)) return `decode('${v.toString("hex")}', 'hex')`;
                  return `'${String(v).replace(/'/g, "''")}'`;
                });
                return `(${valArr.join(", ")})`;
              })
              .join(",\n");

            writeLine(`INSERT INTO ${fullTableName} (${colNames}) VALUES\n${valuesList};`);
          }
          writeLine("");
        }
      }

      await new Promise((resolve) => stream.end(resolve));
      return stats;
    } finally {
      await pool.end();
    }
  }

  async createBackupZip(sqlPath, stats) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipFileName = `attendance_backup_${timestamp}.zip`;
    const targetDir = fs.existsSync("/tmp") ? "/tmp" : BACKUP_DIR;
    const zipFilePath = path.join(targetDir, zipFileName);

    const output = fs.createWriteStream(zipFilePath);
    const archive = createZipArchive({ zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on("close", () => {
        resolve({
          zipPath: zipFilePath,
          zipFileName,
          sizeBytes: archive.pointer(),
          sizeMB: (archive.pointer() / (1024 * 1024)).toFixed(2),
        });
      });

      archive.on("error", (err) => reject(err));
      archive.pipe(output);

      if (sqlPath && fs.existsSync(sqlPath)) {
        archive.file(sqlPath, { name: "attendance_database_dump.sql" });
      }

      const manifest = {
        project: "Attendance System",
        createdAt: new Date().toISOString(),
        tablesCount: Object.keys(stats.tables).length,
        totalRows: stats.totalRows,
        tables: stats.tables,
      };
      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

      archive.finalize();
    });
  }

  async uploadToGoogleDrive(zipFilePath, zipFileName, folderId) {
    const clientInfo = this.getGoogleDriveClient();
    if (!clientInfo) throw new Error("No Google Drive credentials configured.");

    const { drive } = clientInfo;
    let targetFolderId = folderId || (await this.getOrCreateBackupFolder(drive));

    const res = await drive.files.create({
      resource: {
        name: zipFileName,
        parents: targetFolderId ? [targetFolderId] : [],
      },
      media: {
        mimeType: "application/zip",
        body: fs.createReadStream(zipFilePath),
      },
      fields: "id, name, webViewLink, webContentLink, size",
    });

    return res.data;
  }

  async sendWhatsAppNotification(message) {
    try {
      // Send via our live Railway WhatsApp CRM API!
      const loginRes = await fetch("https://whatsapp-pro-crm-production-613b.up.railway.app/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "201554826209@whatsapp.pro",
          password: "WpAdmin#2026Secure",
        }),
      });

      if (!loginRes.ok) return false;
      const loginData = await loginRes.json();
      const cookie = loginRes.headers.get("set-cookie");

      const cleanPhone = this.notifyPhone.replace(/[^0-9]/g, "");

      const sendRes = await fetch("https://whatsapp-pro-crm-production-613b.up.railway.app/api/send", {
        method: "POST",
        headers: {
          cookie: cookie || "",
          Authorization: `Bearer ${loginData.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: cleanPhone,
          text: message,
        }),
      });

      const sendData = await sendRes.json();
      return sendData.success === true;
    } catch (e) {
      console.warn("[Attendance Backup] WhatsApp notification error:", e.message);
      return false;
    }
  }

  async runBackup() {
    console.log("====================================================");
    console.log("🛡️ [Attendance Backup] Starting Backup Process...");
    console.log("====================================================");

    const startTime = Date.now();
    const pgUrl = getDatabaseUrl();
    const targetDir = fs.existsSync("/tmp") ? "/tmp" : BACKUP_DIR;
    const tempSqlPath = path.join(targetDir, `neon_attendance_${Date.now()}.sql`);

    console.log("🐘 [Attendance Backup] Dumping Neon database...");
    const stats = await this.dumpPostgresToSql(pgUrl, tempSqlPath);
    console.log(`🐘 [Attendance Backup] Dump completed: ${stats.totalRows} rows across ${Object.keys(stats.tables).length} tables.`);

    console.log("📦 [Attendance Backup] Archiving into ZIP...");
    const zipResult = await this.createBackupZip(tempSqlPath, stats);

    if (fs.existsSync(tempSqlPath)) {
      try {
        fs.unlinkSync(tempSqlPath);
      } catch (e) {}
    }

    console.log("☁️ [Attendance Backup] Uploading to Google Drive...");
    const driveResult = await this.uploadToGoogleDrive(zipResult.zipPath, zipResult.zipFileName);
    console.log(`☁️ [Attendance Backup] ✅ Uploaded to Google Drive! File ID: ${driveResult.id}`);

    // Build WhatsApp Notification
    const dateFormatted = new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
    let msg = `🛡️ *تقرير النسخ الاحتياطي التلقائي (نظام الحضور والانصراف)* 🛡️\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 *التاريخ والوقت:* ${dateFormatted}\n`;
    msg += `📦 *اسم الملف:* \`${zipResult.zipFileName}\`\n`;
    msg += `📊 *حجم النسخة:* ${zipResult.sizeMB} ميجابايت\n\n`;

    msg += `📂 *بيانات نظام الحضور (Neon Postgres):*\n`;
    msg += `✅ تم حفظ ${Object.keys(stats.tables).length} جدولاً بالكامل (${stats.totalRows} سجل).\n`;
    msg += `   • سجلات الحضور: ${stats.tables["attendance_logs"] || 0}\n`;
    msg += `   • الموظفون/المستخدمون: ${stats.tables["users"] || 0}\n`;
    msg += `   • أجهزة وإشارات BLE: ${stats.tables["ble_events"] || 0}\n`;
    msg += `   • كروت وبصمات NFC: ${stats.tables["nfc_cards"] || 0}\n\n`;

    msg += `☁️ *Google Drive (5TB):*\n`;
    msg += `✅ تم الرفع بنجاح على مجلد Attendance_System_Backups في جوجل درايف!\n`;
    if (driveResult.webViewLink) {
      msg += `🔗 رابط المعاينة المباشر: ${driveResult.webViewLink}\n`;
    }

    msg += `\n⏰ *الموعد القادم:* بعد 3 أيام تلقائياً بإذن الله.\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━`;

    console.log("📲 [Attendance Backup] Sending WhatsApp confirmation...");
    const waSent = await this.sendWhatsAppNotification(msg);
    if (waSent) {
      console.log("📲 [Attendance Backup] ✅ WhatsApp message delivered!");
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ [Attendance Backup] Process completed in ${duration}s.`);

    return {
      success: true,
      zipResult,
      stats,
      driveResult,
      waSent,
    };
  }
}

const attendanceBackupManager = new AttendanceBackupManager();
module.exports = attendanceBackupManager;

