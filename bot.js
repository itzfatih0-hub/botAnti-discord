require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const OpenAI = require('openai');
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});
const path = require('path');
const SHOP_ITEMS = {
    laptop: {
        name: '💻 Laptop',
        price: 500
    },

    crown: {
        name: '👑 Crown',
        price: 1000
    },

    vip: {
        name: '💎 VIP Badge',
        price: 2500
    },

    potion: {
        name: '🧪 XP Potion',
        price: 300
    }
};
const os = require('os');
const Canvas = require('canvas');
Canvas.registerFont('./fonts/Poppins-Regular.ttf', {
    family: 'Poppins'
});
const { AttachmentBuilder } = require('discord.js');
const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    Partials,
    Events
} = require('discord.js');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// =====================
// JSON DB
// =====================
const DB_FILE = path.join(__dirname, 'db.json');

let db;
try {
    db = fs.existsSync(DB_FILE)
        ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
        : { users: {}, guilds: {} };
} catch {
    db = { users: {}, guilds: {} };
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function getUser(id) {
    if (!db.users[id]) {
        db.users[id] = {
            xp: 0,
            money: 0,
            lastDaily: 0,
            memory: [],
            recentMessages: [],
            spam: 0,
            warns: 0,
            inventory: {},
            afk: null
        };
    }
    db.users[id].recentMessages ??= [];
    db.users[id].memory ??= [];
    db.users[id].spam ??= 0;
    db.users[id].warns ??= 0;
    db.users[id].inventory ??= {};
    db.users[id].afk ??= null;
    return db.users[id];
}

function getGuild(id) {
    if (!db.guilds[id]) {
        db.guilds[id] = {
            prefix: '?',
            logChannel: null,
            welcomeChannel: null,
            personality: 'chill',
            automod: {
                enabled: true,
                antiSpam: true,
                antiLink: true,
                antiCaps: true,
                antiMentionSpam: true,
                antiRepeatSpam: true,
                warnThreshold: 3,
                kickThreshold: 5,
                muteMs: 300000,
                mentionMax: 5,
                capsRatio: 0.7,
                linkWhitelist: []
            },
            raid: {
                enabled: false,
                threshold: 6,
                windowMs: 10000,
                lockMs: 300000,
                newAccountAgeMs: 86400000
            },
            raidLockUntil: 0
        };
    }

    const g = db.guilds[id];
    g.personality ??= 'chill';
    g.prefix ??= '?';
    g.logChannel ??= null;
    g.welcomeChannel ??= null;
    g.raidLockUntil ??= 0;

    g.automod ??= {};
    g.automod.enabled ??= true;
    g.automod.antiSpam ??= true;
    g.automod.antiLink ??= true;
    g.automod.antiCaps ??= true;
    g.automod.antiMentionSpam ??= true;
    g.automod.antiRepeatSpam ??= true;
    g.automod.warnThreshold ??= 3;
    g.automod.kickThreshold ??= 5;
    g.automod.muteMs ??= 300000;
    g.automod.mentionMax ??= 5;
    g.automod.capsRatio ??= 0.7;
    g.automod.linkWhitelist ??= [];

    g.raid ??= {};
    g.raid.enabled ??= false;
    g.raid.threshold ??= 6;
    g.raid.windowMs ??= 10000;
    g.raid.lockMs ??= 500000;
    g.raid.newAccountAgeMs ??= 86400000;

    return g;
}

// =====================
// UTILS
// =====================
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const BLOCKED_PATTERNS = [
  /ignore previous instructions/i,
  /system override/i,
  /developer mode/i,
  /reveal prompt/i,
  /jailbreak/i,
  /override sukses/i,
  /bypass/i,
  /DEBUG MODE/i
];

function isInjection(text = '') {
  return BLOCKED_PATTERNS.some(pattern => pattern.test(text));
}

async function chatAIReal(userId, text, persona = 'chill') {
    const user = getUser(userId);

    let systemPrompt = "Kamu adalah AI Discord yang santai, pintar, dan membantu, Mirip ChatGPT. Jawab pakai Bahasa Indonesia";
    if (persona === 'formal') systemPrompt = "Kamu AI formal dan profesional. Jawab pakai Bahasa Indonesia";
    if (persona === 'funny') systemPrompt = "Kamu AI kocak, santai, sedikit sarkas. Jawab pakai Bahasa Indonesia";
    if (persona === 'friendly') systemPrompt = "Kamu AI ramah dan santai. Jawab pakai Bahasa Indonesia";

    if (isInjection(text)) {
      return "⚠️ Prompt injection detected.";
    }

    user.memory.push({
        role: "user",
        content: text
    });

    if (user.memory.length > 12) {
        user.memory.shift();
    }

    try {

        const res = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    ...user.memory
                ]
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const reply = res.data.choices[0].message.content;

        user.memory.push({
            role: "assistant",
            content: reply
        });

        saveDB();

        return reply;

    } catch (err) {
      console.log(err.response?.data || err.message);
      return `❌ ${JSON.stringify(err.response?.data || err.message)}`;
    }
}

function extractUrls(text) {
    const matches = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi);
    return matches || [];
}

function isWhitelistedLink(text, whitelist = []) {
    const urls = extractUrls(text);
    if (!urls.length) return false;
    const lowerWhitelist = whitelist.map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (!lowerWhitelist.length) return false;

    return urls.some(url => {
        const low = url.toLowerCase();
        return lowerWhitelist.some(domain => low.includes(domain));
    });
}

function detectScam(text) {
    return /(discord\.gg|bit\.ly|free nitro|free robux|robux|iplogger|tinyurl|click here|claim reward|earn money)/i.test(text);
}

function isCapsSpam(text, ratio = 0.7) {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 12) return false;
    const upper = (letters.match(/[A-Z]/g) || []).length;
    return (upper / letters.length) >= ratio;
}

function isRepeatSpam(recentMessages) {
    if (recentMessages.length < 3) return false;
    const last3 = recentMessages.slice(-3);
    return new Set(last3).size === 1;
}

function remind(user, text, ms) {
    setTimeout(() => {
        user.send(`⏰ Reminder: ${text}`).catch(() => {});
    }, ms);
}

async function createRankCard(user, level, xp, nextLevelXp) {
    const canvas = Canvas.createCanvas(900, 260);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Card
    ctx.fillStyle = '#111827';
    roundRect(ctx, 20, 20, 860, 220, 20, true);

    // Avatar
    const avatar = await Canvas.loadImage(
        user.displayAvatarURL({ extension: 'png', size: 256 })
    );

    ctx.save();
    ctx.beginPath();
    ctx.arc(120, 130, 70, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 50, 60, 140, 140);
    ctx.restore();

    // Username
    ctx.fillStyle = '#ffffff';
    ctx.font = '28px "Poppins"';
    ctx.fillText(user.username, 230, 100);

    // Level
    ctx.fillStyle = '#60a5fa';
    ctx.font = '28px Sans';
    ctx.fillText(`LEVEL ${level}`, 230, 145);

    // XP Text
    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px Sans';
    ctx.fillText(`${xp} / ${nextLevelXp} XP`, 230, 180);

    // Progress bar background
    ctx.fillStyle = '#1e293b';
    roundRect(ctx, 230, 195, 560, 24, 12, true);

    // Progress
    const progress = Math.min(xp / nextLevelXp, 1);
    ctx.fillStyle = '#2563eb';
    roundRect(ctx, 230, 195, 560 * progress, 24, 12, true);

    return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, width, height, radius, fill) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);

    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);

    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);

    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);

    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);

    ctx.closePath();

    if (fill) ctx.fill();
}

// =====================
// DASHBOARD
// =====================
function renderLogin(error = '') {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ben D Bot Dashboard</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<style>
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:40px}
.card{max-width:520px;margin:auto;background:#111827;padding:24px;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
input,button,select,textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;margin:8px 0}
button{background:#2563eb;border:none;cursor:pointer;font-weight:bold}
small{color:#94a3b8}
.err{color:#fca5a5}
</style>
</head>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<body>
<div class="card">
<h1>💀 Ben D Bot Dashboard</h1>
<p>Masukkan dashboard key untuk buka panel.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<form method="GET" action="/">
  <input name="key" type="password" placeholder="Dashboard key">
  <button type="submit">Open Dashboard</button>
</form>
<small>Railway URL + ?key=...</small>
</div>
</body>
</html>`;
}

function renderDashboard(guildId, key) {
    const g = getGuild(guildId);
    const guild = client.guilds.cache.get(guildId);
    const guilds = [...client.guilds.cache.values()];

    const guildLinks = guilds.length
        ? guilds.map(x => {
            const active = x.id === guildId ? 'font-weight:bold;color:#60a5fa;' : 'color:#cbd5e1;';
            return `<li style="margin:6px 0;"><a style="${active}" href="/?key=${encodeURIComponent(key)}&guild=${encodeURIComponent(x.id)}">${escapeHtml(x.name)} (${x.id})</a></li>`;
        }).join('')
        : '<li>Bot belum masuk server.</li>';

    const wl = Array.isArray(g.automod.linkWhitelist) ? g.automod.linkWhitelist.join(', ') : '';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ben D Bot Dashboard</title>
<style>
.statsGrid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:12px;
}

.statCard{
  background:#0b1220;
  border:1px solid #243244;
  border-radius:14px;
  padding:14px;
}

.statTop{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:8px;
}

.statLabel{
  color:#cbd5e1;
  font-weight:700;
}

.statValue{
  font-size:1.1rem;
  font-weight:800;
}

.miniBarWrap{
  width:100%;
  height:10px;
  background:#1f2937;
  border-radius:999px;
  overflow:hidden;
}

.miniBar{
  height:100%;
  width:0%;
  border-radius:999px;
  transition:width .6s ease;
  animation:pulse 1.6s ease-in-out infinite;
}

.miniBar.blue{background:#3b82f6;}
.miniBar.green{background:#10b981;}
.miniBar.purple{background:#8b5cf6;}
.miniBar.orange{background:#f59e0b;}
.miniBar.pink{background:#ec4899;}

@keyframes pulse{
  0%,100%{opacity:.75}
  50%{opacity:1}
}

@media(max-width:900px){
  .statsGrid{grid-template-columns:1fr;}
}
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0}
.wrap{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
h1,h2,h3 {
  letter-spacing: 0.5px;
}

button:hover {
  background:#1d4ed8;
}

.card:hover {
  transform: translateY(-2px);
  transition: 0.2s;
}
.sidebar{background:#111827;padding:20px;border-right:1px solid #1f2937}
.main{padding:24px}
.card{background:#111827;padding:20px;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.35);margin-bottom:18px}
input,button,select,textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;margin:8px 0}
button{background:#2563eb;border:none;cursor:pointer;font-weight:bold}
label{display:block;margin-top:10px}
small{color:#94a3b8}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#1f2937;margin-right:6px}
a{color:#93c5fd;text-decoration:none}
hr{border:none;border-top:1px solid #243244;margin:18px 0}
.chart{
  display:flex;
  align-items:flex-end;
  gap:20px;
  height:240px;
  padding:20px 10px;
}

.barBox{
  flex:1;
  text-align:center;
}

.bar{
  width:100%;
  border-radius:14px 14px 0 0;
  transition:.35s;
}

.bar:hover{
  filter:brightness(1.2);
}

.bar1{
  background:#3b82f6;
  box-shadow:0 0 20px rgba(59,130,246,.45);
}

.bar2{
  background:#10b981;
  box-shadow:0 0 20px rgba(16,185,129,.45);
}

.bar3{
  background:#f59e0b;
  box-shadow:0 0 20px rgba(245,158,11,.45);
}
@media(max-width:900px){.wrap{grid-template-columns:1fr}.sidebar{border-right:none;border-bottom:1px solid #1f2937}}
</style>
</head>
<body>
<div class="wrap">
  <div class="sidebar">
    <h2>💀 Ben D Bot</h2>
    <p><span class="badge">Railway</span><span class="badge">Free</span></p>
    <p><small>Selected Guild</small><br>${guild ? escapeHtml(guild.name) : 'None'}</p>
    <hr>
    <h3>Servers</h3>
    <ul style="padding-left:18px;">${guildLinks}</ul>
  </div>

  <div class="main">
   <div class="card">
     <h2>👑 Owner Panel</h2>
     <p><b>Status:</b> ${client.user ? '🟢 ONLINE' : '🔴 OFFLINE'}</p>
     <p><b>Bot:</b> ${client.user?.tag || 'Unknown'}</p>
     <p><b>Servers:</b> ${client.guilds.cache.size}</p>
   </div>


<div class="card">
  <h2>📊 Ben D Bot Statistics</h2>

  <div class="statsGrid">
    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">Servers</span>
        <span class="statValue" id="st-servers">${client.guilds.cache.size}</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar blue" id="bar-servers"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">Members</span>
        <span class="statValue" id="st-members">${guild?.memberCount || 0}</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar green" id="bar-members"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">Commands</span>
        <span class="statValue" id="st-commands">${buildCommands().length}</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar purple" id="bar-commands"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">Uptime</span>
        <span class="statValue" id="st-uptime">${Math.floor(process.uptime() / 60)} min</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar orange" id="bar-uptime"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">RAM Usage</span>
        <span class="statValue" id="st-ram">-</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar pink" id="bar-ram"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">CPU Usage</span>
        <span class="statValue" id="st-cpu">-</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar blue" id="bar-cpu"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">Ping</span>
        <span class="statValue" id="st-ping">${client.ws.ping} ms</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar green" id="bar-ping"></div></div>
    </div>

    <div class="statCard">
      <div class="statTop">
        <span class="statLabel">DB Size</span>
        <span class="statValue" id="st-db">-</span>
      </div>
      <div class="miniBarWrap"><div class="miniBar purple" id="bar-db"></div></div>
    </div>
  </div>

  <hr>
</div>

    <div class="card">
      <h2>Settings</h2>
      <form method="POST" action="/save">
        <input type="hidden" name="key" value="${escapeHtml(key)}">
        <input type="hidden" name="guildId" value="${escapeHtml(guildId)}">

        <div class="grid">
          <div>
            <label>Prefix</label>
            <input name="prefix" value="${escapeHtml(g.prefix)}" placeholder="?">
          </div>
          <div>
            <label>Personality</label>
            <select name="personality">
              <option value="chill" ${g.personality === 'chill' ? 'selected' : ''}>Chill</option>
              <option value="formal" ${g.personality === 'formal' ? 'selected' : ''}>Formal</option>
              <option value="friendly" ${g.personality === 'friendly' ? 'selected' : ''}>Friendly</option>
              <option value="funny" ${g.personality === 'funny' ? 'selected' : ''}>Funny</option>
            </select>
          </div>
        </div>

        <div class="grid">
          <div>
            <label>Log Channel ID</label>
            <input name="logChannel" value="${escapeHtml(g.logChannel || '')}" placeholder="channel id">
          </div>
          <div>
            <label>Welcome Channel ID</label>
            <input name="welcomeChannel" value="${escapeHtml(g.welcomeChannel || '')}" placeholder="channel id">
          </div>
        </div>

        <h3>Auto Mod</h3>
        <div class="checks">
          <label><input type="checkbox" name="automodEnabled" ${g.automod.enabled ? 'checked' : ''}> Automod Enabled</label>
          <label><input type="checkbox" name="antiSpam" ${g.automod.antiSpam ? 'checked' : ''}> Anti Spam</label>
          <label><input type="checkbox" name="antiLink" ${g.automod.antiLink ? 'checked' : ''}> Anti Link</label>
          <label><input type="checkbox" name="antiCaps" ${g.automod.antiCaps ? 'checked' : ''}> Anti Caps</label>
          <label><input type="checkbox" name="antiMentionSpam" ${g.automod.antiMentionSpam ? 'checked' : ''}> Anti Mention Spam</label>
          <label><input type="checkbox" name="antiRepeatSpam" ${g.automod.antiRepeatSpam ? 'checked' : ''}> Anti Repeat Spam</label>
        </div>

        <div class="grid">
          <div>
            <label>Warn Threshold</label>
            <input type="number" name="warnThreshold" value="${escapeHtml(g.automod.warnThreshold)}">
          </div>
          <div>
            <label>Kick Threshold</label>
            <input type="number" name="kickThreshold" value="${escapeHtml(g.automod.kickThreshold)}">
          </div>
        </div>

        <div class="grid">
          <div>
            <label>Timeout (ms)</label>
            <input type="number" name="muteMs" value="${escapeHtml(g.automod.muteMs)}">
          </div>
          <div>
            <label>Mention Max</label>
            <input type="number" name="mentionMax" value="${escapeHtml(g.automod.mentionMax)}">
          </div>
        </div>

        <div class="grid">
          <div>
            <label>Caps Ratio</label>
            <input type="number" step="0.05" name="capsRatio" value="${escapeHtml(g.automod.capsRatio)}">
          </div>
          <div>
            <label>Whitelisted Domains</label>
            <input name="linkWhitelist" value="${escapeHtml(wl)}" placeholder="youtube.com, discord.com">
          </div>
        </div>

        <h3>Anti Raid</h3>
        <div class="checks">
          <label><input type="checkbox" name="raidEnabled" ${g.raid.enabled ? 'checked' : ''}> Raid Enabled</label>
        </div>

        <div class="grid">
          <div>
            <label>Raid Threshold</label>
            <input type="number" name="raidThreshold" value="${escapeHtml(g.raid.threshold)}">
          </div>
          <div>
            <label>Raid Window (detik)</label>
            <input type="number" name="raidWindowSec" value="${Math.round(g.raid.windowMs / 1000)}">
          </div>
        </div>

        <div class="grid">
          <div>
            <label>Raid Lock (detik)</label>
            <input type="number" name="raidLockSec" value="${Math.round(g.raid.lockMs / 1000)}">
          </div>
          <div>
            <label>New Account Age (jam)</label>
            <input type="number" name="newAccountAgeHours" value="${Math.round(g.raid.newAccountAgeMs / 3600000)}">
          </div>
        </div>

        <button type="submit">Save</button>
      </form>
    </div>

    <div class="card">
      <h3>Current Info</h3>
      <p><b>Prefix:</b> ${escapeHtml(g.prefix)}</p>
      <p><b>Persona:</b> ${escapeHtml(g.personality)}</p>
      <p><b>Log:</b> ${escapeHtml(g.logChannel || '-')}</p>
      <p><b>Welcome:</b> ${escapeHtml(g.welcomeChannel || '-')}</p>
      <p><b>Automod:</b> ${g.automod.enabled ? 'ON' : 'OFF'}</p>
      <p><b>Raid:</b> ${g.raid.enabled ? 'ON' : 'OFF'}</p>
      <p><small>Ben D Bot dashboard. Ubah config lalu save.</small></p>
    </div>
  </div>
</div>
<script>
async function updateStats() {
  try {
    const res = await fetch('/api/stats?guild=${encodeURIComponent(guildId)}');
    const data = await res.json();

    const memMB = (data.memory.heapUsed / 1024 / 1024).toFixed(1);
    const memTotalMB = (data.memory.heapTotal / 1024 / 1024).toFixed(1);
    const dbKB = (data.dbSize / 1024).toFixed(1);

    document.getElementById('st-servers').textContent = data.servers;
    document.getElementById('st-members').textContent = data.members;
    document.getElementById('st-commands').textContent = data.commands;
    document.getElementById('st-uptime').textContent = Math.floor(data.uptimeSec / 60) + ' min';
    document.getElementById('st-ram').textContent = memMB + ' MB / ' + memTotalMB + ' MB';
    document.getElementById('st-cpu').textContent = data.cpuPercent + '%';
    document.getElementById('st-ping').textContent = data.ping + ' ms';
    document.getElementById('st-db').textContent = dbKB + ' KB';

    document.getElementById('bar-servers').style.width = Math.min(data.servers * 10, 100) + '%';
    document.getElementById('bar-members').style.width = Math.min(data.members / 2, 100) + '%';
    document.getElementById('bar-commands').style.width = Math.min(data.commands * 8, 100) + '%';
    document.getElementById('bar-uptime').style.width = Math.min((data.uptimeSec / 60) * 2, 100) + '%';
    document.getElementById('bar-ram').style.width = Math.min((data.memory.heapUsed / data.memory.heapTotal) * 100, 100) + '%';
    document.getElementById('bar-cpu').style.width = Math.min(data.cpuPercent, 100) + '%';
    document.getElementById('bar-ping').style.width = Math.min(data.ping, 100) + '%';
    document.getElementById('bar-db').style.width = Math.min(data.dbSize / 2000, 100) + '%';
  } catch (e) {}
}

updateStats();
setInterval(updateStats, 5000);
</script>
</body>
</html>`;
}

app.get('/health', (_req, res) => res.send('ok'));

app.get('/api/stats', (req, res) => {
    const guildId = req.query.guild || client.guilds.cache.first()?.id;
    const guild = guildId ? client.guilds.cache.get(guildId) : null;

    const mem = process.memoryUsage();
    const dbSize = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;

    const nowCpu = process.cpuUsage();
    const nowTime = process.hrtime.bigint();

    if (!global.__cpuState) {
        global.__cpuState = {
            cpu: nowCpu,
            time: nowTime
        };
    }

    const elapsedMicros = Number(nowTime - global.__cpuState.time) / 1000;
    const cpuMicros =
        (nowCpu.user - global.__cpuState.cpu.user) +
        (nowCpu.system - global.__cpuState.cpu.system);

    const cpuPercent = elapsedMicros > 0
        ? Math.max(0, Math.min(100, (cpuMicros / elapsedMicros) * 100))
        : 0;

    global.__cpuState.cpu = nowCpu;
    global.__cpuState.time = nowTime;

    res.json({
        botTag: client.user?.tag || 'Unknown',
        online: !!client.user,
        ping: client.ws.ping,
        servers: client.guilds.cache.size,
        members: guild?.memberCount || 0,
        commands: buildCommands().length,
        uptimeSec: Math.floor(process.uptime()),
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal
        },
        cpuPercent: Number(cpuPercent.toFixed(1)),
        dbSize
    });
});

app.get('/', (req, res) => {
    if (!DASHBOARD_KEY) {
        return res.status(200).send('<h1>Dashboard disabled</h1><p>Set DASHBOARD_KEY di env dulu.</p>');
    }

    const key = req.query.key || '';
    if (key !== DASHBOARD_KEY) {
        return res.send(renderLogin(key ? 'Key salah.' : ''));
    }

    const guildId = req.query.guild || client.guilds.cache.first()?.id;
    if (!guildId) {
        return res.send(renderLogin('Bot belum join server.'));
    }

    return res.send(renderDashboard(guildId, key));
});

app.post('/save', (req, res) => {
    if (!DASHBOARD_KEY || req.body.key !== DASHBOARD_KEY) {
        return res.status(403).send('Forbidden');
    }

    const guildId = req.body.guildId;
    if (!guildId) return res.status(400).send('Missing guildId');

    const g = getGuild(guildId);

    const prefix = String(req.body.prefix || '?').trim();
    if (prefix && prefix.length <= 5) g.prefix = prefix;

    g.logChannel = String(req.body.logChannel || '').trim() || null;
    g.welcomeChannel = String(req.body.welcomeChannel || '').trim() || null;
    g.personality = ['chill', 'formal', 'friendly', 'funny'].includes(String(req.body.personality || '').toLowerCase())
        ? String(req.body.personality).toLowerCase()
        : 'chill';

    g.automod.enabled = req.body.automodEnabled === 'on';
    g.automod.antiSpam = req.body.antiSpam === 'on';
    g.automod.antiLink = req.body.antiLink === 'on';
    g.automod.antiCaps = req.body.antiCaps === 'on';
    g.automod.antiMentionSpam = req.body.antiMentionSpam === 'on';
    g.automod.antiRepeatSpam = req.body.antiRepeatSpam === 'on';

    const warnThreshold = parseInt(req.body.warnThreshold, 10);
    const kickThreshold = parseInt(req.body.kickThreshold, 10);
    const muteMs = parseInt(req.body.muteMs, 10);
    const mentionMax = parseInt(req.body.mentionMax, 10);
    const capsRatio = parseFloat(req.body.capsRatio);

    if (Number.isFinite(warnThreshold) && warnThreshold > 0) g.automod.warnThreshold = warnThreshold;
    if (Number.isFinite(kickThreshold) && kickThreshold > 0) g.automod.kickThreshold = kickThreshold;
    if (Number.isFinite(muteMs) && muteMs > 0) g.automod.muteMs = muteMs;
    if (Number.isFinite(mentionMax) && mentionMax > 0) g.automod.mentionMax = mentionMax;
    if (Number.isFinite(capsRatio) && capsRatio > 0) g.automod.capsRatio = capsRatio;

    const whitelist = String(req.body.linkWhitelist || '')
        .split(/,|\n/)
        .map(s => s.trim())
        .filter(Boolean);
    g.automod.linkWhitelist = whitelist;

    g.raid.enabled = req.body.raidEnabled === 'on';

    const raidThreshold = parseInt(req.body.raidThreshold, 10);
    const raidWindowSec = parseInt(req.body.raidWindowSec, 10);
    const raidLockSec = parseInt(req.body.raidLockSec, 10);
    const newAccountAgeHours = parseInt(req.body.newAccountAgeHours, 10);

    if (Number.isFinite(raidThreshold) && raidThreshold > 0) g.raid.threshold = raidThreshold;
    if (Number.isFinite(raidWindowSec) && raidWindowSec > 0) g.raid.windowMs = raidWindowSec * 1000;
    if (Number.isFinite(raidLockSec) && raidLockSec > 0) g.raid.lockMs = raidLockSec * 1000;
    if (Number.isFinite(newAccountAgeHours) && newAccountAgeHours > 0) g.raid.newAccountAgeMs = newAccountAgeHours * 3600000;

    saveDB();
    return res.redirect(`/?key=${encodeURIComponent(DASHBOARD_KEY)}&guild=${encodeURIComponent(guildId)}`);
});

app.listen(PORT, () => {
    console.log(`🌐 Dashboard running on port ${PORT}`);
});

// =====================
// SLASH COMMANDS
// =====================
function buildCommands() {
    return [
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Lihat semua command'),

        new SlashCommandBuilder()
            .setName('ai')
            .setDescription('Chat AI')
            .addStringOption(o =>
                o.setName('text')
                    .setDescription('Tulis pesan yang mau dijawab AI')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Cek XP dan level'),

        new SlashCommandBuilder()
            .setName('money')
            .setDescription('Cek money'),

        new SlashCommandBuilder()
            .setName('daily')
            .setDescription('Claim daily coin'),

        new SlashCommandBuilder()
            .setName('remind')
            .setDescription('Bikin reminder')
            .addIntegerOption(o =>
                o.setName('time')
                    .setDescription('Waktu dalam detik')
                    .setRequired(true)
            )
            .addStringOption(o =>
                o.setName('text')
                    .setDescription('Isi reminder')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Warn user')
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('Lihat warning user')
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban user')
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Kick user')
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('delete')
            .setDescription('Hapus pesan')
            .addIntegerOption(o =>
                o.setName('amount')
                    .setDescription('Jumlah pesan')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('setprefix')
            .setDescription('Set prefix')
            .addStringOption(o =>
                o.setName('prefix')
                    .setDescription('Prefix baru')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('setlog')
            .setDescription('Set log channel')
            .addChannelOption(o =>
                o.setName('channel')
                    .setDescription('Channel log')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('setwelcome')
            .setDescription('Set welcome channel')
            .addChannelOption(o =>
                o.setName('channel')
                    .setDescription('Channel welcome')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('persona')
            .setDescription('Set AI personality')
            .addStringOption(o =>
                o.setName('style')
                    .setDescription('Style AI')
                    .setRequired(true)
                    .addChoices(
                        { name: 'chill', value: 'chill' },
                        { name: 'formal', value: 'formal' },
                        { name: 'friendly', value: 'friendly' },
                        { name: 'funny', value: 'funny' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('raid')
            .setDescription('Anti raid')
            .addStringOption(opt =>
                opt.setName('mode')
                    .setDescription('Mode anti raid')
                    .setRequired(true)
                    .addChoices(
                        { name: 'on', value: 'on' },
                        { name: 'off', value: 'off' },
                        { name: 'status', value: 'status' }
                    )
            )
            .addIntegerOption(opt =>
                opt.setName('threshold')
                    .setDescription('Jumlah join sebelum lock')
                    .setRequired(false)
            )
            .addIntegerOption(opt =>
                opt.setName('window')
                    .setDescription('Window join dalam detik')
                    .setRequired(false)
            )
            .addIntegerOption(opt =>
                opt.setName('lock')
                    .setDescription('Durasi lock dalam detik')
                    .setRequired(false)
            ),

         new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Top XP leaderboard'),

         new SlashCommandBuilder()
          .setName('gamble')
          .setDescription('Lets go Gambling!')
          .addIntegerOption(o =>
              o.setName('amount')
               .setDescription('Jumlah uang')
               .setRequired(true)
    ),

        new SlashCommandBuilder()
         .setName('afk')
         .setDescription('Afk')
         .addStringOption(o =>
             o.setName('reason')
               .setDescription('Reason afk')
               .setRequired(false)
    ),

    new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Lihat shop'),

    new SlashCommandBuilder()
       .setName('buy')
       .setDescription('Beli item')
       .addStringOption(o =>
        o.setName('item')
        .setDescription('Nama item')
        .setRequired(true)
    )
    .addIntegerOption(o =>
        o.setName('amount')
        .setDescription('Jumlah')
        .setRequired(true)
    ),

     new SlashCommandBuilder()
       .setName('inventory')
       .setDescription('Lihat inventory'),

    new SlashCommandBuilder()
       .setName('sell')
       .setDescription('Jual item')
       .addStringOption(o =>
         o.setName('item')
           .setDescription('Nama item')
           .setRequired(true)
      )
       .addIntegerOption(o =>
          o.setName('amount')
          .setDescription('Jumlah')
          .setRequired(true)
    ),
    ];
}

// =====================
// READY
// =====================
client.once('clientReady', async () => {
    console.log(`🔥 ONLINE: ${client.user.tag}`);

    if (!process.env.CLIENT_ID) {
        console.log('⚠️ CLIENT_ID belum diisi, slash sync dilewati');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: buildCommands().map(c => c.toJSON()) }
        );
        console.log('🌍 Slash synced');
    } catch (err) {
        console.log('Slash sync error:', err);
    }
});

// =====================
// AUTO MOD
// =====================
async function registerViolation(msg, reason) {
    const g = getGuild(msg.guild.id);
    const user = getUser(msg.author.id);

    user.warns += 1;
    saveDB();

    const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;
    const logText = `⚠️ AutoMod\nUser: ${msg.author.tag}\nReason: ${reason}\nWarns: ${user.warns}`;

    if (logCh) logCh.send(logText).catch(() => {});
    await msg.author.send(`⚠️ ${reason}`).catch(() => {});

    if (user.warns >= g.automod.warnThreshold && msg.member?.moderatable) {
        await msg.member.timeout(g.automod.muteMs).catch(() => {});
    }

    if (user.warns >= g.automod.kickThreshold && msg.member?.kickable) {
        await msg.member.kick().catch(() => {});
    }
}

function shouldAutomodRun(msg, prefix) {
    const content = msg.content.trim();
    if (!content) return false;
    if (content.startsWith(prefix)) return false;
    return true;
}

function getJoinTrackerList(guildId) {
    if (!joinTracker.has(guildId)) joinTracker.set(guildId, []);
    return joinTracker.get(guildId);
}

const joinTracker = new Map();

client.on('guildMemberAdd', async member => {
    const g = getGuild(member.guild.id);
    const now = Date.now();
    const joins = getJoinTrackerList(member.guild.id);

    joins.push(now);
    while (joins.length && now - joins[0] > g.raid.windowMs) {
        joins.shift();
    }

    const logCh = g.logChannel ? member.guild.channels.cache.get(g.logChannel) : null;

    if (g.raid.enabled && joins.length >= g.raid.threshold) {
        g.raidLockUntil = now + g.raid.lockMs;
        saveDB();

        if (logCh) {
            logCh.send(`🛡️ RAID DETECTED (${joins.length})`).catch(() => {});
        }
    }

    if (g.raid.enabled && g.raidLockUntil && now < g.raidLockUntil) {
        const age = now - member.user.createdAt.getTime();

        if (age < g.raid.newAccountAgeMs && member.kickable) {
            await member.kick().catch(() => {});
            if (logCh) logCh.send(`🚨 kicked ${member.user.tag}`).catch(() => {});
            return;
        }
    }

    if (g.welcomeChannel) {
        const ch = member.guild.channels.cache.get(g.welcomeChannel);
        ch?.send(`👋 Welcome ${member.user}`).catch(() => {});
    }
});

client.on('guildMemberRemove', member => {
    const g = getGuild(member.guild.id);
    if (!g.welcomeChannel) return;

    const ch = member.guild.channels.cache.get(g.welcomeChannel);
    ch?.send(`😢 ${member.user.tag} left`).catch(() => {});
});

client.on('messageDelete', msg => {
    if (!msg.guild) return;
    const g = getGuild(msg.guild.id);
    if (!g.logChannel) return;

    const ch = msg.guild.channels.cache.get(g.logChannel);
    ch?.send(`🗑️ Deleted by ${msg.author?.tag ?? 'Unknown'}: ${msg.content ?? '[no content]'}`).catch(() => {});
});

// =====================
// SLASH HANDLER
// =====================
client.on('interactionCreate', async i => {
    if (!i.guildId) return;
    if (!i.isChatInputCommand()) return;

    const g = getGuild(i.guildId);

    if (i.commandName === 'help') {
        return i.reply(
            [
                '💀 **Ben Bot**',
                '',
                '**AI**',
                '/ai',
                '',
                '**System**',
                '/rank',
                '/money',
                '/daily',
                '/remind',
                '/leaderboard',
                '/gamble',
                '/afk',
                '/shop',
                '/buy',
                '/inventory',
                '/sell',
                '',
                '**Moderation**',
                '/warn',
                '/warnings',
                '/ban',
                '/kick',
                '/delete',
                '',
                '**Setup**',
                '/setprefix',
                '/setlog',
                '/setwelcome',
                '/persona',
                '/raid'
            ].join('\n')
        );
    }

     if (i.commandName === 'shop') {

      const text = Object.entries(SHOP_ITEMS)
          .map(([id, item]) =>
            `  ${item.name}\n💰 Buy: ${item.price} | Sell: ${item.sell}\nID: \`${id}\``
          )
          .join('\n\n');

      return i.reply(`🛒 SHOP\n\n${text}`);
   }

     if (i.commandName === 'buy') {

    const user = getUser(i.user.id);

    const itemId = i.options.getString('item').toLowerCase();
    const amount = i.options.getInteger('amount');

    const item = SHOP_ITEMS[itemId];

    if (!item) {
        return i.reply('❌ Item tidak ditemukan');
    }

    if (amount <= 0) {
        return i.reply('❌ Jumlah harus lebih dari 0');
    }

    const total = item.price * amount;

    if (user.money < total) {
        return i.reply(`❌ Money tidak cukup\nButuh: ${total}`);
    }

    user.money -= total;

    user.inventory[itemId] ??= 0;
    user.inventory[itemId] += amount;

    saveDB();

    return i.reply(
        `🛒 Berhasil beli ${amount}x ${item.name}\n💰 -${total}`
    );
}

     if (i.commandName === 'inventory') {

    const user = getUser(i.user.id);

    const items = Object.entries(user.inventory);

    if (!items.length) {
        return i.reply('🎒 Inventory kosong');
    }

    const text = items
        .map(([id, amount]) => {
            const item = SHOP_ITEMS[id];
            return `${item?.name || id} x${amount}`;
        })
        .join('\n');

    return i.reply(`🎒 INVENTORY\n\n${text}`);
}

    if (i.commandName === 'sell') {

    const user = getUser(i.user.id);

    const itemId = i.options.getString('item').toLowerCase();
    const amount = i.options.getInteger('amount');

    const item = SHOP_ITEMS[itemId];

    if (!item) {
        return i.reply('❌ Item tidak ditemukan');
    }

    if (amount <= 0) {
        return i.reply('❌ Jumlah tidak valid');
    }

    const have = user.inventory[itemId] || 0;

    if (have < amount) {
        return i.reply('❌ Item tidak cukup');
    }

    user.inventory[itemId] -= amount;

    if (user.inventory[itemId] <= 0) {
        delete user.inventory[itemId];
    }

    const earn = item.sell * amount;

    user.money += earn;

    saveDB();

    return i.reply(
        `💸 Berhasil jual ${amount}x ${item.name}\n💰 +${earn}`
    );
}

     if (i.commandName === 'ai') {
    try {
        await i.deferReply();

        const reply = await chatAIReal(
            i.user.id,
            i.options.getString('text'),
            g.personality
        );

        if (i.deferred || i.replied) {
            return await i.editReply(reply);
        }

    } catch (err) {
        console.log('AI Slash Error:', err);

        if (!i.replied && !i.deferred) {
            return i.reply({
                content: '❌ AI error',
                ephemeral: true
            }).catch(() => {});
        }

        if (i.deferred) {
            return i.editReply('❌ AI error').catch(() => {});
        }
    }
}

    if (i.commandName === 'rank') {
    const userData = getUser(i.user.id);

    const level = Math.floor(userData.xp / 100);
    const currentXp = userData.xp % 100;
    const nextLevelXp = 100;

    const buffer = await createRankCard(
        i.user,
        level,
        currentXp,
        nextLevelXp
    );

    const attachment = new AttachmentBuilder(buffer, {
        name: 'rank.png'
    });

    return i.reply({
        files: [attachment]
    });
    }

if (i.commandName === 'gamble') {

    const amount = i.options.getInteger('amount');

    const user = getUser(i.user.id);

    if (amount <= 0) {
        return i.reply({
            content: '❌ amount tidak valid',
            ephemeral: true
        });
    }

    if (user.money < amount) {
        return i.reply({
            content: '❌ uang kamu kurang',
            ephemeral: true
        });
    }

    const win = Math.random() < 0.5;

    if (win) {
        user.money += amount;
        saveDB();

        return i.reply(`🎰 MENANG +${amount} coin`);
    } else {
        user.money -= amount;
        saveDB();

        return i.reply(`💀 KALAH -${amount} coin`);
    }
}

if (i.commandName === 'afk') {
    const user = getUser(i.user.id);
    const reason = i.options.getString('reason') || 'AFK';

    user.afk = {
        reason,
        since: Date.now()
    };

    saveDB();
    return i.reply(`💤 AFK di-set: ${reason}`);
}

    if (i.commandName === 'money') {
        const user = getUser(i.user.id);
        return i.reply(`💰 Money: ${user.money}`);
    }

    if (i.commandName === 'leaderboard') {

    const users = Object.entries(db.users || {})
        .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
        .slice(0, 10);

    let text = '🏆 **TOP XP LEADERBOARD** 🏆\n\n';

    for (let index = 0; index < users.length; index++) {

        const [id, data] = users[index];

        let memberName = `Unknown User`;

        try {
            const member = await i.guild.members.fetch(id);
            memberName = member.user.tag;
        } catch {}

        text += `#${index + 1} • ${memberName}\n`;
        text += `XP: ${data.xp || 0}\n\n`;
    }

    return i.reply(text);
}

    if (i.commandName === 'daily') {
        const user = getUser(i.user.id);
        const now = Date.now();
        const cooldown = 86400000;

        if (now - user.lastDaily < cooldown) {
            const left = cooldown - (now - user.lastDaily);
            const hrs = Math.floor(left / 3600000);
            const mins = Math.floor((left % 3600000) / 60000);
            return i.reply(`⏳ tunggu ${hrs} jam ${mins} menit`);
        }

        user.lastDaily = now;
        user.money += 100;
        saveDB();
        return i.reply('🎁 +100 coin');
    }

    if (i.commandName === 'remind') {
        const user = i.user;
        const time = i.options.getInteger('time') * 1000;
        const text = i.options.getString('text');

        remind(user, text, time);
        return i.reply(`⏰ reminder set: ${text}`);
    }

    if (i.commandName === 'warn') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers) &&
            !i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Butuh Moderation permission.', ephemeral: true });
        }

        const member = i.options.getMember('user');
        if (!member) return i.reply({ content: '❌ User tidak ditemukan.', ephemeral: true });

        const user = getUser(member.id);
        user.warns += 1;
        saveDB();

        const logCh = g.logChannel ? i.guild.channels.cache.get(g.logChannel) : null;
        if (logCh) logCh.send(`⚠️ ${member.user.tag} di-warn oleh ${i.user.tag}. Total warns: ${user.warns}`).catch(() => {});

        return i.reply(`⚠️ ${member.user.tag} di-warn. Total: ${user.warns}`);
    }

    if (i.commandName === 'warnings') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers) &&
            !i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Butuh Moderation permission.', ephemeral: true });
        }

        const member = i.options.getMember('user');
        if (!member) return i.reply({ content: '❌ User tidak ditemukan.', ephemeral: true });

        const user = getUser(member.id);
        return i.reply(`📊 ${member.user.tag} punya ${user.warns} warning`);
    }

    if (i.commandName === 'ban') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const member = i.options.getMember('user');
        if (!member) return i.reply({ content: '❌ User tidak ditemukan.', ephemeral: true });
        if (member.id === i.user.id) return i.reply({ content: '❌ Gak bisa ban diri sendiri.', ephemeral: true });
        if (member.id === i.guild.ownerId) return i.reply({ content: '❌ Gak bisa ban owner.', ephemeral: true });
        if (member.roles.highest.position >= i.member.roles.highest.position) {
            return i.reply({ content: '❌ Role dia lebih tinggi atau sama.', ephemeral: true });
        }
        if (!member.bannable) return i.reply({ content: '❌ Aku gak punya izin buat ban dia.', ephemeral: true });

        await member.ban().catch(() => {});
        const logCh = g.logChannel ? i.guild.channels.cache.get(g.logChannel) : null;
        if (logCh) logCh.send(`🔨 ${member.user.tag} di-ban oleh ${i.user.tag}`).catch(() => {});
        return i.reply(`🔨 ${member.user.tag} di-ban.`);
    }

    if (i.commandName === 'kick') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const member = i.options.getMember('user');
        if (!member) return i.reply({ content: '❌ User tidak ditemukan.', ephemeral: true });
        if (member.id === i.user.id) return i.reply({ content: '❌ Gak bisa kick diri sendiri.', ephemeral: true });
        if (member.id === i.guild.ownerId) return i.reply({ content: '❌ Gak bisa kick owner.', ephemeral: true });
        if (member.roles.highest.position >= i.member.roles.highest.position) {
            return i.reply({ content: '❌ Role dia lebih tinggi atau sama.', ephemeral: true });
        }
        if (!member.kickable) return i.reply({ content: '❌ Aku gak punya izin buat kick dia.', ephemeral: true });

        await member.kick().catch(() => {});
        const logCh = g.logChannel ? i.guild.channels.cache.get(g.logChannel) : null;
        if (logCh) logCh.send(`👢 ${member.user.tag} di-kick oleh ${i.user.tag}`).catch(() => {});
        return i.reply(`👢 ${member.user.tag} di-kick.`);
    }

    if (i.commandName === 'delete') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
            return i.reply({ content: '❌ Butuh Manage Messages.', ephemeral: true });
        }

        const amount = i.options.getInteger('amount');
        if (!Number.isInteger(amount) || amount <= 0) {
            return i.reply({ content: '❌ Jumlah pesan tidak valid.', ephemeral: true });
        }

        if (amount > 100) {
            return i.reply({ content: '❌ Maksimal 100 pesan sekali hapus.', ephemeral: true });
        }

        await i.deferReply({ ephemeral: true });
        const deleted = await i.channel.bulkDelete(amount, true).catch(() => null);

        const logCh = g.logChannel ? i.guild.channels.cache.get(g.logChannel) : null;
        if (logCh) logCh.send(`🗑️ ${amount} pesan dihapus oleh ${i.user.tag}`).catch(() => {});

        return i.editReply(deleted ? `🧹 ${deleted.size} pesan dihapus` : '🧹 Pesan dihapus');
    }

    if (i.commandName === 'setprefix') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const newPrefix = i.options.getString('prefix');
        if (!newPrefix || newPrefix.length > 5) {
            return i.reply({ content: '❌ Prefix harus singkat, contoh `!` atau `.`', ephemeral: true });
        }

        g.prefix = newPrefix;
        saveDB();
        return i.reply(`prefix jadi: **${g.prefix}**`);
    }

    if (i.commandName === 'setlog') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const ch = i.options.getChannel('channel');
        g.logChannel = ch.id;
        saveDB();
        return i.reply(`log set ke ${ch}`);
    }

    if (i.commandName === 'setwelcome') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const ch = i.options.getChannel('channel');
        g.welcomeChannel = ch.id;
        saveDB();
        return i.reply(`welcome set ke ${ch}`);
    }

    if (i.commandName === 'persona') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const style = i.options.getString('style');
        g.personality = style;
        saveDB();
        return i.reply(`🤖 Personality jadi **${style}**`);
    }

    if (i.commandName === 'raid') {
        if (!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return i.reply({ content: '❌ Admin only.', ephemeral: true });
        }

        const mode = i.options.getString('mode');

        if (mode === 'on') {
            g.raid.enabled = true;
            const threshold = i.options.getInteger('threshold');
            const windowSec = i.options.getInteger('window');
            const lockSec = i.options.getInteger('lock');

            if (Number.isInteger(threshold) && threshold > 0) g.raid.threshold = threshold;
            if (Number.isInteger(windowSec) && windowSec > 0) g.raid.windowMs = windowSec * 1000;
            if (Number.isInteger(lockSec) && lockSec > 0) g.raid.lockMs = lockSec * 1000;

            saveDB();

            return i.reply(
                `🛡️ anti raid ON\n` +
                `Threshold: ${g.raid.threshold}\n` +
                `Window: ${g.raid.windowMs / 1000} detik\n` +
                `Lock: ${g.raid.lockMs / 1000} detik`
            );
        }

        if (mode === 'off') {
            g.raid.enabled = false;
            g.raidLockUntil = 0;
            saveDB();
            return i.reply('🛡️ anti raid OFF');
        }

        return i.reply(
            `status: ${g.raid.enabled ? 'ON' : 'OFF'}\n` +
            `Threshold: ${g.raid.threshold}\n` +
            `Window: ${g.raid.windowMs / 1000} detik\n` +
            `Lock: ${g.raid.lockMs / 1000} detik`
        );
    }
});

// =====================
// MESSAGE HANDLER
// =====================
client.on('messageCreate', async msg => {
    try {
        if (msg.author.bot) return;

        const user = getUser(msg.author.id);
        const content = msg.content.trim();

        // AFK
        if (user.afk) {

        user.afk = null;
        saveDB();

           msg.reply('👋 Welcome back, AFK Removed!');
        }

        // MENTION AFK
        for (const member of msg.mentions.users.values()) {

    const data = getUser(member.id);

    if (data.afk) {

        const mins = Math.floor(
            (Date.now() - data.afk.since) / 60000
        );

        msg.reply(
            `💤 ${member.username} sedang AFK\n` +
            `📝 ${data.afk.reason}\n` +
            `⏰ ${mins} menit lalu`
        );
    }
}

        // DM AI
        if (!msg.guild) {
        const reply = await chatAIReal(msg.author.id, content, 'chill');
        return msg.reply(reply);
        }

        const g = getGuild(msg.guild.id);
        const prefix = g.prefix;

        // Memory
        if (user.memory.length > 8) user.memory.shift();
        
        user.recentMessages.push(content);
        if (user.recentMessages.length > 3) user.recentMessages.shift();

        // XP / MONEY
        user.xp += 5;
        user.money += 2;

        // Spam counter
        user.spam += 1;
        setTimeout(() => {
            const fresh = getUser(msg.author.id);
            fresh.spam = 0;
            saveDB();
        }, 5000);

        // Auto level message
        if (user.xp % 100 < 5) {
            msg.channel.send(`🎉 ${msg.author} level ${Math.floor(user.xp / 100)}`).catch(() => {});
        }

        saveDB();

        // Auto mod only for normal chat, not commands
        if (g.automod.enabled && shouldAutomodRun(msg, prefix)) {
            const low = content.toLowerCase();
            const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;

            if (g.automod.antiSpam && user.spam >= 3 && msg.member?.moderatable) {
                await msg.member.timeout(500000).catch(() => {});
                if (logCh) logCh.send(`🚫 Spam: ${msg.author.tag}`).catch(() => {});
                return msg.channel.send(`🚫 ${msg.author} spam`).catch(() => {});
            }

            if (detectScam(content) && !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await msg.delete().catch(() => {});
                if (msg.member?.moderatable) {
                    await msg.member.timeout(600000).catch(() => {});
                }
                await msg.author.send('⚠️ Scam detected!').catch(() => {});
                await registerViolation(msg, 'Scam / suspicious content');
                return msg.channel.send(`🚨 ${msg.author} scam`).catch(() => {});
            }

            if (g.automod.antiLink) {
                const hasLink = /https?:\/\/|www\./i.test(content);
                const allowed = isWhitelistedLink(content, g.automod.linkWhitelist);
                if (hasLink && !allowed && !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    await msg.delete().catch(() => {});
                    await registerViolation(msg, 'Link not allowed');
                    return msg.channel.send(`🚫 ${msg.author} link detected`).catch(() => {});
                }
            }

            if (g.automod.antiCaps && isCapsSpam(content, g.automod.capsRatio) && !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await registerViolation(msg, 'Caps spam');
                return msg.channel.send(`⚠️ ${msg.author} caps spam`).catch(() => {});
            }

            if (g.automod.antiMentionSpam && msg.mentions.users.size >= g.automod.mentionMax && !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await registerViolation(msg, 'Mention spam');
                return msg.channel.send(`⚠️ ${msg.author} mention spam`).catch(() => {});
            }

            if (g.automod.antiRepeatSpam && isRepeatSpam(user.recentMessages) && !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await registerViolation(msg, 'Repeat spam');
                return msg.channel.send(`⚠️ ${msg.author} repeat spam`).catch(() => {});
            }
        }

        // Mention AI
        if (msg.mentions.has(client.user)) {
         await msg.channel.sendTyping();
         const reply = await chatAIReal(msg.author.id, content, g.personality);
         return msg.reply(reply);
        }

        if (!content.startsWith(prefix)) return;

        const args = content.slice(prefix.length).trim().split(/\s+/);
        const cmd = (args.shift() || '').toLowerCase();

        // HELP
        if (cmd === 'help') {
            return msg.reply(
                [
                    `💀 **Ben Bot**`,
                    ``,
                    `**AI**`,
                    `${prefix}ai <text>`,
                    `${prefix}persona <style>`,
                    ``,
                    `**System**`,
                    `${prefix}rank`,
                    `${prefix}money`,
                    `${prefix}daily`,
                    `${prefix}remind <detik> <pesan>`,
                    `${prefix}leaderboard`,
                    `${prefix}gamble`,
                    `${prefix}afk`,
                    `${prefix}shop`,
                    `${prefix}buy`,
                    `${prefix}inventory or inv`,
                    `${prefix}sell`,
                    ``,
                    `**Moderation**`,
                    `${prefix}warn @user`,
                    `${prefix}warnings @user`,
                    `${prefix}ban @user`,
                    `${prefix}kick @user`,
                    `${prefix}delete 10`,
                    `${prefix}clear 10`,
                    ``,
                    `**Setup**`,
                    `${prefix}setprefix !`,
                    `${prefix}setlog #log`,
                    `${prefix}setwelcome #welcome`,
                    `${prefix}raid on`,
                    `${prefix}raid off`,
                    `${prefix}raid status`
                ].join('\n')
            );
        }

        if (cmd === 'shop') {

    const text = Object.entries(SHOP_ITEMS)
        .map(([id, item]) =>
            `${item.name}\n💰 Buy: ${item.price} | Sell: ${item.sell}\nID: ${id}`
        )
        .join('\n\n');

    return msg.reply(`🛒 SHOP\n\n${text}`);
}

        if (cmd === 'buy') {

    const itemId = (args[0] || '').toLowerCase();
    const amount = parseInt(args[1]) || 1;

    const item = SHOP_ITEMS[itemId];

    if (!item) {
        return msg.reply('❌ Item tidak ditemukan');
    }

    if (amount <= 0) {
        return msg.reply('❌ Jumlah tidak valid');
    }

    const total = item.price * amount;

    if (user.money < total) {
        return msg.reply(`❌ Money tidak cukup\nButuh: ${total}`);
    }

    user.money -= total;

    user.inventory[itemId] ??= 0;
    user.inventory[itemId] += amount;

    saveDB();

    return msg.reply(
        `🛒 Berhasil beli ${amount}x ${item.name}\n💰 -${total}`
    );
}

        if (cmd === 'inventory' || cmd === 'inv') {

    const items = Object.entries(user.inventory);

    if (!items.length) {
        return msg.reply('🎒 Inventory kosong');
    }

    const text = items
        .map(([id, amount]) => {
            const item = SHOP_ITEMS[id];
            return `${item?.name || id} x${amount}`;
        })
        .join('\n');

    return msg.reply(`🎒 INVENTORY\n\n${text}`);
}

        if (cmd === 'sell') {

    const itemId = (args[0] || '').toLowerCase();
    const amount = parseInt(args[1]) || 1;

    const item = SHOP_ITEMS[itemId];

    if (!item) {
        return msg.reply('❌ Item tidak ditemukan');
    }

    const have = user.inventory[itemId] || 0;

    if (have < amount) {
        return msg.reply('❌ Item tidak cukup');
    }

    user.inventory[itemId] -= amount;

    if (user.inventory[itemId] <= 0) {
        delete user.inventory[itemId];
    }

    const earn = item.sell * amount;

    user.money += earn;

    saveDB();

    return msg.reply(
        `💸 Berhasil jual ${amount}x ${item.name}\n💰 +${earn}`
    );
}

        if (cmd === 'ai') {
    try {
        const text = args.join(' ');

        if (!text) {
            return msg.reply('Tulis sesuatu dulu.');
        }

        await msg.channel.sendTyping();

        const reply = await chatAIReal(
            msg.author.id,
            text,
            g.personality
        );

        return msg.reply(reply);

    } catch (err) {
        console.log('Prefix AI Error:', err);

        return msg.reply('❌ AI error').catch(() => {});
    }
}

        if (cmd === 'leaderboard') {

          const users = Object.entries(db.users || {})
          .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
          .slice(0, 10);

          let text = '🏆 **TOP XP LEADERBOARD** 🏆\n\n';

         for (let index = 0; index < users.length; index++) {

        const [id, data] = users[index];

        let memberName = `Unknown User`;

        try {
            const member = await i.guild.members.fetch(id);
            memberName = member.user.tag;
        } catch {}

        text += `#${index + 1} • ${memberName}\n`;
        text += `XP: ${data.xp || 0}\n\n`;
    }

    return i.reply(text);
}

        if (cmd === 'personal') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const style = (args[0] || '').toLowerCase();
            if (!['chill', 'formal', 'friendly', 'funny'].includes(style)) {
                return msg.reply('Pakai: chill, formal, friendly, funny');
            }

            g.personality = style;
            saveDB();
            return msg.reply(`🤖 Personality jadi **${style}**`);
        }

        if (cmd === 'afk') {

        const reason = args.join(' ') || 'AFK';

             user.afk = {
             reason,
             since: Date.now()
          };

            saveDB();

            return msg.reply(`💤 AFK di-set: ${reason}`);
        }

        if (cmd === 'rank') {
         const level = Math.floor(user.xp / 100);
         const currentXp = user.xp % 100;
         const nextLevelXp = 100;

         const buffer = await createRankCard(
            msg.author,
            level,
            currentXp,
            nextLevelXp
       );

         const attachment = new AttachmentBuilder(buffer, {
            name: 'rank.png'
       });

         return msg.reply({
            files: [attachment]
       });
    }
        const buffer = await createRankCard(
           msg.author,
           level,
           currentXp,
           nextLevelXp
        );

        const attachment = new AttachmentBuilder(buffer, {
            name: 'rank.png'
        });

        return msg.reply({
            files: [attachment]
        });

        if (cmd === 'gamble') {

    const amount = parseInt(args[0]);

    if (!amount || amount <= 0) {
        return msg.reply(`contoh: ${prefix}gamble 100`);
    }

    if (user.money < amount) {
        return msg.reply('💀 uang lu kurang');
    }

    const win = Math.random() < 0.5;

    if (win) {
        user.money += amount;
        saveDB();

        return msg.reply(`🎉 LU MENANG +${amount} coin`);
    } else {
        user.money -= amount;
        saveDB();

        return msg.reply(`💀 kalah -${amount} coin`);
    }
}

        if (cmd === 'money') {
            return msg.reply(`💰 Money: ${user.money}`);
        }

        if (cmd === 'daily') {
            const now = Date.now();
            const cooldown = 86400000;

            if (now - user.lastDaily < cooldown) {
                const left = cooldown - (now - user.lastDaily);
                const hrs = Math.floor(left / 3600000);
                const mins = Math.floor((left % 3600000) / 60000);
                return msg.reply(`⏳ tunggu ${hrs} jam ${mins} menit`);
            }

            user.lastDaily = now;
            user.money += 100;
            saveDB();
            return msg.reply('🎁 +100 coin');
        }

        if (cmd === 'remind') {
            const time = parseInt(args[0], 10) * 1000;
            const text = args.slice(1).join(' ');

            if (!time || !text) return msg.reply(`contoh: ${prefix}remind 10 halo`);

            remind(msg.author, text, time);
            return msg.reply('⏰ reminder set');
        }

        if (cmd === 'warn') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) &&
                !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Butuh Moderation permission.');
            }

            const member = msg.mentions.members.first();
            if (!member) return msg.reply('Tag user dulu.');

            const target = getUser(member.id);
            target.warns += 1;
            saveDB();

            const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;
            if (logCh) logCh.send(`⚠️ ${member.user.tag} di-warn oleh ${msg.author.tag}. Total warns: ${target.warns}`).catch(() => {});
            return msg.reply(`⚠️ ${member.user.tag} di-warn. Total: ${target.warns}`);
        }

        if (cmd === 'warnings') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) &&
                !msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Butuh Moderation permission.');
            }

            const member = msg.mentions.members.first();
            if (!member) return msg.reply('Tag user dulu.');

            const target = getUser(member.id);
            return msg.reply(`📊 ${member.user.tag} punya ${target.warns} warning`);
        }

        if (cmd === 'ban') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const member = msg.mentions.members.first();
            if (!member) return msg.reply('Tag user dulu.');
            if (member.id === msg.author.id) return msg.reply('❌ Gak bisa ban diri sendiri.');
            if (member.id === msg.guild.ownerId) return msg.reply('❌ Gak bisa ban owner.');
            if (member.roles.highest.position >= msg.member.roles.highest.position) {
                return msg.reply('❌ Role dia lebih tinggi atau sama.');
            }
            if (!member.bannable) return msg.reply('❌ Aku gak punya izin buat ban dia.');

            await member.ban().catch(() => {});
            const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;
            if (logCh) logCh.send(`🔨 ${member.user.tag} di-ban oleh ${msg.author.tag}`).catch(() => {});
            return msg.channel.send(`🔨 ${member.user.tag} di-ban`);
        }

        if (cmd === 'kick') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const member = msg.mentions.members.first();
            if (!member) return msg.reply('Tag user dulu.');
            if (member.id === msg.author.id) return msg.reply('❌ Gak bisa kick diri sendiri.');
            if (member.id === msg.guild.ownerId) return msg.reply('❌ Gak bisa kick owner.');
            if (member.roles.highest.position >= msg.member.roles.highest.position) {
                return msg.reply('❌ Role dia lebih tinggi atau sama.');
            }
            if (!member.kickable) return msg.reply('❌ Aku gak punya izin buat kick dia.');

            await member.kick().catch(() => {});
            const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;
            if (logCh) logCh.send(`👢 ${member.user.tag} di-kick oleh ${msg.author.tag}`).catch(() => {});
            return msg.channel.send(`👢 ${member.user.tag} di-kick`);
        }

        if (cmd === 'delete' || cmd === 'clear') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return msg.reply('❌ Butuh Manage Messages.');
            }

            const amount = parseInt(args[0], 10);
            if (!Number.isInteger(amount) || amount <= 0) {
                return msg.reply(`contoh: ${prefix}delete 10`);
            }

            if (amount > 100) {
                return msg.reply('Maksimal 100 pesan sekali hapus.');
            }

            const deleted = await msg.channel.bulkDelete(amount, true).catch(() => null);
            const logCh = g.logChannel ? msg.guild.channels.cache.get(g.logChannel) : null;
            if (logCh) logCh.send(`🗑️ ${amount} pesan dihapus oleh ${msg.author.tag}`).catch(() => {});
            return msg.channel.send(`🧹 ${deleted ? deleted.size : amount} pesan dihapus`).catch(() => {});
        }

        if (cmd === 'setprefix') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const newPrefix = args[0];
            if (!newPrefix || newPrefix.length > 5) {
                return msg.reply('❌ Prefix harus singkat, contoh `!` atau `.`');
            }

            g.prefix = newPrefix;
            saveDB();
            return msg.reply(`prefix jadi: **${g.prefix}**`);
        }

        if (cmd === 'setlog') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const ch = msg.mentions.channels.first();
            if (!ch) return msg.reply(`contoh: ${prefix}setlog #log`);

            g.logChannel = ch.id;
            saveDB();
            return msg.reply(`log channel set ke ${ch}`);
        }

        if (cmd === 'setwelcome') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const ch = msg.mentions.channels.first();
            if (!ch) return msg.reply(`contoh: ${prefix}setwelcome #welcome`);

            g.welcomeChannel = ch.id;
            saveDB();
            return msg.reply(`welcome channel set ke ${ch}`);
        }

        if (cmd === 'raid') {
            if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return msg.reply('❌ Admin only.');
            }

            const sub = (args[0] || '').toLowerCase();

            if (sub === 'on') {
                g.raid.enabled = true;
                const threshold = parseInt(args[1], 10);
                const windowSec = parseInt(args[2], 10);
                const lockSec = parseInt(args[3], 10);

                if (Number.isInteger(threshold) && threshold > 0) g.raid.threshold = threshold;
                if (Number.isInteger(windowSec) && windowSec > 0) g.raid.windowMs = windowSec * 1000;
                if (Number.isInteger(lockSec) && lockSec > 0) g.raid.lockMs = lockSec * 1000;

                saveDB();
                return msg.reply(
                    `🛡️ anti raid ON\n` +
                    `Threshold: ${g.raid.threshold}\n` +
                    `Window: ${g.raid.windowMs / 1000} detik\n` +
                    `Lock: ${g.raid.lockMs / 1000} detik`
                );
            }

            if (sub === 'off') {
                g.raid.enabled = false;
                g.raidLockUntil = 0;
                saveDB();
                return msg.reply('🛡️ anti raid OFF');
            }

            if (sub === 'status') {
                return msg.reply(
                    `status: ${g.raid.enabled ? 'ON' : 'OFF'}\n` +
                    `Threshold: ${g.raid.threshold}\n` +
                    `Window: ${g.raid.windowMs / 1000} detik\n` +
                    `Lock: ${g.raid.lockMs / 1000} detik`
                );
            }

            return msg.reply(`pakai: ${prefix}raid on | off | status`);
        }

    } catch (err) {
        console.log('ERR:', err);
    }
});

client.login(process.env.TOKEN);