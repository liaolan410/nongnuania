const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const express = require('express');
require('dotenv').config();

// เปิดเซิร์ฟเวอร์ไว้สำหรับเลี้ยงบอทบน Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Keep-alive server is ready on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ตั้งค่า DisTube สำหรับเล่นเพลงจาก YouTube
client.distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnFinish: true,
    plugins: [new YtDlpPlugin()]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // ลงทะเบียนคำสั่ง Slash Commands อัตโนมัติ
    const commands = [
        {
            name: 'play',
            description: 'เล่นเพลงจาก YouTube',
            options: [
                {
                    name: 'query',
                    type: 3, // STRING type
                    description: 'ชื่อเพลง หรือ ลิงก์ YouTube',
                    required: true
                }
            ]
        },
        {
            name: 'stop',
            description: 'หยุดเพลงและให้บอทออกจากห้อง'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error(error);
    }
});

// ระบบจัดการคำสั่ง
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'play') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: 'คุณต้องเข้าห้องเสียงก่อนใช้งานคำสั่งนี้!', ephemeral: true });

        const query = interaction.options.getString('query');
        await interaction.deferReply();

        try {
            await client.distube.play(voiceChannel, query, {
                textChannel: interaction.channel,
                member: interaction.member,
                interaction: interaction
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`เกิดข้อผิดพลาด: ${error.message}`);
        }
    }

    if (commandName === 'stop') {
        const queue = client.distube.getQueue(interaction.guildId);
        if (!queue) return interaction.reply({ content: 'ไม่มีเพลงกำลังเล่นอยู่!', ephemeral: true });

        queue.stop();
        await interaction.reply('หยุดเพลงและออกจากห้องเสียงเรียบร้อยครับ!');
    }
});

client.distube
    .on('playSong', (queue, song) => 
        queue.textChannel.send(`กำลังเล่น: **${song.name}** - `)
    )
    .on('addSong', (queue, song) => 
        queue.textChannel.send(`เพิ่มลงคิว: **${song.name}** - `)
    )
    .on('error', (channel, error) => {
        console.error(error);
        if (channel) channel.send(`เกิดข้อผิดพลาดขึ้น: ${error.slice(0, 100)}`);
    });

client.login(process.env.TOKEN);
