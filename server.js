const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms
const rooms = new Map();

// Store users by their friend code
let users = new Map();

// Store online users by socket id
const onlineUsers = new Map();

// Friends data file path
const FRIENDS_DATA_FILE = path.join(__dirname, 'friends-data.json');

// Load friends data from file on startup
function loadFriendsData() {
    try {
        if (fs.existsSync(FRIENDS_DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(FRIENDS_DATA_FILE, 'utf8'));
            users = new Map(Object.entries(data));
            console.log(`Loaded ${users.size} users from friends-data.json`);
        }
    } catch (err) {
        console.error('Error loading friends data:', err);
    }
}

// Save friends data to file
function saveFriendsData() {
    try {
        const data = Object.fromEntries(users);
        fs.writeFileSync(FRIENDS_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error saving friends data:', err);
    }
}

// Load data on startup
loadFriendsData();

// Save data periodically (every 30 seconds)
setInterval(saveFriendsData, 30000);

// Word list for the game
const words = require('./words.json');

// Room inactivity timeout (15 minutes)
const ROOM_TIMEOUT = 15 * 60 * 1000;

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generateFriendCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getRandomWord() {
    return words[Math.floor(Math.random() * words.length)].toUpperCase();
}

function updateRoomActivity(room) {
    room.lastActivity = Date.now();
    
    // Clear existing timeout
    if (room.inactivityTimeout) {
        clearTimeout(room.inactivityTimeout);
    }
    
    // Set new timeout
    room.inactivityTimeout = setTimeout(() => {
        console.log(`Room ${room.code} closed due to inactivity`);
        io.to(room.code).emit('roomClosed', 'Room closed due to inactivity');
        rooms.delete(room.code);
    }, ROOM_TIMEOUT);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create a new room
    socket.on('createRoom', ({ playerName, maxPlayers, maxRounds }) => {
        let roomCode = generateRoomCode();
        while (rooms.has(roomCode)) {
            roomCode = generateRoomCode();
        }

        const room = {
            code: roomCode,
            host: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                score: 0,
                currentGuess: 0,
                guesses: [],
                hasWonRound: false,
                outOfGuesses: false
            }],
            maxPlayers: maxPlayers || 4,
            maxRounds: maxRounds || 5,
            currentRound: 0,
            currentWord: '',
            gameStarted: false,
            roundInProgress: false,
            lastActivity: Date.now(),
            inactivityTimeout: null
        };

        updateRoomActivity(room);
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit('roomCreated', {
            roomCode,
            players: room.players,
            maxPlayers: room.maxPlayers,
            maxRounds: room.maxRounds,
            isHost: true
        });

        console.log(`Room ${roomCode} created by ${playerName}`);
    });

    // Join an existing room
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms.get(roomCode.toUpperCase());

        if (!room) {
            socket.emit('joinError', 'Room not found');
            return;
        }

        if (room.gameStarted) {
            socket.emit('joinError', 'Game already in progress');
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            socket.emit('joinError', 'Room is full');
            return;
        }

        // Check for duplicate name (case-insensitive)
        const nameTaken = room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (nameTaken) {
            socket.emit('joinError', 'Name already taken in this room');
            return;
        }

        updateRoomActivity(room);

        const player = {
            id: socket.id,
            name: playerName,
            score: 0,
            currentGuess: 0,
            guesses: [],
            hasWonRound: false,
            outOfGuesses: false
        };

        room.players.push(player);
        socket.join(roomCode.toUpperCase());
        socket.roomCode = roomCode.toUpperCase();

        socket.emit('roomJoined', {
            roomCode: room.code,
            players: room.players,
            maxPlayers: room.maxPlayers,
            maxRounds: room.maxRounds,
            isHost: false
        });

        io.to(room.code).emit('playerJoined', {
            players: room.players
        });

        console.log(`${playerName} joined room ${roomCode}`);
    });

    // Start the game
    socket.on('startGame', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.host !== socket.id) return;

        updateRoomActivity(room);

        room.gameStarted = true;
        room.currentRound = 1;
        room.currentWord = getRandomWord();
        room.roundInProgress = true;

        // Reset all players for new game
        room.players.forEach(player => {
            player.score = 0;
            player.currentGuess = 0;
            player.guesses = [];
            player.hasWonRound = false;
            player.outOfGuesses = false;
        });

        io.to(room.code).emit('gameStarted', {
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            players: room.players.map(p => ({ name: p.name, score: p.score }))
        });

        console.log(`Game started in room ${room.code}, word: ${room.currentWord}`);
    });

    // Submit a guess
    socket.on('submitGuess', ({ guess }) => {
        const room = rooms.get(socket.roomCode);
        if (!room || !room.roundInProgress) return;

        updateRoomActivity(room);

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.hasWonRound || player.currentGuess >= 6) return;

        const guessUpper = guess.toUpperCase();
        
        // Validate guess is a real word (basic check - you could add a dictionary)
        if (guessUpper.length !== 5) {
            socket.emit('guessError', 'Word must be 5 letters');
            return;
        }

        // Check if word is in the word list
        if (!words.map(w => w.toUpperCase()).includes(guessUpper)) {
            socket.emit('guessError', 'Not in word list');
            return;
        }

        // Calculate result
        const result = [];
        const wordArray = room.currentWord.split('');
        const guessArray = guessUpper.split('');
        const letterCount = {};

        // Count letters in the target word
        wordArray.forEach(letter => {
            letterCount[letter] = (letterCount[letter] || 0) + 1;
        });

        // First pass: mark correct letters
        guessArray.forEach((letter, i) => {
            if (letter === wordArray[i]) {
                result[i] = 'correct';
                letterCount[letter]--;
            }
        });

        // Second pass: mark present/absent letters
        guessArray.forEach((letter, i) => {
            if (result[i]) return;
            if (letterCount[letter] > 0) {
                result[i] = 'present';
                letterCount[letter]--;
            } else {
                result[i] = 'absent';
            }
        });

        player.guesses.push({ guess: guessUpper, result });
        player.currentGuess++;

        // Send result to the player who guessed
        socket.emit('guessResult', {
            guess: guessUpper,
            result,
            guessNumber: player.currentGuess
        });

        // Update all players about progress
        io.to(room.code).emit('playerProgress', {
            playerId: socket.id,
            playerName: player.name,
            guessNumber: player.currentGuess
        });

        // Check if player won
        if (guessUpper === room.currentWord) {
            player.hasWonRound = true;
            player.score++;

            room.roundInProgress = false;

            io.to(room.code).emit('roundWon', {
                winner: player.name,
                word: room.currentWord,
                players: room.players.map(p => ({ name: p.name, score: p.score }))
            });

            // Check if game is over
            if (room.currentRound >= room.maxRounds) {
                setTimeout(() => endGame(room), 4000);
            } else {
                // Start new round after delay
                setTimeout(() => startNewRound(room), 5000);
            }
        } else {
            // Check if this player ran out of guesses
            if (player.currentGuess >= 6) {
                player.outOfGuesses = true;
                socket.emit('outOfGuesses');
            }

            // Check if all players have exhausted their guesses
            const allDone = room.players.every(p => p.currentGuess >= 6 || p.hasWonRound);
            if (allDone && room.roundInProgress) {
                room.roundInProgress = false;

                io.to(room.code).emit('roundTied', {
                    word: room.currentWord,
                    players: room.players.map(p => ({ name: p.name, score: p.score }))
                });

                if (room.currentRound >= room.maxRounds) {
                    setTimeout(() => endGame(room), 4000);
                } else {
                    setTimeout(() => startNewRound(room), 5000);
                }
            }
        }
    });

    function startNewRound(room) {
        if (!rooms.has(room.code)) return;
        
        room.currentRound++;
        room.currentWord = getRandomWord();
        room.roundInProgress = true;

        room.players.forEach(player => {
            player.currentGuess = 0;
            player.guesses = [];
            player.hasWonRound = false;
            player.outOfGuesses = false;
        });

        io.to(room.code).emit('newRound', {
            currentRound: room.currentRound,
            maxRounds: room.maxRounds,
            players: room.players.map(p => ({ name: p.name, score: p.score }))
        });

        console.log(`New round in room ${room.code}, word: ${room.currentWord}`);
    }

    function endGame(room) {
        if (!rooms.has(room.code)) return;
        
        const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
        const winner = sortedPlayers[0];
        const isTie = sortedPlayers.filter(p => p.score === winner.score).length > 1;

        io.to(room.code).emit('gameOver', {
            winner: isTie ? null : winner.name,
            isTie,
            finalScores: sortedPlayers.map(p => ({ name: p.name, score: p.score }))
        });

        // Reset room for potential new game
        room.gameStarted = false;
        room.currentRound = 0;
        room.currentWord = '';
        room.roundInProgress = false;
    }

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Update online status for friends
        if (onlineUsers.has(socket.id)) {
            const userData = onlineUsers.get(socket.id);
            const user = users.get(userData.friendCode);
            if (user) {
                user.online = false;
                user.socketId = null;
                user.currentRoom = null;
                
                // Notify friends that user went offline
                user.friends.forEach(friendCode => {
                    const friend = users.get(friendCode);
                    if (friend && friend.socketId) {
                        io.to(friend.socketId).emit('friendStatusChanged', {
                            friendCode: userData.friendCode,
                            name: user.name,
                            online: false,
                            away: false,
                            inRoom: null
                        });
                    }
                });
            }
            onlineUsers.delete(socket.id);
        }

        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);

                if (room.players.length === 0) {
                    if (room.inactivityTimeout) {
                        clearTimeout(room.inactivityTimeout);
                    }
                    rooms.delete(socket.roomCode);
                    console.log(`Room ${socket.roomCode} deleted (empty)`);
                } else {
                    // If host left, assign new host
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                        io.to(room.players[0].id).emit('becameHost');
                    }

                    io.to(room.code).emit('playerLeft', {
                        players: room.players
                    });
                }
            }
        }
    });

    // ==================== FRIENDS SYSTEM ====================

    // Register/login user with friend code
    socket.on('registerUser', ({ friendCode, name }) => {
        let user = users.get(friendCode);
        
        if (user) {
            // Existing user - update socket and online status
            user.socketId = socket.id;
            user.online = true;
            if (name && name !== user.name) {
                user.name = name;
            }
        } else if (name) {
            // New user - create account
            let newCode = friendCode || generateFriendCode();
            while (users.has(newCode)) {
                newCode = generateFriendCode();
            }
            
            user = {
                friendCode: newCode,
                name: name,
                socketId: socket.id,
                online: true,
                friends: [],
                pendingRequests: [],
                currentRoom: null
            };
            users.set(newCode, user);
            friendCode = newCode;
            saveFriendsData(); // Save after new user creation
        } else {
            socket.emit('registerError', 'Name is required');
            return;
        }

        onlineUsers.set(socket.id, { friendCode: user.friendCode, name: user.name });

        // Notify friends that user came online
        user.friends.forEach(fc => {
            const friend = users.get(fc);
            if (friend && friend.socketId) {
                io.to(friend.socketId).emit('friendStatusChanged', {
                    friendCode: user.friendCode,
                    name: user.name,
                    online: true,
                    away: user.away || false,
                    inRoom: user.currentRoom
                });
            }
        });

        // Send user their data and friend list
        const friendsList = user.friends.map(fc => {
            const friend = users.get(fc);
            return friend ? {
                friendCode: fc,
                name: friend.name,
                online: friend.online,
                away: friend.away || false,
                inRoom: friend.currentRoom
            } : null;
        }).filter(f => f !== null);

        socket.emit('userRegistered', {
            friendCode: user.friendCode,
            name: user.name,
            friends: friendsList,
            pendingRequests: user.pendingRequests
        });
    });

    // Change username
    socket.on('changeUsername', ({ newUsername }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) {
            socket.emit('usernameError', { message: 'You must be registered first' });
            return;
        }

        // Validate username
        if (!newUsername || newUsername.length < 2) {
            socket.emit('usernameError', { message: 'Username must be at least 2 characters' });
            return;
        }

        if (newUsername.length > 15) {
            socket.emit('usernameError', { message: 'Username must be 15 characters or less' });
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
            socket.emit('usernameError', { message: 'Username can only contain letters, numbers, and underscores' });
            return;
        }

        // Check if username already exists (case-insensitive)
        const lowerNewUsername = newUsername.toLowerCase();
        for (const [code, user] of users) {
            if (code !== userData.friendCode && user.name.toLowerCase() === lowerNewUsername) {
                socket.emit('usernameError', { message: 'This username is already taken' });
                return;
            }
        }

        // Update username
        const user = users.get(userData.friendCode);
        if (user) {
            const oldName = user.name;
            user.name = newUsername;
            userData.name = newUsername;
            saveFriendsData();

            // Notify friends about the name change
            user.friends.forEach(fc => {
                const friend = users.get(fc);
                if (friend && friend.socketId) {
                    io.to(friend.socketId).emit('friendStatusChanged', {
                        friendCode: userData.friendCode,
                        name: newUsername,
                        online: true,
                        away: user.away || false,
                        inRoom: user.currentRoom
                    });
                }
            });

            socket.emit('usernameChanged', { newUsername: newUsername });
            console.log(`User ${oldName} changed username to ${newUsername}`);
        }
    });

    // Refresh friend code
    socket.on('refreshFriendCode', () => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) {
            socket.emit('friendError', 'You must be registered first');
            return;
        }

        const oldCode = userData.friendCode;
        const user = users.get(oldCode);
        if (!user) {
            socket.emit('friendError', 'User not found');
            return;
        }

        // Generate new unique code
        let newCode = generateFriendCode();
        while (users.has(newCode)) {
            newCode = generateFriendCode();
        }

        // Remove old code from users map
        users.delete(oldCode);

        // Update user with new code
        user.friendCode = newCode;
        users.set(newCode, user);

        // Update onlineUsers
        onlineUsers.set(socket.id, { friendCode: newCode, name: user.name });

        // Update all friends' friend lists (replace old code with new)
        user.friends.forEach(fc => {
            const friend = users.get(fc);
            if (friend) {
                const idx = friend.friends.indexOf(oldCode);
                if (idx !== -1) {
                    friend.friends[idx] = newCode;
                }
                // Notify online friends of the code change
                if (friend.socketId) {
                    io.to(friend.socketId).emit('friendCodeChanged', {
                        oldCode: oldCode,
                        newCode: newCode,
                        name: user.name
                    });
                }
            }
        });

        // Send new code to user
        socket.emit('friendCodeRefreshed', { newCode });
        saveFriendsData(); // Save after friend code refresh
    });

    // Send friend request
    socket.on('sendFriendRequest', ({ targetCode }) => {
        const senderData = onlineUsers.get(socket.id);
        if (!senderData) {
            socket.emit('friendError', 'You must be registered first');
            return;
        }

        const sender = users.get(senderData.friendCode);
        const target = users.get(targetCode.toUpperCase());

        if (!target) {
            socket.emit('friendError', 'User not found');
            return;
        }

        if (targetCode.toUpperCase() === senderData.friendCode) {
            socket.emit('friendError', "You can't add yourself");
            return;
        }

        if (sender.friends.includes(targetCode.toUpperCase())) {
            socket.emit('friendError', 'Already friends');
            return;
        }

        if (target.pendingRequests.some(r => r.friendCode === senderData.friendCode)) {
            socket.emit('friendError', 'Request already sent');
            return;
        }

        // Add to pending requests
        target.pendingRequests.push({
            friendCode: senderData.friendCode,
            name: sender.name
        });

        // Notify target if online
        if (target.socketId) {
            io.to(target.socketId).emit('friendRequestReceived', {
                friendCode: senderData.friendCode,
                name: sender.name
            });
        }

        socket.emit('friendRequestSent', { targetCode: targetCode.toUpperCase() });
        saveFriendsData(); // Save after friend request sent
    });

    // Accept friend request
    socket.on('acceptFriendRequest', ({ friendCode }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        const friend = users.get(friendCode);

        if (!user || !friend) return;

        // Remove from pending
        user.pendingRequests = user.pendingRequests.filter(r => r.friendCode !== friendCode);

        // Add to both friends lists
        if (!user.friends.includes(friendCode)) {
            user.friends.push(friendCode);
        }
        if (!friend.friends.includes(userData.friendCode)) {
            friend.friends.push(userData.friendCode);
        }

        // Notify both users
        socket.emit('friendAdded', {
            friendCode: friendCode,
            name: friend.name,
            online: friend.online,
            inRoom: friend.currentRoom
        });

        if (friend.socketId) {
            io.to(friend.socketId).emit('friendAdded', {
                friendCode: userData.friendCode,
                name: user.name,
                online: user.online,
                inRoom: user.currentRoom
            });
        }

        saveFriendsData(); // Save after friend added
    });

    // Decline friend request
    socket.on('declineFriendRequest', ({ friendCode }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        if (!user) return;

        user.pendingRequests = user.pendingRequests.filter(r => r.friendCode !== friendCode);
        socket.emit('friendRequestDeclined', { friendCode });
        saveFriendsData(); // Save after declining request
    });

    // Remove friend
    socket.on('removeFriend', ({ friendCode }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        const friend = users.get(friendCode);

        if (!user) return;

        // Remove from user's friends list
        user.friends = user.friends.filter(fc => fc !== friendCode);

        // Remove from friend's friends list (if they exist)
        if (friend) {
            friend.friends = friend.friends.filter(fc => fc !== userData.friendCode);
            
            // Notify the other user if online
            if (friend.socketId) {
                io.to(friend.socketId).emit('friendRemoved', { friendCode: userData.friendCode });
            }
        }

        socket.emit('friendRemoved', { friendCode });
        saveFriendsData(); // Save after removing friend
    });

    // Update away status (tab visibility)
    socket.on('updateAwayStatus', ({ away }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        if (!user) return;

        user.away = away;

        // Notify friends of status change
        user.friends.forEach(fc => {
            const friend = users.get(fc);
            if (friend && friend.socketId) {
                io.to(friend.socketId).emit('friendStatusChanged', {
                    friendCode: userData.friendCode,
                    name: user.name,
                    online: user.online,
                    away: user.away,
                    inRoom: user.currentRoom
                });
            }
        });
    });

    // Invite friend to room
    socket.on('inviteFriend', ({ friendCode }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        const friend = users.get(friendCode);

        if (!user || !friend || !friend.socketId) {
            socket.emit('friendError', 'Friend is offline');
            return;
        }

        if (!socket.roomCode) {
            socket.emit('friendError', 'You are not in a room');
            return;
        }

        const room = rooms.get(socket.roomCode);
        if (!room) {
            socket.emit('friendError', 'Room not found');
            return;
        }

        if (room.gameStarted) {
            socket.emit('friendError', 'Game already in progress');
            return;
        }

        io.to(friend.socketId).emit('gameInvite', {
            fromName: user.name,
            fromCode: userData.friendCode,
            roomCode: socket.roomCode
        });

        socket.emit('inviteSent', { friendCode });
    });

    // Send chat message to friend
    socket.on('sendChatMessage', ({ toFriendCode, message }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        const friend = users.get(toFriendCode);

        if (!user || !friend) {
            return;
        }

        // Make sure they are friends
        if (!user.friends.includes(toFriendCode)) {
            return;
        }

        // Sanitize message
        const cleanMessage = message.substring(0, 200).trim();
        if (!cleanMessage) return;

        // If friend is online, send message
        if (friend.socketId) {
            io.to(friend.socketId).emit('chatMessage', {
                fromCode: userData.friendCode,
                fromName: user.name,
                message: cleanMessage
            });
        }
    });

    // Update user's room status
    socket.on('updateRoomStatus', ({ roomCode }) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;

        const user = users.get(userData.friendCode);
        if (!user) return;

        user.currentRoom = roomCode;

        // Notify friends
        user.friends.forEach(fc => {
            const friend = users.get(fc);
            if (friend && friend.socketId) {
                io.to(friend.socketId).emit('friendStatusChanged', {
                    friendCode: userData.friendCode,
                    name: user.name,
                    online: true,
                    away: user.away || false,
                    inRoom: roomCode
                });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown - save data before exit
process.on('SIGINT', () => {
    console.log('\nSaving friends data before shutdown...');
    saveFriendsData();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nSaving friends data before shutdown...');
    saveFriendsData();
    process.exit(0);
});

process.on('exit', () => {
    saveFriendsData();
});
