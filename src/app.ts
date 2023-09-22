import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
// 加载 .env 环境变量
//import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { v4 } from 'uuid';
config();

//const prisma = new PrismaClient();
const ROOMS = [
  {
    title: "Global Chatroom",
    id: "1",
  },
];



var drawings:any= [];
var undos = [];
var moves:any = [];
var zooms = [];
var copies = [];
  //const promises = [];
  /* setInterval(async () => {
    const promises = [];
    if (drawings.length > 0) {
      const data = drawings;
      // 必须先清空缓存
      console.log(data);
      drawings = [];
      // 异步写入数据库
      promises.push(prisma.drawing.createMany({
        data,
        skipDuplicates: true,
      }));
    }
    
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  }) */


export type Shape = 'line' | 'circle' | 'rect' | 'image';
export type CtxMode = 'eraser' | 'draw' | 'select';

export interface CtxOptions {
  lineWidth: number;
  lineColor: '000';
  fillColor: '000';
  shape: Shape;
  mode: CtxMode;
  selection: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface Move {
  circle: {
    cX: number;
    cY: number;
    radiusX: number;
    radiusY: number;
  };
  rect: {
    width: number;
    height: number;
  };
  img: {
    base64: string;
  };
  path: [number, number][];
  options: CtxOptions;
  timestamp: number;
  id: string;
}

export type Room = {
  usersMoves: Map<string, Move[]>;
  drawed: Move[];
  users: Map<string, string>;
};

export interface User {
  name: string;
  color: string;
}

export interface ClientRoom {
  id: string;
  usersMoves: Map<string, Move[]>;
  movesWithoutUser: Move[];
  myMoves: Move[];
  users: Map<string, User>;
}

export interface MessageType {
  userId: string;
  username: string;
  color: string;
  msg: string;
  id: number;
}

export interface ServerToClientEvents {
  room_exists: (exists: boolean) => void;
  joined: (roomId: string, failed?: boolean) => void;
  room: (room: Room, usersMovesToParse: string, usersToParse: string) => void;
  created: (roomId: string) => void;
  your_move: (move: Move) => void;
  user_draw: (move: Move, userId: string) => void;
  user_undo(userId: string): void;
  mouse_moved: (x: number, y: number, userId: string) => void;
  new_user: (userId: string, username: string) => void;
  user_disconnected: (userId: string) => void;
  new_msg: (userId: string, msg: string) => void;
}

export interface ClientToServerEvents {
  check_room: (roomId: string) => void;
  draw: (move: Move) => void;
  mouse_move: (x: number, y: number) => void;
  undo: () => void;
  create_room: (username: string) => void;
  join_room: (room: string, username: string) => void;
  joined_room: () => void;
  leave_room: () => void;
  send_msg: (msg: string) => void;
}

const dev = process.env.NODE_ENV !== 'production';
const app = express();
const server = createServer(app);
  const io = new Server(server, {cors: {origin: "*"}})
  
  app.use(cors())
  app.get('/hello', async (_, res) => {
    res.send('Hello World');
  });

  const rooms = new Map<string, Room>();

  const addMove = (roomId: string, socketId: string, move: Move) => {
    const room = rooms.get(roomId)!;

    if (room.users !=undefined &&!room.users.has(socketId)) {
      console.log(move);
      room.usersMoves.set(socketId, [move]);
    }

    room.usersMoves.get(socketId)!.push(move);
  };

  const undoMove = (roomId: string, socketId: string) => {
    const room = rooms.get(roomId)!;
     console.log("undo:"+room.usersMoves)
    room.usersMoves.get(socketId)!.pop();
  };

  io.on('connection', (socket:any) => {
    const getRoomId = () => {
      const joinedRoom = [...socket.rooms].find((room) => room !== socket.id);

      if (!joinedRoom) return socket.id;

      return joinedRoom;
    };

    const leaveRoom = (roomId: string, socketId: string) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const userMoves = room.usersMoves.get(socketId);

      if (userMoves) room.drawed.push(...userMoves);
      console.log("userMoves"+JSON.stringify(userMoves));
      room.users.delete(socketId);

      socket.leave(roomId);
    };

    socket.on('create_room', (username:any) => {
      let roomId: string;
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

    socket.on('check_room', (roomId:any) => {
      if (rooms.has(roomId)) socket.emit('room_exists', true);
      else socket.emit('room_exists', false);
    });

    socket.on('join_room', (roomId:any, username:any) => {
      const room = rooms.get(roomId);

      if (room && room.users.size < 12) {
        socket.join(roomId);

        room.users.set(socket.id, username);
        console.log("Refershed"+room.usersMoves);
        room.usersMoves.set(socket.id, []);

        io.to(socket.id).emit('joined', roomId);
      } else io.to(socket.id).emit('joined', '', true);
    });

    socket.on('joined_room', () => {
      const roomId = getRoomId();

      const room = rooms.get(roomId);
      if (!room) return;

      io.to(socket.id).emit(
        'room',
        room,
        JSON.stringify([...room.usersMoves]),
        JSON.stringify([...room.users])
      );

      socket.broadcast
        .to(roomId)
        .emit('new_user', socket.id, room.users.get(socket.id) || 'Anonymous');
    });

    socket.on('leave_room', () => {
      const roomId = getRoomId();
      leaveRoom(roomId, socket.id);

      io.to(roomId).emit('user_disconnected', socket.id);
    });

    socket.on('draw', (move:any) => {
      const roomId = getRoomId();

      const timestamp = Date.now();

      // eslint-disable-next-line no-param-reassign
      move.id = v4();
      console.log(move);
      addMove(roomId, socket.id, { ...move, timestamp });
   
        drawings.push({
          strokeId:move.id,
          cX: move.circle.cX,
          cY: move.circle.cY,
          radiusX: move.circle.radiusX,
          radiusY: move.circle.radiusY,  
          width: move.rect.width,
          height: move.rect.height,            
        image: "ffhhhjfjhfhf",         
        path: move.path.toString(),
        mode:move.options.mode,
        shape:move.options.shape
        });


    
      io.to(socket.id).emit('your_move', { ...move, timestamp });

      socket.broadcast
        .to(roomId)
        .emit('user_draw', { ...move, timestamp }, socket.id);
    });


    socket.on('undo', () => {
      const roomId = getRoomId();

      undoMove(roomId, socket.id);
      console.log()
      socket.broadcast.to(roomId).emit('user_undo', socket.id);
    });

    socket.on('mouse_move', (x:any, y:any) => {
      socket.broadcast.to(getRoomId()).emit('mouse_moved', x, y, socket.id);
    });

    socket.on('send_msg', (msg:any) => {
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