const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  NoSubscribeBehavior,
} = require("@discordjs/voice");
const ytdl = require("ytdl-core");
const ytSearch = require("yt-search");

// Crear un nuevo cliente de Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Configuracion
const prefix = "!"; // Prefijo de comandos
const queue = new Map(); // Cola de reproduccion global

// Evento cuando el bot esta listo
client.once("ready", () => {
  console.log(`Bot de musica listo! Conectado como ${client.user.tag}`);
});

// Manejo de mensajes
client.on("messageCreate", async (message) => {
  // Ignorar mensajes del bot y mensajes sin el prefijo
  if (message.author.bot || !message.content.startsith(prefix)) {
    // Verificar si hay un link de youtube en el mensaje
    if (
      message.content.includes("youtube.com/watch") ||
      message.content.includes("youtu.be/")
    ) {
      const args = message.content.split(" ");
      for (const arg of args) {
        if (arg.includes("youtube.com/watch") || arg.includes("youtu.be/")) {
          // Ejecutar el comando play con el link detectado
          return execute(message, [arg]);
        }
      }
    }
    return;
  }

  const arg = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Comandos disponibles
  if (command === "play" || command === "p") {
    execute(message, args);
  } else if (command === "skip" || command === "s") {
    skip(message);
  } else if (command === "stop") {
    stop(message);
  } else if (command === "queue" || command === "q") {
    showQueue(message);
  } else if (command === "help" || command === "h") {
    help(message);
  }
});

// Funcion para ejecutar el comando play
async function execute(message, args) {
  const voiceChannel = message.member.voice.channel;

  // Verificar si el usuario esta en un canal de voz
  if (!voiceChannel) {
    return message.channel.send(
      "Debes estar en un canal de voz para usar este comando."
    );
  }

  // Verificar permisos
  const permissions = voiceChannel.permissionFor(message.client.user);
  if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
    return message.channel.send("Necesito permisos para unirme y cantar.");
  }

  // Si no hay argumentos, mostrar error
  if (args.length === 0) {
    return message.channel.send(
      "Por favor, proporciona el nombre o link de la cancion."
    );
  }

  // Obtener la informacion del servidor
  const serverQueue = queue.get(message.guild.id);
  let songInfo;
  let song;

  // Determinar si es un link de youtube o una busqueda
  if (ytdl.validateURL(args[0])) {
    try {
      songInfo = await ytdl.getInfo(args[0]);
      song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: formatDuration(songInfo.videoDetails.lengthSeconds),
        thumbnail: songInfo.videoDetails.thumbnails[0].url,
        requestedBy: message.author.username,
      };
    } catch (error) {
      console.error(error);
      return message.channel.send("Error al obtener la informacion");
    }
  } else {
    try {
      // Buscar la cancion en Youtube
      const searchResults = await ytSearch(args.join(" "));
      if (searchResults.videos.length === 0) {
        return message.channel.send(
          "No se encontraron resultados de la busqueda"
        );
      }
      songInfo = await ytdl.getInfo(searchResults.videos[0].url);
      song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: formatDuration(songInfo.videoDetails.lengthSeconds),
        thumbnail: songInfo.videoDetails.thumbnails[0].url,
        requestedBy: message.author.username,
      };
    } catch (error) {
      console.error(error);
      return message.channel.send("Error al buscar el video");
    }
  }

  // Crear la cola si no existe
  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: [],
      volume: 5,
      playing: true,
      player: null,
    };

    // Establecer la cola en el mapa
    queue.set(message.guild.id, queueConstruct);
    queueConstruct.songs.push(song);

    try {
      // Unirse al canal de voz
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      queueConstruct.connection = connection;

      // Crear el reproductor de audio
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscribeBehavior.Play,
        },
      });

      queueConstruct.player = player;

      // Suscribir la conexion al reproductor
      connection.subscribe(player);

      // Iniciar la reproduccion
      player(message.guild, queueConstruct.songs[0]);
    } catch (error) {
      console.error(error);
      queue.delete(message.guild.id);
      return message.channel.send(`No me pude unir al canal de voz: ${error}`);
    }
  } else {
    serverQueue.songs.push(song);

    // Crear un embed para mostrar la cancion agregada
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("Cancion agregada a la cola")
      .setDescription(`**${song.title}**`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: "Duracion", value: song.duration, inline: true },
        { name: "Solicitada por", value: song.requestedBy, inline: true }
      );

    return message.channel.send({ embeds: [embed] });
  }
}

// Funcion para reproducir una cancion
function play(guild, song) {
  const serverQueue = queue.get(guild.id);

  if (!song) {
    // No hay mas cacniones en la cola, desconectar el bot
    serverQueue.connection.destroy();
    queue.delete(guild.id);
    return;
  }

  try {
    // Crear el recurso de audio
    const stream = ytdl(song.url, {
      filtrer: "audioonly",
      highWaterMark: 1 << 25,
      quality: "highestaudio",
    });

    const resource = createAudioResource(stream);

    // Reproducir el recurso
    serverQueue.player.play(resource);

    // Mostrar la cancion que se esta reproduciendo
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("Reproduciendo ahora")
      .setDescription(`**${song.title}**`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: "Duración", value: song.duration, inline: true },
        { name: "Solicitada por", value: song.requestedBy, inline: true }
      );

    serverQueue.textChannel.send({ embeds: [embed] });

    // Cuando termine la cancion, reproducir la siguiente
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    });

    // Manejar errores de reproduccion
    serverQueue.player.on("error", (error) => {
      console.error(error);
      serverQueue.textChannel.send(`Error al reproducir: ${error.message}`);
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    });
  } catch (error) {
    console.error(error);
    serverQueue.textChannel.send(`Error al reproducir. ${error.message}`);
    serverQueue.songs.shift();
    play(guild, serverQueue.songs[0]);
  }
}

// Funcion para saltar cancion
function skip(message) {
  const serverQueue = queue.get(message.guild.id);

  if (!message.member.voice.channel) {
    return message.channel.send("Debes estar en un chat de voz");
  }
}
