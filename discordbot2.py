import discord
from discord.ext import commands
import yt_dlp
import asyncio
import logging

# logging.basicConfig(level=logging.DEBUG)  # Activa el modo de depuración

intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True

# Ajustes para mejorar la estabilidad de la transmisión
FFMPEG_OPTIONS = {'options': '-vn -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5'}
YDL_OPTIONS = {
    'format': 'bestaudio',
    'extractor_args': {'force_generic_extractor': True},
    'quiet': True,  # Suprime los mensajes de salida
}

class MusicBot(commands.Cog):

    @commands.Cog.listener()
    async def on_command_error(self, ctx, error):
        """Maneja errores de comandos sin mostrar el traceback completo."""
        if isinstance(error, commands.CommandInvokeError):
            await ctx.send("Ocurrió un error al ejecutar el comando. Intenta de nuevo o revisa tu entrada.")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.send("Argumento faltante en el comando. Por favor, revisa el comando e inténtalo de nuevo.")
        elif isinstance(error, commands.CommandNotFound):
            await ctx.send("Este comando no existe.")
        else:
            await ctx.send(f"Ha ocurrido un error: {str(error)}")

    def __init__(self, client):
        self.client = client
        self.queue = []  # Cola para las canciones

    async def play_next(self, ctx):
        """Reproduce el siguiente video de la cola. Reproduce una canción a la vez."""
        if self.queue:
            url, title = self.queue.pop(0)  # Obtiene la siguiente canción de la cola
            async with ctx.typing():
                # Descargar solo el siguiente video cuando lo vayamos a reproducir
                with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                    info = ydl.extract_info(url, download=True)  # Descarga el audio
                    filename = ydl.prepare_filename(info)  # Obtiene el nombre del archivo descargado
                    # Usar FFmpeg para reproducir el archivo descargado
                    source = discord.FFmpegPCMAudio(filename, **FFMPEG_OPTIONS)
                    ctx.voice_client.play(source, after=lambda e: self.client.loop.create_task(self.play_next(ctx)))
                    await ctx.send(f'Now playing: **{title}**')  # Informa al chat que está sonando la canción

        else:
            await ctx.send("La cola está vacía.")  # Si la cola está vacía, avisa

    async def check_inactivity(self, ctx):
        """Desconecta el bot tras 2 minutos de inactividad en el canal de voz."""
        await asyncio.sleep(120)  # Espera de 2 minutos
        if not ctx.voice_client.is_playing() and len(self.queue) == 0:
            await ctx.voice_client.disconnect()
            await ctx.send("El bot se ha desconectado debido a inactividad.")

    @commands.command()
    async def play(self, ctx, *, search):
        """Comando para reproducir música, soporta tanto canciones individuales como playlists."""
        voice_channel = ctx.author.voice.channel if ctx.author.voice else None
        if not voice_channel:
            return await ctx.send("Debes estar en un canal de voz para usar este comando.")
        
        if not ctx.voice_client:
            await voice_channel.connect()  # Conectarse al canal de voz si no está conectado

        async with ctx.typing():
            with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                try:
                    # Verificar si es una URL de playlist
                    if "playlist" in search:
                        info = ydl.extract_info(search, download=False)  # Extrae la info de la playlist sin descargar
                        if 'entries' in info and info['entries']:
                            for entry in info['entries']:
                                title = entry['title']
                                url = entry['url']
                                self.queue.append((url, title))  # Añadir cada video a la cola
                            await ctx.send(f"Playlist añadida a la cola. {len(info['entries'])} canciones.")
                        else:
                            await ctx.send("No se encontraron canciones en la playlist.")
                    else:
                        info = ydl.extract_info(f"ytsearch:{search}", download=False)  # Busca la canción
                        if 'entries' in info and info['entries']:
                            info = info['entries'][0]  # Asegurarse de que al menos un resultado está presente
                            url = info['url']
                            title = info['title']
                            self.queue.append((url, title))  # Añadir canción a la cola
                            await ctx.send(f"Añadido a la cola: **{title}**")
                        else:
                            await ctx.send("No se encontraron resultados para tu búsqueda.")
                    
                except Exception as e:
                    await ctx.send(f"Hubo un error al procesar la búsqueda o la playlist: {str(e)}")
        
        # Si no se está reproduciendo nada, empieza a reproducir la cola
        if not ctx.voice_client.is_playing():
            await self.play_next(ctx)

        await self.check_inactivity(ctx)

    @commands.command()
    async def p(self, ctx, *, search):
        """Comando alternativo para reproducir música con !p (también maneja playlists)."""
        await self.play(ctx, search=search)

    async def play_next(self, ctx):
        if self.queue:
            url, title = self.queue.pop(0)
            source = discord.FFmpegPCMAudio(url, **FFMPEG_OPTIONS)

            # Define una función de callback para manejar errores en el final de cada canción
            def next_song(_):
                try:
                    self.client.loop.create_task(self.play_next(ctx))
                except Exception as e:
                    print(f"Error al reproducir la siguiente canción: {e}")

            ctx.voice_client.play(source, after=next_song)
            await ctx.send(f'Reproduciendo ahora: **{title}**   **(≧❂◡❂≦)**')
        elif not ctx.voice_client.is_playing():
            await ctx.send("La cola está vacía. Agrega más canciones con el comando **!play**.")

    @commands.command(aliases=["s"])
    async def skip(self, ctx):
        if ctx.voice_client and ctx.voice_client.is_playing():
            ctx.voice_client.stop()
            await ctx.send("Canción saltada.")
            await self.play_next(ctx)

    @commands.command(name="queue")
    async def show_queue(self, ctx):
        """Muestra la cola de canciones pendientes."""
        if not self.queue:
            await ctx.send("La cola está vacía.")
        else:
            # Crear una lista con los títulos de las canciones en la cola
            queue_list = "\n".join([f"{index + 1}. {title}" for index, (_, title) in enumerate(self.queue)])
            await ctx.send(f"**Canciones en la cola:**\n{queue_list}")

    @commands.command()
    async def pause(self, ctx):
        """Pausa o reanuda la canción dependiendo de su estado actual."""
        voice_client = ctx.voice_client
        if voice_client is None:
            return await ctx.send("No estoy conectado a un canal de voz.")

        if voice_client.is_playing():
            voice_client.pause()
            await ctx.send("Canción pausada.")
        elif voice_client.is_paused():
            voice_client.resume()
            await ctx.send("Canción reanudada.")
        else:
            await ctx.send("No hay ninguna canción reproduciéndose.")

    @commands.command()
    async def stop(self, ctx):
        """Detiene la canción, limpia la cola de reproducción y desconecta al bot del canal de voz."""
        voice_client = ctx.voice_client
        if voice_client is None:
            return await ctx.send("No estoy conectado a un canal de voz.")

        # Detiene la canción y limpia la cola
        if voice_client.is_playing() or voice_client.is_paused():
            voice_client.stop()
            self.queue.clear()  # Limpia la cola de reproducción
            await ctx.send("La reproducción se ha detenido, la cola ha sido vaciada y el bot se desconectará. Bye Bye **(≧❂◡❂≦)**")
        else:
            await ctx.send("No hay ninguna canción reproduciéndose para detener.")
        
        # Desconectar del canal de voz
        await voice_client.disconnect()

client = commands.Bot(command_prefix="!", intents=intents)

@client.event
async def on_ready():
    print(f'Bot conectado como {client.user}')

async def main():
    try:
        await client.add_cog(MusicBot(client))
        await client.start('MTMwMjc4Njk4NjU1NzMxMzA2NQ.Gh5Gvy.LIkn2MV0zZruGO09cuWxVxSBSzPP22IMxUD_nM')  # Reemplaza 'YOUR_BOT_TOKEN' con el token de tu bot
    except Exception as e:
        print("Error al iniciar el bot:", str(e))

asyncio.run(main())
