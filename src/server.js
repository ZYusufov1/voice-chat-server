const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./config');
const channelsStore = require('./channelsStore');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Voice chat signaling server with channels is running');
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: config.allowedOrigins.includes('*')
            ? '*'
            : config.allowedOrigins,
        methods: ['GET', 'POST']
    }
});

/**
 * Отражает ТЕКУЩИХ участников (presence)
 * @type {Map<string, Map<string, {socketId: string, name: string, joinedAt: string}>>}
 */
const channelMembers = new Map();

/**
 * Нужно, чтобы быстро понять, из какого канала вышел сокет
 * @type {Map<string, string>}
 */
const socketChannelMap = new Map();

/**
 * Собрать массив состояния каналов для клиента
 */
function buildChannelsState() {
    const channels = channelsStore.getChannels();

    return channels.map(ch => {
        const members = channelMembers.get(ch.id);
        const onlineUsers = members
            ? Array.from(members.values()).map(m => ({
                socketId: m.socketId,
                name: m.name
            }))
            : [];

        return {
            id: ch.id,
            name: ch.name,
            maxUsers: ch.maxUsers,
            hasPassword: ch.hasPassword,
            onlineCount: onlineUsers.length,
            onlineUsers
        };
    });
}

/**
 * Расслать обновленное состояние каналов всем подключенным
 */
function broadcastChannelsState() {
    const payload = buildChannelsState();
    io.emit('channels-state', payload);
}

/**
 * REST: список каналов
 * GET /channels
 */
app.get('/channels', (req, res) => {
    res.json(buildChannelsState());
});

/**
 * REST: детали конкретного канала
 * GET /channels/:id
 */
app.get('/channels/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    const ch = channelsStore.getChannel(id);

    if (!ch) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const members = channelMembers.get(id);
    const onlineUsers = members
        ? Array.from(members.values()).map(m => ({
            socketId: m.socketId,
            name: m.name
        }))
        : [];

    res.json({
        id: ch.id,
        name: ch.name,
        maxUsers: ch.maxUsers,
        hasPassword: ch.hasPassword,
        onlineCount: onlineUsers.length,
        onlineUsers
    });
});

/**
 * REST: создать канал
 * POST /channels
 * body: { name: string, maxUsers?: number, password?: string }
 */
app.post('/channels', (req, res) => {
    try {
        const { name, maxUsers, password } = req.body || {};
        const channel = channelsStore.createChannel({ name, maxUsers, password });

        const response = {
            id: channel.id,
            name: channel.name,
            maxUsers: channel.maxUsers,
            hasPassword: channel.hasPassword,
            onlineCount: 0,
            onlineUsers: []
        };

        // разослать новое состояние каналов
        broadcastChannelsState();

        res.status(201).json(response);
    } catch (e) {
        if (e.message === 'NAME_REQUIRED') {
            return res.status(400).json({ error: 'NAME_REQUIRED' });
        }

        console.error('Error creating channel', e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

/**
 * Socket.IO логика
 */
io.on('connection', socket => {
    console.log('Client connected:', socket.id);

    // При новом подключении можно сразу отправить состояние каналов
    socket.emit('channels-state', buildChannelsState());

    /**
     * Присоединение к голосовому каналу (roomId = channelId)
     * payload: { roomId, userName, password? }
     */
    socket.on('join-room', ({ roomId, userName, password }) => {
        const channelId = String(roomId || '').trim();
        if (!channelId)
            return;

        const channel = channelsStore.getChannel(channelId);
        if (!channel) {
            socket.emit('join-error', { code: 'CHANNEL_NOT_FOUND' });
            return;
        }

        // Проверяет лимит
        let members = channelMembers.get(channelId);
        if (!members) {
            members = new Map();
            channelMembers.set(channelId, members);
        }

        const effectiveMaxUsers = channel.maxUsers || config.maxRoomUsers;
        if (members.size >= effectiveMaxUsers) {
            socket.emit('join-error', { code: 'ROOM_FULL' });
            return;
        }

        // Проверяет пароль
        if (channel.hasPassword) {
            const provided = password ? String(password) : '';
            if (!provided || provided !== (channel.passwordHash || '')) {
                socket.emit('join-error', { code: 'WRONG_PASSWORD' });
                return;
            }
        }

        // Присоединяем к socket.io комнате
        socket.join(channelId);

        const member = {
            socketId: socket.id,
            name: userName || 'Без имени',
            joinedAt: new Date().toISOString()
        };

        members.set(socket.id, member);
        socketChannelMap.set(socket.id, channelId);

        // Формируем список остальных в канале
        const others = [];
        members.forEach(m => {
            if (m.socketId !== socket.id) {
                others.push({ socketId: m.socketId, name: m.name });
            }
        });

        socket.emit('room-users', {
            roomId: channelId,
            users: others,
            maxUsers: effectiveMaxUsers
        });

        // Оповестить остальных в канале
        socket.to(channelId).emit('user-joined', {
            socketId: socket.id,
            name: member.name
        });

        broadcastChannelsState();
    });

    /**
     * Пересылка WebRTC сигналов (offer/answer/ICE)
     * payload: { roomId, targetSocketId, data }
     */
    socket.on('signal', ({ roomId, targetSocketId, data }) => {
        if (!roomId || !targetSocketId || !data)
            return;

        io.to(targetSocketId).emit('signal', {
            from: socket.id,
            roomId,
            data
        });
    });

    /**
     * Отключение сокета
     */
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        const channelId = socketChannelMap.get(socket.id);
        if (!channelId) {
            return;
        }

        const members = channelMembers.get(channelId);
        if (members && members.has(socket.id)) {
            members.delete(socket.id);

            // оповестить остальных
            socket.to(channelId).emit('user-left', {
                socketId: socket.id
            });

            if (members.size === 0) {
                channelMembers.delete(channelId);
            }
        }

        socketChannelMap.delete(socket.id);
        broadcastChannelsState();
    });
});

httpServer.listen(config.port, () => {
    console.log(`Signaling server with channels listening on port ${config.port}`);
});
