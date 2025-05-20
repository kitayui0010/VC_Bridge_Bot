require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    VoiceConnectionStatus,
    entersState,
    StreamType,
} = require('@discordjs/voice');
const net = require('net');
const prism = require('prism-media');

const TOKEN = process.env.RECEIVER_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const DEST_VC_ID = process.env.DEST_VC_ID;
const PORT = parseInt(process.env.RECEIVER_PORT || '50000');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let connection;
let player;

async function connectToVC() {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(DEST_VC_ID);

        connection = joinVoiceChannel({
            channelId: DEST_VC_ID,
            guildId: GUILD_ID,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        console.log('受信: VC接続完了');

        player = createAudioPlayer();
        connection.subscribe(player);
        player.on('error', console.error);

        unmuteBot(guild);
    } catch (err) {
        console.error('受信: 接続失敗、再試行します...', err);
        setTimeout(connectToVC, 5000);
    }
}

async function unmuteBot(guild) {
    const me = await guild.members.fetchMe();
    if (me.voice.serverMute || me.voice.serverDeaf) {
        await me.voice.setMute(false);
        await me.voice.setDeaf(false);
        console.log('受信: サーバーミュートを解除しました');
    }
}

net.createServer(socket => {
    console.log('受信: 送信側から接続');

    const decoder = new prism.opus.Decoder({
        channels: 2,
        rate: 48000,
        frameSize: 960,
    });

    const decoded = socket.pipe(decoder);

    const resource = createAudioResource(decoded, {
        inputType: StreamType.Raw,
    });

    player?.play(resource);

    socket.on('end', () => {
        console.log('受信: 送信側が切断');
    });

    socket.on('error', (err) => {
        console.error('受信: ソケットエラー', err);
    });
}).listen(PORT, () => {
    console.log('受信: サーバー起動');
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (
        newState.id === client.user.id &&
        (!newState.channelId || newState.channelId !== DEST_VC_ID)
    ) {
        console.warn('受信: VCから切断されました。再接続します...');
        connectToVC();
    }
    if (newState.id === client.user.id) {
        const guild = await client.guilds.fetch(GUILD_ID);
        unmuteBot(guild);
    }
});

client.once('ready', () => {
    console.log('受信: Bot起動完了');
    connectToVC();
});

client.login(TOKEN);
