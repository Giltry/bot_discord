const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    NoSubscriberBehavior 
} = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const prefix = '!';
const connections = new Map();

client.on('ready', () => {
    console.log(`✅ Bot listo como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'play') {
        if (!args[0]) return message.reply('❌ Debes proporcionar un enlace de YouTube.');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ Debes estar en un canal de voz.');

        let connection = connections.get(voiceChannel.guild.id);

        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            connections.set(voiceChannel.guild.id, connection);
        }

        try {
            console.log(`🎵 Buscando: ${args[0]}`);

            // Obtener información del video para verificar la URL
            const videoInfo = await play.video_basic_info(args[0]);
            const stream = await play.stream(videoInfo.video_details.url, { quality: 2 });

            if (!stream || !stream.stream) {
                console.error('❌ Error: No se pudo obtener el stream.');
                return message.reply('❌ Hubo un error al obtener el audio.');
            }

            console.log('🔊 Stream obtenido, preparando reproducción...');

            const resource = createAudioResource(stream.stream, { inputType: stream.type });
            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });

            player.play(resource);
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Playing, () => {
                console.log('✅ Reproduciendo música...');
                message.reply('🎶 Reproduciendo tu canción.');
            });

            player.on(AudioPlayerStatus.Idle, () => {
                console.log('⏹️ La canción terminó.');
                if (connections.has(voiceChannel.guild.id)) {
                    connections.get(voiceChannel.guild.id).destroy();
                    connections.delete(voiceChannel.guild.id);
                }
            });

            player.on('error', (error) => {
                console.error(`❌ Error en el reproductor: ${error.message}`);
                message.reply('❌ Ocurrió un error al reproducir la canción.');
                if (connections.has(voiceChannel.guild.id)) {
                    connections.get(voiceChannel.guild.id).destroy();
                    connections.delete(voiceChannel.guild.id);
                }
            });

        } catch (error) {
            console.error(`❌ Error general: ${error.message}`);
            message.reply('❌ Hubo un problema al reproducir la canción.');
        }
    }
});

client.login(
  "YOUR_TOKEN_HERE" // Reemplaza con tu token de bot de Discord"
);
