const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*" }
});

let players = {};

io.on('connection', (socket) => {
    console.log('Nouveau capitaine connecté:', socket.id);

    // Création des données du joueur
    players[socket.id] = {
        id: socket.id,
        x: 0, y: 1400,
        angle: -Math.PI/2,
        type: 'BRIG',
        team: 'blue',
        hp: 180
    };

    // Envoyer la liste des joueurs existants au nouveau
    socket.emit('currentPlayers', players);
    
    // Informer les autres qu'un joueur arrive
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Recevoir et renvoyer les mouvements
    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].angle = data.angle;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});