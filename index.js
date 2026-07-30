require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
const keepAlive = require('./keep_alive');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// เก็บระบบคิวเพลงแยกตามแต่ละเซิร์ฟเวอร์
const queue = new Map();

// ลงทะเบียนคำสั่ง Slash Commands
const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('เล่นเพลงจาก YouTube')
        .addStringOption(option => 
            option.setName('url')
                  .setDescription('ลิงก์ YouTube หรือชื่อเพลง')
                  .setRequired(true)),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('ข้ามเพลงปัจจุบัน'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('หยุดเล่นและให้บอทออกจากห้องเสียง')
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const serverQueue = queue.get(interaction.guildId);

    if (commandName === 'play') {
        const searchString = interaction.options.getString('url');
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ คุณต้องเข้าห้องเสียง (Voice Channel) ก่อนใช้คำสั่งนี้!', ephemeral: true });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ content: '❌ ฉันไม่มีสิทธิ์เข้าหรือพูดในห้องเสียงนั้น!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            let songInfo;
            // ตรวจสอบว่าเป็นลิงก์ YouTube หรือข้อความค้นหา
            if (play.yt_validate(searchString) === 'video') {
                const info = await play.video_basic_info(searchString);
                songInfo = { title: info.video_details.title, url: info.video_details.url };
            } else {
                const searchResult = await play.search(searchString, { limit: 1 });
                if (!searchResult.length) return interaction.editReply('❌ ไม่พบเพลงที่คุณค้นหา');
                songInfo = { title: searchResult[0].title, url: searchResult[0].url };
            }

            if (!serverQueue) {
                const queueConstruct = {
                    textChannel: interaction.channel,
                    voiceChannel: voiceChannel,
                    connection: null,
                    songs: [],
                    player: createAudioPlayer(),
                    playing: true
                };

                queue.set(interaction.guildId, queueConstruct);
                queueConstruct.songs.push(songInfo);

                try {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: interaction.guild.id,
                        adapterCreator: interaction.guild.voiceAdapterCreator,
                    });
                    queueConstruct.connection = connection;
                    playSong(interaction.guildId, queueConstruct.songs[0]);
                    await interaction.editReply(`🎶 กำลังเล่น: **${songInfo.title}**`);
                } catch (err) {
                    console.error(err);
                    queue.delete(interaction.guildId);
                    return interaction.editReply('❌ เกิดข้อผิดพลาดในการเชื่อมต่อห้องเสียง');
                }
            } else {
                serverQueue.songs.push(songInfo);
                return interaction.editReply(`✅ เพิ่มลงคิวแล้ว: **${songInfo.title}**`);
            }
        } catch (error) {
            console.error(error);
            return interaction.editReply('❌ เกิดข้อผิดพลาดในการประมวลผลเพลงนี้');
        }
    } 
    else if (commandName === 'skip') {
        if (!serverQueue) return interaction.reply('❌ ไม่มีเพลงกำลังเล่นอยู่');
        serverQueue.player.stop();
        return interaction.reply('⏭️ ข้ามเพลงเรียบร้อยแล้ว');
    } 
    else if (commandName === 'stop') {
        if (!serverQueue) return interaction.reply('❌ ไม่มีเพลงกำลังเล่นอยู่');
        serverQueue.songs = [];
        serverQueue.player.stop();
        const connection = getVoiceConnection(interaction.guildId);
        if (connection) connection.destroy();
        queue.delete(interaction.guildId);
        return interaction.reply('⏹️ หยุดเพลงและออกจากห้องเสียงแล้ว');
    }
});

async function playSong(guildId, song) {
    const serverQueue = queue.get(guildId);
    if (!song) {
        const connection = getVoiceConnection(guildId);
        if (connection) connection.destroy();
        queue.delete(guildId);
        return;
    }

    try {
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        
        serverQueue.player.play(resource);
        serverQueue.connection.subscribe(serverQueue.player);

        serverQueue.player.once(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });
    } catch (error) {
        console.error(error);
        serverQueue.songs.shift();
        playSong(guildId, serverQueue.songs[0]);
    }
}

// เปิดเซิร์ฟเวอร์รันไว้สำหรับ Render
keepAlive();
client.login(process.env.DISCORD_TOKEN);