import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { google } from 'googleapis';

const credsPath = path.join(process.cwd(), 'oauth-credentials.json');
const tokenPath = path.join(process.cwd(), 'data', 'google_drive_token.json');

if (!fs.existsSync(credsPath)) {
  console.error('❌ oauth-credentials.json not found!');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
const { client_id, client_secret } = creds.installed || creds.web;

const REDIRECT_URI = 'http://localhost:3333/oauth2callback';
const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
  ],
});

console.log('====================================================');
console.log('🔑 Google Drive OAuth Re-authorization');
console.log('====================================================');
console.log('\nافتح الرابط التالي في المتصفح وسجل دخولك بجوجل:\n');
console.log(authUrl);
console.log('\n⏳ بانتظار الموافقة في المتصفح...\n');

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth2callback')) {
    const url = new URL(req.url, 'http://localhost:3333');
    const code = url.searchParams.get('code');

    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>✅ تم تجديد صلاحيات جوجل درايف بنجاح! يمكنك إغلاق هذه الصفحة والعودة للـ Terminal.</h1>');

        console.log('✅ تم حفظ التوكن الجديد بنجاح في data/google_drive_token.json!');

        // Test Drive connection
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        const about = await drive.about.get({ fields: 'user, storageQuota' });
        console.log(`☁️ متصل بحساب: ${about.data.user.emailAddress}`);

        setTimeout(() => process.exit(0), 1000);
      } catch (err) {
        console.error('❌ خطأ في استبدال الكود:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>❌ حدث خطأ أثناء استبدال الكود</h1>');
      }
    }
  }
});

server.listen(3333, () => {
  console.log('🌐 السيرفر المحلي مستعد للاستقبال على http://localhost:3333/oauth2callback');
});
