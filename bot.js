require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const LOG_CHANNEL = "security-log";

// AI SCORING SYSTEM
function analyzeMessage(content) {
    let score = 0;

    const patterns = [
        { word: "free nitro", score: 3 },
        { word: "verify", score: 2 },
        { word: "claim", score: 2 },
        { word: "gift", score: 2 },
        { word: "login", score: 2 },
        { word: "discord", score: 1 }
    ];

    patterns.forEach(p => {
        if (content.includes(p.word)) score += p.score;
    });

    if (content.includes("http")) score += 2;
    if (content.includes(".ru") || content.includes(".xyz")) score += 3;
    if (content.includes("@everyone")) score += 3;

    return score;
}

// READY
client.once('clientReady', () => {
    console.log(`🤖 AI BOT AKTIF: ${client.user.tag}`);
});

// DETECT
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();
    const score = analyzeMessage(content);

    if (score >= 5) {
        try {
            await message.delete();

            await message.channel.send(`⚠️ ${message.author}, AI mendeteksi scam!`);

            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await message.member.timeout(5 * 60 * 1000);
            }

            const logChannel = message.guild.channels.cache.find(c => c.name === LOG_CHANNEL);

            if (logChannel) {
                logChannel.send(`🚨 AI DETECTED SCAM
User: ${message.author.tag}
Score: ${score}
Msg: ${message.content}`);
            }

        } catch (err) {
            console.log(err);
        }
    }
});

client.login(process.env.TOKEN);