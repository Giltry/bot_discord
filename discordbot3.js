const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  NoSubscriberBehavior,
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

// Configuración
const prefix = "!"; // Prefijo para comandos
const queue = new Map(); // Cola de reproducción global

// Evento cuando el bot está listo
client.once("ready", () => {
  console.log(`Bot de música listo! Conectado como ${client.user.tag}`);
});

// Manejo de mensajes
client.on("messageCreate", async (message) => {
  // Ignorar mensajes del bot y mensajes sin el prefijo
  if (message.author.bot || !message.content.startsWith(prefix)) {
    // Verificar si hay un link de YouTube en el mensaje
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

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Comandos disponibles
  if (command === "play" || command === "p") {
    execute(message, args);
  } else if (command === "skip") {
    skip(message);
  } else if (command === "stop") {
    stop(message);
  } else if (command === "queue" || command === "q") {
    showQueue(message);
  } else if (command === "help") {
    help(message);
  }
});

// Función para ejecutar el comando play
async function execute(message, args) {
  const voiceChannel = message.member.voice.channel;

  // Verificar si el usuario está en un canal de voz
  if (!voiceChannel) {
    return message.channel.send(
      "¡Necesitas estar en un canal de voz para reproducir música!"
    );
  }

  // Verificar permisos
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
    return message.channel.send(
      "¡Necesito permisos para unirme y hablar en tu canal de voz!"
    );
  }

  // Si no hay argumentos, mostrar error
  if (args.length === 0) {
    return message.channel.send(
      "Por favor, proporciona el nombre o link de una canción"
    );
  }

  // Obtener la información del servidor
  const serverQueue = queue.get(message.guild.id);
  let songInfo;
  let song;

  // Determinar si es un link de YouTube o una búsqueda
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
      return message.channel.send("Error al obtener la información del video");
    }
  } else {
    try {
      // Buscar la canción en YouTube
      const searchResults = await ytSearch(args.join(" "));
      if (searchResults.videos.length === 0) {
        return message.channel.send(
          "No se encontraron resultados para esta búsqueda"
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
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      queueConstruct.player = player;

      // Suscribir la conexión al reproductor
      connection.subscribe(player);

      // Iniciar la reproducción
      play(message.guild, queueConstruct.songs[0]);
    } catch (error) {
      console.error(error);
      queue.delete(message.guild.id);
      return message.channel.send(`No me pude unir al canal de voz: ${error}`);
    }
  } else {
    serverQueue.songs.push(song);

    // Crear un embed para mostrar la canción agregada
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("Canción agregada a la cola")
      .setDescription(`**${song.title}**`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: "Duración", value: song.duration, inline: true },
        { name: "Solicitada por", value: song.requestedBy, inline: true }
      );

    return message.channel.send({ embeds: [embed] });
  }
}

// Función para reproducir una canción
function play(guild, song) {
  const serverQueue = queue.get(guild.id);

  if (!song) {
    // No hay más canciones en la cola, desconectar el bot
    serverQueue.connection.destroy();
    queue.delete(guild.id);
    return;
  }

  try {
    // Crear el recurso de audio
    const stream = ytdl(song.url, {
      filter: "audioonly",
      highWaterMark: 1 << 25,
      quality: "highestaudio",
    });

    const resource = createAudioResource(stream);

    // Reproducir el recurso
    serverQueue.player.play(resource);

    // Mostrar la canción que se está reproduciendo
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

    // Cuando termine la canción, reproducir la siguiente
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    });

    // Manejar errores de reproducción
    serverQueue.player.on("error", (error) => {
      console.error(error);
      serverQueue.textChannel.send(`Error al reproducir: ${error.message}`);
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    });
  } catch (error) {
    console.error(error);
    serverQueue.textChannel.send(`Error al reproducir: ${error.message}`);
    serverQueue.songs.shift();
    play(guild, serverQueue.songs[0]);
  }
}

// Función para saltar una canción
function skip(message) {
  const serverQueue = queue.get(message.guild.id);

  if (!message.member.voice.channel) {
    return message.channel.send(
      "¡Debes estar en un canal de voz para saltar una canción!"
    );
  }

  if (!serverQueue) {
    return message.channel.send("¡No hay canciones para saltar!");
  }

  message.channel.send("⏭️ Canción saltada");
  serverQueue.player.stop();
}

// Función para detener la reproducción
function stop(message) {
  const serverQueue = queue.get(message.guild.id);

  if (!message.member.voice.channel) {
    return message.channel.send(
      "¡Debes estar en un canal de voz para detener la reproducción!"
    );
  }

  if (!serverQueue) {
    return message.channel.send("¡No hay canciones reproduciéndose!");
  }

  serverQueue.songs = [];
  serverQueue.player.stop();
  message.channel.send("🛑 Reproducción detenida");
}

// Funcion para mostrar la cola de reproduccion

// Login del bot
client.login(
  "MTMwMjc4Njk4NjU1NzMxMzA2NQ.Gh5Gvy.LIkn2MV0zZruGO09cuWxVxSBSzPP22IMxUD_nM"
);
