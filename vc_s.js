require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const {
    joinVoiceChannel,
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const net = require('net');

const TOKEN = process.env.SENDER_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SOURCE_VC_ID = process.env.SOURCE_VC_ID;
const SOURCE_CATEGORY_ID = process.env.SOURCE_CATEGORY_ID;
const RECEIVER_HOST = process.env.RECEIVER_HOST || '127.0.0.1';
const RECEIVER_PORT = parseInt(process.env.RECEIVER_PORT || '50000');
const ENABLE_VC_MONITORING = process.env.ENABLE_VC_MONITORING === 'true'; // 新しい環境変数

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let connection;
let currentChannelId = null;
let guildCache = null;
let monitorInterval = null;
let isReconnecting = false;

async function selectBestVCInCategory(guild) {
    const channels = await guild.channels.fetch();
    const vcList = channels.filter(
        (c) => c.type === ChannelType.GuildVoice && c.parentId === SOURCE_CATEGORY_ID
    );

    let bestVC = SOURCE_VC_ID;
    let maxMembers = -1;

    for (const vc of vcList.values()) {
        const memberCount = vc.members.filter(
            (m) => !m.user.bot && m.id !== client.user.id
        ).size;
        if (memberCount > maxMembers) {
            bestVC = vc.id;
            maxMembers = memberCount;
        }
    }

    return bestVC;
}

async function connectToVC(targetVC) {
    if (isReconnecting) return;

    try {
        const channel = await guildCache.channels.fetch(targetVC, { force: true });
        if (!channel || channel.type !== ChannelType.GuildVoice) {
            console.error(`VC (${targetVC}) が見つからないか無効`);
            return;
        }

        if (connection) {
            try {
                connection.destroy();
            } catch {}
        }

        isReconnecting = true;
        connection = joinVoiceChannel({
            channelId: targetVC,
            guildId: GUILD_ID,
            adapterCreator: guildCache.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true,
        });
        currentChannelId = targetVC;

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        console.log(`送信: VC (${channel.name}) に接続しました`);

        monitorSpeaking(connection);
        unmuteBot(guildCache);
        setTimeout(() => { isReconnecting = false; }, 3000);
    } catch (err) {
        console.error('送信: 接続失敗', err);
        isReconnecting = false;
    }
}


function monitorSpeaking(connection) {
    connection.receiver.speaking.on('start', (userId) => {
        console.log(`送信: ユーザー ${userId} が話し始めました`);
        const opusStream = connection.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
        });

        createAndPipeSocket(opusStream, userId);
    });
}

function createAndPipeSocket(opusStream, userId) {
    const socket = net.connect(RECEIVER_PORT, RECEIVER_HOST, () => {
        console.log('送信: 受信側へ接続しました');
        opusStream.pipe(socket);
    });

    socket.on('error', (error) => {
        console.error('送信: ソケットエラー', error);
        setTimeout(() => createAndPipeSocket(opusStream, userId), 2000);
    });

    opusStream.on('end', () => {
        console.log(`送信: ユーザー ${userId} の音声終了`);
        socket.end();
    });
}

async function unmuteBot(guild) {
    try {
        const me = await guild.members.fetchMe();
        if (me.voice.serverMute || me.voice.serverDeaf) {
            await me.voice.setMute(false);
            await me.voice.setDeaf(false);
            console.log('送信: サーバーミュートを解除しました');
        }
    } catch (err) {
        console.error('送信: ミュート解除失敗', err);
    }
}

async function monitorVCActivity() {
    // Check ENABLE_VC_MONITORING before performing the check and move
    if (!ENABLE_VC_MONITORING) { //
        console.log('VC人数による移動は無効です。'); //
        return; //
    }

    const bestVC = await selectBestVCInCategory(guildCache);

    if (bestVC !== currentChannelId) {
        console.log(`送信: 最も人が多いVCが変更されました → ${bestVC}`);
        await connectToVC(bestVC);
    }
}


client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.id !== client.user.id) return;
    if (isReconnecting) return;

    const newChannelId = newState.channelId;

    if (!newChannelId || newChannelId !== currentChannelId) {
        console.warn('送信: VCから切断または移動されました。再接続します...');

        isReconnecting = true;
        setTimeout(async () => {
            await connectToVC(SOURCE_VC_ID);
            isReconnecting = false;
        }, 3000);
    } else {
        unmuteBot(guildCache);
    }
});

client.once('ready', async () => {
    console.log('送信: Bot起動完了');

    guildCache = await client.guilds.fetch(GUILD_ID);

    const initialVC = await selectBestVCInCategory(guildCache);
    await connectToVC(initialVC);

    // 毎10秒ごとにVC人数をチェック
    // Only set the interval if monitoring is enabled
    if (ENABLE_VC_MONITORING) { //
        monitorInterval = setInterval(monitorVCActivity, 10 * 1000); //
    } else {
        console.log('VC人数による移動は無効です。'); //
    }
});

client.login(TOKEN);