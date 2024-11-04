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
YDL_OPTIONS = {'format': 'bestaudio', 'noplaylist': True, 'nocheckcertificate': True}

class MusicBot(commands.Cog):
    def __init__(self, client):
        self.client = client
        self.queue = []

    @commands.command(aliases=["p"])
    async def play(self, ctx, *, search):
        """Reproduce una canción o añade a la cola. Alias: !p"""
        try:
            voice_channel = ctx.author.voice.channel if ctx.author.voice else None
            if not voice_channel:
                return await ctx.send("Debes estar en un canal de voz para usar este comando.")

            # Conéctate al canal de voz si no estás ya conectado
            if not ctx.voice_client:
                await voice_channel.connect()

            # Buscar y añadir la canción a la cola
            async with ctx.typing():
                with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                    info = ydl.extract_info(f"ytsearch:{search}", download=False)
                    if 'entries' in info:
                        info = info['entries'][0]
                    url = info['url']
                    title = info['title']
                    self.queue.append((url, title))
                    await ctx.send(f"Añadido a la cola: **{title}**")
                    # print("URL extraída para reproducción:", url)  # Muestra la URL en la consola para depuración

            # Si el bot no está reproduciendo nada, comienza a reproducir
            if not ctx.voice_client.is_playing():
                await self.play_next(ctx)

        except Exception as e:
            await ctx.send(f"Ocurrió un error: {e}")
            print(f"Ocurrió un error en el comando play: {e}")

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
            await ctx.send(f'Reproduciendo ahora: **{title}**   **♫♪♩ヾ(*◎○◎)ﾉ♫♪♩**')
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
            await ctx.send("La reproducción se ha detenido, la cola ha sido vaciada y el bot se desconectará. Bye Bye **(´ ∀ ` *)**")
        else:
            await ctx.send("No hay ninguna canción reproduciéndose para detener.")
        
        # Desconectar del canal de voz
        await voice_client.disconnect()

client = commands.Bot(command_prefix="!", intents=intents)

@client.event
async def on_ready():
    print(f'Bot conectado como {client.user}')

async def main():
    await client.add_cog(MusicBot(client))
    await client.start('MTMwMjc4Njk4NjU1NzMxMzA2NQ.GdixFa.EI9dBL6cE5iLhEa3zmxUgh9jw2zrTkEbQhQiBc')  # Reemplaza 'YOUR_BOT_TOKEN' con el token de tu bot

asyncio.run(main())
