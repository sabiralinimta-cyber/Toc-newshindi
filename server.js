// Tic Tac Toe – OpenRouter proxy server
//
// This server keeps your OpenRouter API key private. The browser never
// sees it — it only talks to this server, and this server talks to
// OpenRouter using the key from an environment variable.
//
// SET UP:
//   1. Copy .env.example to .env
//   2. Put your real OpenRouter key and model in .env (never commit .env!)
//   3. npm install
//   4. npm start
//
// The frontend (public/index.html) calls POST /api/move on this server.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';

if (!OPENROUTER_API_KEY) {
  console.warn(
    '\n⚠️  WARNING: OPENROUTER_API_KEY is not set.\n' +
    '   Create a .env file (see .env.example) with your real key before deploying.\n'
  );
}

// Board -> text grid, same format the frontend used to build itself
function boardToPrompt(board) {
  const cells = board.map((v, i) => (v ? v : String(i)));
  return (
    cells[0] + ' | ' + cells[1] + ' | ' + cells[2] + '\n' +
    cells[3] + ' | ' + cells[4] + ' | ' + cells[5] + '\n' +
    cells[6] + ' | ' + cells[7] + ' | ' + cells[8]
  );
}

app.post('/api/move', async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'Server is missing OPENROUTER_API_KEY.' });
    }

    const { board } = req.body;
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'Invalid board.' });
    }

    const emptyCells = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
    if (emptyCells.length === 0) {
      return res.status(400).json({ error: 'No empty cells.' });
    }

    const prompt =
      'You are playing O in a game of Tic Tac Toe against a human playing X. ' +
      'Board cells are numbered 0-8, left to right, top to bottom. ' +
      'Current board (numbers = empty cells):\n' + boardToPrompt(board) + '\n' +
      'Empty cells available: ' + emptyCells.join(', ') + '\n' +
      'Choose the single best empty cell number for O to play. ' +
      'Reply with ONLY the number, nothing else.';

    const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + OPENROUTER_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
      }),
    });

    if (!orResponse.ok) {
      const text = await orResponse.text();
      console.error('OpenRouter error:', orResponse.status, text);
      return res.status(502).json({ error: 'OpenRouter request failed.' });
    }

    const data = await orResponse.json();
    const text = data.choices?.[0]?.message?.content || '';
    const match = text.match(/[0-8]/);
    let move = -1;
    if (match && emptyCells.includes(parseInt(match[0], 10))) {
      move = parseInt(match[0], 10);
    } else {
      // Fallback so the game never gets stuck if the model replies oddly
      move = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    }

    res.json({ move });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/* ============================================================
   ONLINE MULTIPLAYER (Socket.IO)
   Rooms are held in memory only — fine for a small game like this.
   ============================================================ */
const rooms = {}; // code -> { players: [socketId, socketId], board, turn, symbols: {socketId: 'X'|'O'} }

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWinner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('create-room', () => {
    const code = makeRoomCode();
    rooms[code] = {
      players: [socket.id],
      board: Array(9).fill(null),
      turn: 'X',
      symbols: { [socket.id]: 'X' },
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room-created', { code, symbol: 'X' });
  });

  socket.on('join-room', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('join-error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('join-error', { message: 'Room is full.' });

    room.players.push(socket.id);
    room.symbols[socket.id] = 'O';
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('room-joined', { code, symbol: 'O' });
    io.to(code).emit('start-game', { turn: room.turn });
  });

  socket.on('make-move', ({ index }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const symbol = room.symbols[socket.id];
    if (!symbol || room.turn !== symbol) return; // not your turn
    if (room.board[index]) return; // already filled

    room.board[index] = symbol;
    const winner = checkWinner(room.board);
    const isDraw = !winner && room.board.every((c) => c);
    room.turn = symbol === 'X' ? 'O' : 'X';

    io.to(code).emit('opponent-move', { index, symbol, winner, isDraw });

    if (winner || isDraw) {
      // round over; clients will call reset-round to play again
    }
  });

  socket.on('reset-round', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.board = Array(9).fill(null);
    room.turn = 'X';
    io.to(code).emit('round-reset', { turn: room.turn });
  });

  // --- WebRTC signaling relay (voice chat between the two players) ---
  socket.on('webrtc-offer', (payload) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit('webrtc-offer', payload);
  });
  socket.on('webrtc-answer', (payload) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit('webrtc-answer', payload);
  });
  socket.on('webrtc-ice-candidate', (payload) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit('webrtc-ice-candidate', payload);
  });
  socket.on('mic-state', (payload) => {
    const code = socket.data.roomCode;
    if (code) socket.to(code).emit('mic-state', payload);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms[code]) {
      socket.to(code).emit('opponent-left');
      delete rooms[code];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Tic Tac Toe proxy server running on http://localhost:${PORT}`);
});
