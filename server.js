const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---- In-memory state ----
let queue = [];
let currentServing = null;
let isRegistrationOpen = true;
let nextNumber = 1;

const ADMIN_PASSWORD = 'admin123'; // keep as is – no UI hint

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function broadcastState() {
    io.emit('state-update', {
        queue,
        currentServing,
        isRegistrationOpen,
    });
}

io.on('connection', (socket) => {
    console.log('🟢 Client connected:', socket.id);

    socket.emit('state-update', { queue, currentServing, isRegistrationOpen });

    // ---- Registration: no name/phone required ----
    socket.on('register', ({ name, phone }) => {
        if (!isRegistrationOpen) {
            socket.emit('registration-response', {
                success: false,
                message: 'Registration is currently closed.',
            });
            return;
        }

        // Assign a number without storing any personal data
        const number = nextNumber++;
        const participant = {
            id: generateId(),
            number,
            name: name || 'Anonymous',   // fallback
            phone: phone || '',
            status: 'waiting',
            registeredAt: new Date().toISOString(),
        };
        queue.push(participant);
        broadcastState();

        socket.emit('registration-response', {
            success: true,
            number,
            name: participant.name,
            message: `Registered #${number}`,
        });

        io.emit('server-toast', {
            message: `📋 #${number} — ${participant.name} registered`,
            type: 'info',
        });
    });

    // ---- Admin actions (unchanged) ----
    socket.on('admin-call-next', () => {
        const next = queue.find(q => q.status === 'waiting');
        if (!next) {
            socket.emit('admin-action-response', {
                success: false,
                message: 'No one is waiting.',
            });
            return;
        }
        next.status = 'called';
        next.calledAt = new Date().toISOString();
        currentServing = { number: next.number, name: next.name };
        broadcastState();
        io.emit('server-toast', {
            message: `📢 #${next.number} — ${next.name} , please proceed!`,
            type: 'success',
        });
        socket.emit('admin-action-response', {
            success: true,
            message: `Called #${next.number}`,
        });
    });

    socket.on('admin-call', ({ id }) => {
        const item = queue.find(q => q.id === id);
        if (!item || item.status !== 'waiting') {
            socket.emit('admin-action-response', {
                success: false,
                message: 'Participant not waiting.',
            });
            return;
        }
        item.status = 'called';
        item.calledAt = new Date().toISOString();
        currentServing = { number: item.number, name: item.name };
        broadcastState();
        io.emit('server-toast', {
            message: `📢 #${item.number} — ${item.name} , please proceed!`,
            type: 'success',
        });
        socket.emit('admin-action-response', {
            success: true,
            message: `Called #${item.number}`,
        });
    });

    socket.on('admin-complete', ({ id }) => {
        const item = queue.find(q => q.id === id);
        if (!item || item.status !== 'called') {
            socket.emit('admin-action-response', {
                success: false,
                message: 'Participant is not in "called" state.',
            });
            return;
        }
        item.status = 'completed';
        item.completedAt = new Date().toISOString();
        if (currentServing && currentServing.number === item.number) {
            currentServing = null;
        }
        broadcastState();
        io.emit('server-toast', {
            message: `✅ #${item.number} — ${item.name} completed.`,
            type: 'success',
        });
        socket.emit('admin-action-response', {
            success: true,
            message: `Completed #${item.number}`,
        });
    });

    socket.on('admin-cancel', ({ id }) => {
        const item = queue.find(q => q.id === id);
        if (!item) {
            socket.emit('admin-action-response', {
                success: false,
                message: 'Participant not found.',
            });
            return;
        }
        item.status = 'cancelled';
        if (currentServing && currentServing.number === item.number) {
            currentServing = null;
        }
        broadcastState();
        io.emit('server-toast', {
            message: `✕ #${item.number} — ${item.name} removed.`,
            type: 'error',
        });
        socket.emit('admin-action-response', {
            success: true,
            message: `Removed #${item.number}`,
        });
    });

    socket.on('admin-toggle-reg', () => {
        isRegistrationOpen = !isRegistrationOpen;
        broadcastState();
        io.emit('server-toast', {
            message: isRegistrationOpen ? 'Registration opened.' : 'Registration closed.',
            type: 'info',
        });
    });

    socket.on('admin-reset', () => {
        queue = [];
        currentServing = null;
        nextNumber = 1;
        broadcastState();
        io.emit('server-toast', {
            message: '🔄 Queue has been reset.',
            type: 'error',
        });
    });

    socket.on('get-state', () => {
        socket.emit('state-update', { queue, currentServing, isRegistrationOpen });
    });

    socket.on('disconnect', () => {
        console.log('🔴 Client disconnected:', socket.id);
    });
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Queue state: ${queue.length} participants`);
    console.log(`🔢 Next number: ${nextNumber}`);
    console.log(`📌 Registration: ${isRegistrationOpen ? 'OPEN' : 'CLOSED'}`);
});