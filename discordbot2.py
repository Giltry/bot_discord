import discord
from discord.ext import commands
import yt_dlp
import asyncio

intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True

FFMPEG_OPTIONS = {'options': '-vn'}
YDL_OPTIONS = {'format': 'bestaudio', 'noplaylist': False}


class MusicBot(commands.Cog):
    def __init__(self, client):
        self.client = client
        self.queue = []
        self.loop = False  # Estado del loop
        self.current_song = None  # URL de la canción actual
        self.current_song_title = None  # Título de la canción actual

    @commands.command(aliases=["p"])
    async def play(self, ctx, *, search):
        """Busca y reproduce una canción o añade a la cola."""
        voice_channel = ctx.author.voice.channel if ctx.author.voice else None
        if not voice_channel:
            return await ctx.send("Debes estar en un canal de voz para usar este comando.")
        if not ctx.voice_client:
            await voice_channel.connect()

        async with ctx.typing():
            with yt_dlp.YoutubeDL(YDL_OPTIONS) as ydl:
                try:
                    info = ydl.extract_info(f"ytsearch:{search}", download=False)
                    if 'entries' in info:
                        info = info['entries'][0]
                    url = info['url']
                    title = info['title']
                    self.queue.append((url, title))
                    await ctx.send(f"Añadido a la cola: **{title}**")
                except Exception as e:
                    await ctx.send(f"Hubo un error al procesar la búsqueda: {e}")

        if not ctx.voice_client.is_playing():
            await self.play_next(ctx)

    async def play_next(self, ctx):
        """Reproduce la siguiente canción en la cola o repite si el loop está activado."""
        if self.loop and self.current_song:
            # Repite la canción actual si el loop está activado
            source = await discord.FFmpegOpusAudio.from_probe(self.current_song, **FFMPEG_OPTIONS)
            ctx.voice_client.play(source, after=lambda _: self.client.loop.create_task(self.play_next(ctx)))
            await ctx.send(f"Reproduciendo en loop: **{self.current_song_title}**")  # Mensaje actualizado
        elif self.queue:
            # Reproduce la siguiente canción de la cola
            self.current_song, self.current_song_title = self.queue.pop(0)
            source = await discord.FFmpegOpusAudio.from_probe(self.current_song, **FFMPEG_OPTIONS)
            ctx.voice_client.play(source, after=lambda _: self.client.loop.create_task(self.play_next(ctx)))
            await ctx.send(f"Ahora reproduciendo: **{self.current_song_title}**")
        else:
            await ctx.send("La cola está vacía. Agrega más canciones con el comando !play.")

    @commands.command()
    async def queue(self, ctx):
        """Muestra las canciones en la cola."""
        if self.queue:
            queue_list = "\n".join([f"{i + 1}. {title}" for i, (_, title) in enumerate(self.queue)])
            await ctx.send(f"**Canciones en la cola:**\n{queue_list}")
        else:
            await ctx.send("La cola está vacía.")

    @commands.command()
    async def loop(self, ctx):
        """Activa o desactiva el loop de la canción actual."""
        self.loop = not self.loop
        status = "activado" if self.loop else "desactivado"
        await ctx.send(f"El modo loop ha sido {status}: **{self.current_song_title}**")

    @commands.command()
    async def skip(self, ctx):
        """Salta la canción actual."""
        if ctx.voice_client and ctx.voice_client.is_playing():
            ctx.voice_client.stop()
            await ctx.send("Skipped")

    @commands.command()
    async def pause(self, ctx):
        """Pausa o reanuda la canción actual."""
        if ctx.voice_client:
            if ctx.voice_client.is_playing():
                ctx.voice_client.pause()
                await ctx.send("Canción pausada.")
            elif ctx.voice_client.is_paused():
                ctx.voice_client.resume()
                await ctx.send("Canción reanudada.")

    @commands.command()
    async def stop(self, ctx):
        """Detiene la reproducción y desconecta al bot."""
        if ctx.voice_client:
            self.queue.clear()
            self.loop = False
            await ctx.voice_client.disconnect()
            await ctx.send("Reproducción detenida y bot desconectado.")

    async def auto_disconnect(self, ctx):
        """Desconecta al bot después de 2 minutos de inactividad."""
        await asyncio.sleep(120)
        if not ctx.voice_client.is_playing() and not ctx.voice_client.is_paused():
            await ctx.voice_client.disconnect()
            await ctx.send("Me desconecté por inactividad.")

client = commands.Bot(command_prefix="!", intents=intents)

async def main():
    await client.add_cog(MusicBot(client))
    await client.start('MTMwMjc4Njk4NjU1NzMxMzA2NQ.Gh5Gvy.LIkn2MV0zZruGO09cuWxVxSBSzPP22IMxUD_nM')

asyncio.run(main())
