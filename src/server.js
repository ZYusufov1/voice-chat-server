const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./config');

const app = express();
app.use(cors());

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Voice chat signaling server is running');
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

const rooms = new Map();

const roomPasswords = new Map();

/**
 * REST: создать комнату (опционально с паролем)
 * POST /rooms
 * body: { roomId?: string, password?: string }
 */
app.post('/rooms', (req, res) => {
    let { roomId, password } = req.body || {};

    if (!roomId) {
        roomId = Math.random().toString(36).slice(2, 10);
    }

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
    }

    if (password) {
        roomPasswords.set(roomId, String(password));
    }

    res.json({
        roomId,
        hasPassword: Boolean(password)
    });
});

/**
 * REST: проверить наличие комнаты
 * GET /rooms/:roomId
 */
app.get('/rooms/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);

    if (!room) {
        return res.status(404).json({ exists: false });
    }

    res.json({
        exists: true,
        usersCount: room.size,
        hasPassword: roomPasswords.has(roomId)
    });
});

io.on('connection', socket => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ roomId, userName, password }) => {
        if (!roomId) return;

        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);

        const roomPass = roomPasswords.get(roomId);
        if (roomPass && roomPass !== String(password || '')) {
            socket.emit('join-error', { code: 'WRONG_PASSWORD' });
            return;
        }

        if (room.size >= config.maxRoomUsers) {
            socket.emit('join-error', { code: 'ROOM_FULL' });
            return;
        }

        room.set(socket.id, { name: userName || 'Без имени' });
        socket.join(roomId);

        console.log(`Socket ${socket.id} joined room ${roomId}`);

        const others = [];
        for (const [id, user] of room.entries()) {
            if (id !== socket.id) {
                others.push({ socketId: id, name: user.name });
            }
        }

        socket.emit('room-users', {
            roomId,
            users: others,
            maxUsers: config.maxRoomUsers
        });

        socket.to(roomId).emit('user-joined', {
            socketId: socket.id,
            name: room.get(socket.id).name
        });
    });

    socket.on('signal', ({ roomId, targetSocketId, data }) => {
        if (!roomId || !targetSocketId || !data) return;

        io.to(targetSocketId).emit('signal', {
            from: socket.id,
            data
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        for (const [roomId, room] of rooms.entries()) {
            if (room.has(socket.id)) {
                room.delete(socket.id);

                socket.to(roomId).emit('user-left', {
                    socketId: socket.id
                });

                if (room.size === 0) {
                    rooms.delete(roomId);
                    roomPasswords.delete(roomId);
                }

                break;
            }
        }
    });
});

httpServer.listen(config.port, () => {
    console.log(`Signaling server listening on port ${config.port}`);
});
