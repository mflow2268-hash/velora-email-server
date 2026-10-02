const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// OAuth client setup
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Test route
app.get('/api/', (req, res) => {
  res.json({ ok: true, message: 'Velora Email Server is running!' });
});

// Step 1: Google login URL generate karo
app.get('/api/auth/google', (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  });
  res.json({ url });
});

// Step 2: Google callback - token save karo
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // User ki email nikalo
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Yahan hum token ko user ke browser mein bhej rahe hain
    // (Production mein ise database mein save karna chahiye)
    const tokenData = encodeURIComponent(JSON.stringify({
      email: userInfo.data.email,
      tokens: tokens
    }));

    res.redirect(`${process.env.FRONTEND_URL}/#connected=${tokenData}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Email bhejo
app.post('/api/send', async (req, res) => {
  const { tokens, to, cc, bcc, subject, body } = req.body;
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Email raw format mein banao
    const messageParts = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : '',
      bcc ? `Bcc: ${bcc}` : '',
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      body
    ].filter(Boolean).join('\r\n');

    const encodedMessage = Buffer.from(messageParts)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 4: Replies check karo
app.post('/api/replies', async (req, res) => {
  const { tokens, subject } = req.body;
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:"${subject}" newer_than:7d`,
      maxResults: 20
    });

    const replies = [];
    if (list.data.messages) {
      for (const msg of list.data.messages) {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });
        const headers = full.data.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const snippet = full.data.snippet || '';
        replies.push({ from, date, snippet });
      }
    }

    res.json({ ok: true, replies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports.handler = serverless(app);
