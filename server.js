// server.js (Render)
let players = {};
io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id, ready: false };
    io.emit('lobbyUpdate', Object.keys(players).length);

    socket.on('playerReady', (status) => {
        players[socket.id].ready = status;
        let allReady = Object.values(players).every(p => p.ready);
        if (allReady && Object.keys(players).length >= 2) {
            io.emit('startGameMulti');
        }
    });
    // ... reste de la logique movement ...
});
