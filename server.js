// ============================================================
//  server.js  —  Multiplayer Game Hub  (UNO Edition)
//  Stack: Node.js + Express + Socket.io
// ============================================================

const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const path     = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────────────────────

const publicQueue = { tictactoe: null, ludo: null, uno: null };
const rooms = {};
const socketRoom = {};

// ─────────────────────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────────────────────

function makeCode(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function uniqueCode() {
  let c; do { c = makeCode(); } while (rooms[c]); return c;
}

function leaveCurrentRoom(socket) {
  const roomId = socketRoom[socket.id];
  if (!roomId) return;
  const room = rooms[roomId];
  delete socketRoom[socket.id];
  if (!room) return;

  room.players = room.players.filter(p => p.id !== socket.id);
  socket.leave(roomId);

  for (const gt of ["tictactoe", "ludo", "uno"]) {
    if (publicQueue[gt]?.socketId === socket.id) publicQueue[gt] = null;
  }

  if (room.players.length === 0) { delete rooms[roomId]; return; }

  io.to(roomId).emit("playerLeft", {
    socketId: socket.id,
    players: room.players.map(p => p.id),
  });

  if (room.started) {
    room.started = false;
    if (room.gameType === "tictactoe") {
      initTTTState(room);
      io.to(roomId).emit("gameReset", { reason: "Opponent disconnected. Waiting for new player…" });
    } else if (room.gameType === "uno") {
      io.to(roomId).emit("gameReset", { reason: "A player disconnected. Game ended." });
    } else {
      io.to(roomId).emit("gameReset", { reason: "A player disconnected." });
    }
  } else {
    broadcastLobbyState(room);
  }
}

/** Unified lobby snapshot for host + joiners (private / public queue rooms). */
function broadcastLobbyState(room) {
  if (!room || room.started || room.players.length === 0) return;
  const hostId = room.players[0].id;
  const minToStart = 2;
  const count = room.players.length;
  const max = room.maxPlayers;

  for (const p of room.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    const isHost = p.id === hostId;
    const canStart = isHost && count >= minToStart;
    let message;
    if (room.gameType === "tictactoe") {
      message = count >= 2
        ? "Opponent found — starting…"
        : isHost
          ? "Share your room code — waiting for opponent"
          : "Waiting for another player…";
    } else if (isHost) {
      message = canStart
        ? `Ready to start (${count}/${max} players)`
        : `Waiting for players (${count}/${max})`;
    } else {
      message = `Waiting for host to start (${count}/${max})`;
    }
    sock.emit("lobbyState", {
      roomId: room.id,
      gameType: room.gameType,
      isHost,
      canStart,
      count,
      max,
      hostId,
      message,
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  TIC-TAC-TOE
// ─────────────────────────────────────────────────────────────

function initTTTState(room) {
  room.gameState = { board: Array(9).fill(null), currentTurn: null, symbols: {} };
}

function startTTT(room) {
  initTTTState(room);
  const [p0, p1] = room.players;
  room.gameState.symbols = { [p0.id]: "X", [p1.id]: "O" };
  room.gameState.currentTurn = p0.id;
  room.started = true;
  io.to(room.id).emit("gameStart", {
    game: "tictactoe",
    board: room.gameState.board,
    currentTurn: room.gameState.currentTurn,
    symbols: room.gameState.symbols,
  });
}

function checkTTTWinner(board) {
  const line = getTTTWinLine(board);
  return line ? board[line[0]] : null;
}

function getTTTWinLine(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return [a, b, c];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//  LUDO
// ─────────────────────────────────────────────────────────────

const LUDO_COLORS = ["red","blue","green","yellow"];
const PIECES_EACH = 4;
const ENTRY_POS   = { red: 0, blue: 13, green: 26, yellow: 39 };
const HOME_ENTRY  = { red: 51, blue: 12, green: 25, yellow: 38 };
const SAFE_SQ     = new Set([0,8,13,21,26,34,39,47]);

function makePieces(colorIdx) {
  return Array.from({ length: PIECES_EACH }, (_, pi) => ({
    id: `${LUDO_COLORS[colorIdx]}-${pi}`,
    color: LUDO_COLORS[colorIdx],
    pos: -1,
    homeSteps: 0,
    finished: false,
  }));
}

function initLudoState(room) {
  const colors = room.players.map((_, i) => LUDO_COLORS[i]);
  const pieces = {};
  colors.forEach((c, i) => { pieces[c] = makePieces(i); });
  room.gameState = {
    colors, pieces,
    turnOrder: room.players.map(p => p.id),
    turnIdx: 0,
    currentTurn: room.players[0].id,
    diceValue: null,
    mustRoll: true,
    extraTurn: false,
    winner: null,
  };
}

function startLudo(room) {
  initLudoState(room);
  room.started = true;
  io.to(room.id).emit("gameStart", {
    game: "ludo",
    state: getLudoState(room),
    colorMap: buildColorMap(room),
  });
}

function buildColorMap(room) {
  const m = {};
  room.players.forEach((p, i) => { m[p.id] = LUDO_COLORS[i]; });
  return m;
}

function getLudoState(room) {
  const gs = room.gameState;
  return {
    colors: gs.colors, pieces: gs.pieces,
    currentTurn: gs.currentTurn, diceValue: gs.diceValue,
    mustRoll: gs.mustRoll, winner: gs.winner,
    turnOrder: gs.turnOrder, colorMap: buildColorMap(room),
  };
}

function hasLegalMove(room, socketId) {
  const gs = room.gameState;
  const idx = gs.turnOrder.indexOf(socketId);
  if (idx === -1) return false;
  const color = LUDO_COLORS[idx];
  const dice = gs.diceValue;
  for (const p of gs.pieces[color]) {
    if (p.finished) continue;
    if (p.pos === -1 && dice === 6) return true;
    if (p.pos === -1) continue;
    if (p.homeSteps > 0) { if (p.homeSteps + dice <= 6) return true; continue; }
    const color_home_entry = HOME_ENTRY[color];
    let steps = dice, cur = p.pos, overshoot = false;
    for (let s = 0; s < steps; s++) {
      if (cur === color_home_entry) {
        const remaining = steps - s - 1;
        if (1 + remaining > 6) { overshoot = true; break; }
        return true;
      }
      cur = (cur + 1) % 52;
    }
    if (!overshoot) return true;
  }
  return false;
}

function applyLudoMove(room, socketId, pieceId) {
  const gs = room.gameState;
  const idx = gs.turnOrder.indexOf(socketId);
  if (idx === -1) return { err: "not your turn" };
  const color = LUDO_COLORS[idx];
  if (gs.mustRoll) return { err: "roll first" };
  if (!gs.diceValue) return { err: "no dice" };
  const pieces = gs.pieces[color];
  const piece = pieces.find(p => p.id === pieceId);
  if (!piece || piece.finished) return { err: "invalid piece" };
  const dice = gs.diceValue;
  if (piece.pos === -1) {
    if (dice !== 6) return { err: "need 6 to enter board" };
    piece.pos = ENTRY_POS[color];
    return { ok: true, entered: true };
  }
  if (piece.homeSteps > 0) {
    if (piece.homeSteps + dice > 6) return { err: "overshoot" };
    piece.homeSteps += dice;
    if (piece.homeSteps === 6) {
      piece.finished = true;
      const allDone = pieces.every(p => p.finished);
      return { ok: true, finished: true, allDone };
    }
    return { ok: true };
  }
  const homeEntry = HOME_ENTRY[color];
  let captured = false;
  let cur = piece.pos;
  for (let s = 0; s < dice; s++) {
    if (cur === homeEntry) {
      const stepsLeft = dice - s - 1;
      const homePos = 1 + stepsLeft;
      if (homePos > 6) return { err: "overshoot home" };
      piece.pos = -2;
      piece.homeSteps = homePos;
      if (homePos === 6) {
        piece.finished = true;
        const allDone = pieces.every(p => p.finished);
        return { ok: true, finished: true, allDone };
      }
      return { ok: true };
    }
    cur = (cur + 1) % 52;
  }
  if (!SAFE_SQ.has(cur)) {
    for (const [oc, ops] of Object.entries(gs.pieces)) {
      if (oc === color) continue;
      for (const op of ops) {
        if (!op.finished && op.homeSteps === 0 && op.pos === cur) {
          op.pos = -1;
          captured = true;
        }
      }
    }
  }
  piece.pos = cur;
  return { ok: true, captured };
}

function advanceLudoTurn(room) {
  const gs = room.gameState;
  if (gs.diceValue === 6 && !gs.extraTurn) {
    gs.extraTurn = true;
  } else {
    gs.extraTurn = false;
    gs.turnIdx = (gs.turnIdx + 1) % gs.turnOrder.length;
    gs.currentTurn = gs.turnOrder[gs.turnIdx];
  }
  gs.diceValue = null;
  gs.mustRoll = true;
}

// ─────────────────────────────────────────────────────────────
//  UNO
// ─────────────────────────────────────────────────────────────
const UnoEngine = require("./public/uno-engine.js");

function startUno(room) {
  room.gameState = new UnoEngine();
  room.players.forEach(p => room.gameState.addPlayer(p.id));
  room.gameState.startGame();
  room.started = true;
  broadcastUnoState(room, "gameStart", { game: "uno" });
}

function broadcastUnoState(room, event, extra = {}) {
  const theme = room.cardTheme || "classic";
  for (const p of room.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) {
      sock.emit(event, { ...extra, state: room.gameState.getState(p.id), cardTheme: theme });
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────────────────────────

io.on("connection", socket => {
  console.log(`[+] ${socket.id}`);

  // ── Public matchmaking ──
  socket.on("joinPublic", ({ gameType, maxPlayers: reqMax, cardTheme }) => {
    if (!["tictactoe","ludo","uno"].includes(gameType)) return;
    leaveCurrentRoom(socket);

    let maxP = gameType === "tictactoe" ? 2 : 4;
    if ((gameType === "uno" || gameType === "ludo") && reqMax) maxP = Math.min(4, Math.max(2, parseInt(reqMax, 10) || 4));
    const minP = gameType === "tictactoe" ? 2 : 2;
    const waiting = publicQueue[gameType];

    if (waiting && waiting.socketId !== socket.id &&
        io.sockets.sockets.get(waiting.socketId)) {
      const roomId = waiting.roomId;
      publicQueue[gameType] = null;
      const room = rooms[roomId];
      room.players.push({ id: socket.id });
      socket.join(roomId);
      socketRoom[socket.id] = roomId;
      io.to(roomId).emit("lobbyPaired", { roomId, gameType });

      if (gameType === "tictactoe") startTTT(room);
      else if (gameType === "uno") startUno(room);
      else io.to(roomId).emit("ludoLobbyUpdate", { players: room.players.length, max: maxP, canStart: true });
    } else {
      const roomId = uniqueCode();
      rooms[roomId] = {
        id: roomId, gameType, mode: "public",
        players: [{ id: socket.id }],
        maxPlayers: maxP, started: false, gameState: null,
        cardTheme: gameType === "uno" ? (cardTheme || "classic") : null,
      };
      socket.join(roomId);
      socketRoom[socket.id] = roomId;
      publicQueue[gameType] = { socketId: socket.id, roomId };
      socket.emit("lobbyWaiting", { roomId, gameType });
    }
  });

  // ── Host private room ──
  socket.on("hostRoom", ({ gameType, maxPlayers: reqMax, cardTheme }) => {
    if (!["tictactoe","ludo","uno"].includes(gameType)) return;
    leaveCurrentRoom(socket);

    let maxP = gameType === "tictactoe" ? 2 : 4;
    if ((gameType === "uno" || gameType === "ludo") && reqMax) maxP = Math.min(4, Math.max(2, parseInt(reqMax, 10) || 4));
    const roomId = uniqueCode();
    rooms[roomId] = {
      id: roomId, gameType, mode: "friend",
      players: [{ id: socket.id }],
      maxPlayers: maxP, started: false, gameState: null,
      cardTheme: gameType === "uno" ? (cardTheme || "classic") : null,
    };
    socket.join(roomId);
    socketRoom[socket.id] = roomId;
    socket.emit("roomCreated", { roomId, gameType });
    broadcastLobbyState(rooms[roomId]);
  });

  // ── Join private room ──
  socket.on("joinRoom", ({ roomId, gameType }) => {
    const code = (roomId || "").toUpperCase().trim();
    const room = rooms[code];
    if (!room)                               return socket.emit("roomError", { msg: "Room not found." });
    if (room.gameType !== gameType)          return socket.emit("roomError", { msg: "Wrong game type." });
    if (room.players.length >= room.maxPlayers) return socket.emit("roomError", { msg: "Room is full." });
    if (room.started)                        return socket.emit("roomError", { msg: "Game already started." });

    leaveCurrentRoom(socket);
    room.players.push({ id: socket.id });
    socket.join(code);
    socketRoom[socket.id] = code;

    io.to(code).emit("playerJoined", {
      players: room.players.map(p => p.id),
      count: room.players.length,
      max: room.maxPlayers,
    });

    if (gameType === "tictactoe" && room.players.length === 2) {
      startTTT(room);
    } else {
      broadcastLobbyState(room);
      if (gameType === "ludo" && room.players.length >= 2) {
        io.to(code).emit("ludoLobbyUpdate", { players: room.players.length, max: room.maxPlayers, canStart: true });
      } else if (gameType === "uno" && room.players.length >= 2) {
        io.to(code).emit("unoLobbyUpdate", { players: room.players.length, max: room.maxPlayers, canStart: true });
      }
    }
  });

  // ── Ludo: host starts ──
  socket.on("ludoStartGame", () => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "ludo") return;
    if (room.players[0].id !== socket.id) return socket.emit("roomError", { msg: "Only host can start." });
    if (room.players.length < 2) return socket.emit("roomError", { msg: "Need at least 2 players." });
    startLudo(room);
  });

  // ── UNO: host starts ──
  socket.on("unoStartGame", () => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno") return;
    if (room.players[0].id !== socket.id) return socket.emit("roomError", { msg: "Only host can start." });
    if (room.players.length < 2) return socket.emit("roomError", { msg: "Need at least 2 players." });
    startUno(room);
  });

  // ── TTT move ──
  socket.on("tttMove", ({ index }) => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "tictactoe" || !room.started) return;

    const gs = room.gameState;
    if (gs.currentTurn !== socket.id || gs.board[index] !== null) return;

    gs.board[index] = gs.symbols[socket.id];
    const winner = checkTTTWinner(gs.board);

    if (winner) {
      io.to(roomId).emit("tttUpdate", { board: gs.board, currentTurn: null, lastIndex: index });
      io.to(roomId).emit("gameOver", {
        winner: socket.id, symbol: winner,
        winLine: getTTTWinLine(gs.board), lastIndex: index,
      });
      room.started = false;
    } else if (gs.board.every(Boolean)) {
      io.to(roomId).emit("tttUpdate", { board: gs.board, currentTurn: null, lastIndex: index });
      io.to(roomId).emit("gameOver", { winner: null, symbol: null, lastIndex: index });
      room.started = false;
    } else {
      gs.currentTurn = room.players.find(p => p.id !== socket.id).id;
      io.to(roomId).emit("tttUpdate", { board: gs.board, currentTurn: gs.currentTurn, lastIndex: index });
    }
  });

  socket.on("tttRematch", () => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "tictactoe") return;
    if (room.players.length < 2) return socket.emit("roomError", { msg: "Need 2 players for rematch." });
    startTTT(room);
  });

  // ── Ludo: roll ──
  socket.on("ludoRoll", () => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "ludo" || !room.started) return;
    const gs = room.gameState;
    if (gs.currentTurn !== socket.id || !gs.mustRoll) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    gs.diceValue = dice;
    gs.mustRoll = false;
    const canMove = hasLegalMove(room, socket.id);
    io.to(roomId).emit("ludoDiceRolled", { roller: socket.id, dice, state: getLudoState(room), canMove });

    if (!canMove) {
      setTimeout(() => {
        advanceLudoTurn(room);
        io.to(roomId).emit("ludoStateUpdate", { state: getLudoState(room), skipMsg: "No moves — turn skipped." });
      }, 1400);
    }
  });

  // ── Ludo: move ──
  socket.on("ludoMove", ({ pieceId }) => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.gameType !== "ludo" || !room.started) return;
    const gs = room.gameState;
    if (gs.currentTurn !== socket.id) return;
    if (gs.mustRoll) return socket.emit("roomError", { msg: "Roll the dice first!" });

    const result = applyLudoMove(room, socket.id, pieceId);
    if (result.err) return socket.emit("roomError", { msg: result.err });

    if (result.allDone) {
      gs.winner = socket.id;
      io.to(roomId).emit("gameOver", { winner: socket.id, game: "ludo", state: getLudoState(room) });
      room.started = false;
      return;
    }
    advanceLudoTurn(room);
    io.to(roomId).emit("ludoStateUpdate", { state: getLudoState(room), lastMove: { pieceId, result } });
  });

  // ── UNO: play card ──
  socket.on("unoPlayCard", ({ cardId }) => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;
    
    const success = room.gameState.playCard(socket.id, cardId);
    if (!success) return socket.emit("unoError", { msg: "Invalid move!" });

    if (room.gameState.winner) {
      room.started = false;
      broadcastUnoState(room, "unoUpdate", { action: "win", playerId: socket.id });
      io.to(roomId).emit("gameOver", { winner: socket.id, game: "uno" });
    } else {
      broadcastUnoState(room, "unoUpdate", { action: "play", playerId: socket.id });
    }
  });

  // ── UNO: draw card ──
  socket.on("unoDrawCard", () => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.acceptDraw(socket.id);
    if (!success) return socket.emit("unoError", { msg: "Cannot draw now!" });

    broadcastUnoState(room, "unoUpdate", { action: "draw", playerId: socket.id });
  });

  // ── UNO: choose color ──
  socket.on("unoChooseColor", ({ color }) => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.chooseColor(socket.id, color);
    if (!success) return socket.emit("unoError", { msg: "Invalid color choice!" });

    broadcastUnoState(room, "unoUpdate", { action: "color", playerId: socket.id, color });
  });

  // ── UNO: choose swap ──
  socket.on("unoChooseSwap", ({ targetId }) => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.chooseSwap(socket.id, targetId);
    if (!success) return socket.emit("unoError", { msg: "Invalid swap target!" });

    broadcastUnoState(room, "unoUpdate", { action: "swap", playerId: socket.id, targetId });
    if (room.gameState.winner) {
      room.started = false;
      io.to(roomId).emit("gameOver", { winner: room.gameState.winner, game: "uno" });
    }
  });

  // ── UNO: call UNO ──
  socket.on("unoCallUno", () => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.callUno(socket.id);
    if (success) broadcastUnoState(room, "unoUpdate", { action: "uno", playerId: socket.id });
  });

  // ── UNO: challenge Wild +4
  socket.on("unoChallengeWild4", ({ challenge }) => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.challengeWild4(socket.id, !!challenge);
    if (!success) return socket.emit("unoError", { msg: "Cannot challenge now." });

    broadcastUnoState(room, "unoUpdate", {
      action: challenge ? "challenge" : "accept4",
      playerId: socket.id,
    });
    if (room.gameState.winner) {
      room.started = false;
      io.to(roomId).emit("gameOver", { winner: room.gameState.winner, game: "uno" });
    }
  });

  // ── UNO: catch UNO failure ──
  socket.on("unoCatchUno", ({ targetId }) => {
    const roomId = socketRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.gameType !== "uno" || !room.started) return;

    const success = room.gameState.catchUno(socket.id, targetId);
    if (success) broadcastUnoState(room, "unoUpdate", { action: "catch", playerId: socket.id, targetId });
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    console.log(`[-] ${socket.id}`);
    leaveCurrentRoom(socket);
  });
});

// ─────────────────────────────────────────────────────────────
server.listen(PORT, () => console.log(`\n🎮  Game Hub → http://localhost:${PORT}\n`));
