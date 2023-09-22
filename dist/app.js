"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
// 加载 .env 环境变量
//import { PrismaClient } from '@prisma/client';
const dotenv_1 = require("dotenv");
const uuid_1 = require("uuid");
dotenv_1.config();
//const prisma = new PrismaClient();
const ROOMS = [
    {
        title: "Global Chatroom",
        id: "1",
    },
];
var drawings = [];
var undos = [];
var moves = [];
var zooms = [];
var copies = [];
const dev = process.env.NODE_ENV !== 'production';
const app = express_1.default();
const server = http_1.createServer(app);
const io = new socket_io_1.Server(server, { cors: { origin: "*" } });
app.use(cors_1.default());
app.get('/hello', async (_, res) => {
    res.send('Hello World');
});
const rooms = new Map();
const addMove = (roomId, socketId, move) => {
    const room = rooms.get(roomId);
    if (room.users != undefined && !room.users.has(socketId)) {
        console.log(move);
        room.usersMoves.set(socketId, [move]);
    }
    room.usersMoves.get(socketId).push(move);
};
const undoMove = (roomId, socketId) => {
    const room = rooms.get(roomId);
    console.log("undo:" + room.usersMoves);
    room.usersMoves.get(socketId).pop();
};
io.on('connection', (socket) => {
    const getRoomId = () => {
        const joinedRoom = [...socket.rooms].find((room) => room !== socket.id);
        if (!joinedRoom)
            return socket.id;
        return joinedRoom;
    };
    const leaveRoom = (roomId, socketId) => {
        const room = rooms.get(roomId);
        if (!room)
            return;
        const userMoves = room.usersMoves.get(socketId);
        if (userMoves)
            room.drawed.push(...userMoves);
        console.log("userMoves" + JSON.stringify(userMoves));
        room.users.delete(socketId);
        socket.leave(roomId);
    };
    socket.on('create_room', (username) => {
        let roomId;
        do {
            roomId = Math.random().toString(36).substring(2, 6);
        } while (rooms.has(roomId));
        socket.join(roomId);
        rooms.set(roomId, {
            usersMoves: new Map([[socket.id, []]]),
            drawed: [],
            users: new Map([[socket.id, username]]),
        });
        io.to(socket.id).emit('created', roomId);
    });
    socket.on('check_room', (roomId) => {
        if (rooms.has(roomId))
            socket.emit('room_exists', true);
        else
            socket.emit('room_exists', false);
    });
    socket.on('join_room', (roomId, username) => {
        const room = rooms.get(roomId);
        if (room && room.users.size < 12) {
            socket.join(roomId);
            room.users.set(socket.id, username);
            console.log("Refershed" + room.usersMoves);
            room.usersMoves.set(socket.id, []);
            io.to(socket.id).emit('joined', roomId);
        }
        else
            io.to(socket.id).emit('joined', '', true);
    });
    socket.on('joined_room', () => {
        const roomId = getRoomId();
        const room = rooms.get(roomId);
        if (!room)
            return;
        io.to(socket.id).emit('room', room, JSON.stringify([...room.usersMoves]), JSON.stringify([...room.users]));
        socket.broadcast
            .to(roomId)
            .emit('new_user', socket.id, room.users.get(socket.id) || 'Anonymous');
    });
    socket.on('leave_room', () => {
        const roomId = getRoomId();
        leaveRoom(roomId, socket.id);
        io.to(roomId).emit('user_disconnected', socket.id);
    });
    socket.on('draw', (move) => {
        const roomId = getRoomId();
        const timestamp = Date.now();
        // eslint-disable-next-line no-param-reassign
        move.id = uuid_1.v4();
        console.log(move);
        addMove(roomId, socket.id, Object.assign({}, move, { timestamp }));
        drawings.push({
            strokeId: move.id,
            cX: move.circle.cX,
            cY: move.circle.cY,
            radiusX: move.circle.radiusX,
            radiusY: move.circle.radiusY,
            width: move.rect.width,
            height: move.rect.height,
            image: "ffhhhjfjhfhf",
            path: move.path.toString(),
            mode: move.options.mode,
            shape: move.options.shape
        });
        io.to(socket.id).emit('your_move', Object.assign({}, move, { timestamp }));
        socket.broadcast
            .to(roomId)
            .emit('user_draw', Object.assign({}, move, { timestamp }), socket.id);
    });
    socket.on('undo', () => {
        const roomId = getRoomId();
        undoMove(roomId, socket.id);
        console.log();
        socket.broadcast.to(roomId).emit('user_undo', socket.id);
    });
    socket.on('mouse_move', (x, y) => {
        socket.broadcast.to(getRoomId()).emit('mouse_moved', x, y, socket.id);
    });
    socket.on('send_msg', (msg) => {
        io.to(getRoomId()).emit('new_msg', socket.id, msg);
    });
    socket.on('disconnecting', () => {
        const roomId = getRoomId();
        leaveRoom(roomId, socket.id);
        io.to(roomId).emit('user_disconnected', socket.id);
    });
});
const port = process.env.PORT || 5003;
// 启动服务器
server.listen(port, () => {
    //console.log(basePath);
    console.log(`server listen on ${port}`);
});
