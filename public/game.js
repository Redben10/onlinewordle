// Socket connection
const socket = io();

// Game state
let isHost = false;
let currentGuess = '';
let currentRow = 0;
let gameActive = false;
let keyboardState = {};
let isWaitingOnPlayers = false;
let hasWonCurrentRound = false;

// DOM Elements
const screens = {
    home: document.getElementById('home-screen'),
    createRoom: document.getElementById('create-room-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    initKeyboard();
    checkGlobalName();
});

// Check if user has set their name
function checkGlobalName() {
    const savedName = localStorage.getItem('playerName');
    if (!savedName) {
        showNamePopup();
    }
}

// Show global name popup
function showNamePopup() {
    document.getElementById('name-popup').classList.add('active');
    document.getElementById('global-name-input').focus();
}

// Save global name
function saveGlobalName() {
    const name = document.getElementById('global-name-input').value.trim();
    
    if (!name) {
        document.getElementById('global-name-error').textContent = 'Please enter a name';
        return;
    }
    
    if (name.length < 2) {
        document.getElementById('global-name-error').textContent = 'Name must be at least 2 characters';
        return;
    }
    
    myName = name;
    localStorage.setItem('playerName', name);
    document.getElementById('name-popup').classList.remove('active');
    
    // Register with server to get friend code
    socket.emit('registerUser', { name: myName });
}

function initEventListeners() {
    // Home screen buttons
    document.getElementById('create-room-btn').addEventListener('click', () => {
        showScreen('create-room-screen');
    });

    document.getElementById('join-room-btn').addEventListener('click', () => {
        openJoinModal();
    });

    // Create room
    document.getElementById('confirm-create-btn').addEventListener('click', createRoom);

    // Join room
    document.getElementById('confirm-join-btn').addEventListener('click', joinRoom);

    // Start game
    document.getElementById('start-game-btn').addEventListener('click', () => {
        socket.emit('startGame');
    });

    // Physical keyboard
    document.addEventListener('keydown', handleKeyDown);

    // Close modal on outside click
    document.getElementById('join-modal').addEventListener('click', (e) => {
        if (e.target.id === 'join-modal') {
            closeJoinModal();
        }
    });

    // Enter key for inputs
    document.getElementById('room-code-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    // Global name popup
    document.getElementById('save-global-name-btn').addEventListener('click', saveGlobalName);
    document.getElementById('global-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveGlobalName();
    });
}

function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function openJoinModal() {
    document.getElementById('join-modal').classList.add('active');
    document.getElementById('join-error').textContent = '';
    document.getElementById('room-code-input').value = '';
    document.getElementById('room-code-input').focus();
}

function closeJoinModal() {
    document.getElementById('join-modal').classList.remove('active');
}

function createRoom() {
    const playerName = myName || localStorage.getItem('playerName');
    const maxPlayers = parseInt(document.getElementById('max-players').value);
    const maxRounds = parseInt(document.getElementById('max-rounds').value);

    if (!playerName) {
        showNamePopup();
        return;
    }

    socket.emit('createRoom', { playerName, maxPlayers, maxRounds });
}

function joinRoom() {
    const playerName = myName || localStorage.getItem('playerName');
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (!playerName) {
        showNamePopup();
        return;
    }

    if (!roomCode) {
        document.getElementById('join-error').textContent = 'Please enter a room code';
        return;
    }

    socket.emit('joinRoom', { roomCode, playerName });
}

// Show round winner animation
function showRoundWinnerAnimation(winner, word, isTie = false) {
    const overlay = document.getElementById('round-winner-overlay');
    const content = overlay.querySelector('.round-winner-content');
    const trophy = overlay.querySelector('.trophy');
    const text = document.getElementById('round-winner-text');
    const subtext = document.getElementById('round-winner-subtext');

    if (isTie) {
        trophy.textContent = '🤝';
        text.textContent = "It's a Tie!";
        subtext.textContent = `No one got the word: ${word}`;
        content.classList.add('tie');
        content.classList.remove('win');
    } else {
        trophy.textContent = '🏆';
        text.textContent = `${winner} wins!`;
        subtext.textContent = `The word was: ${word}`;
        content.classList.add('win');
        content.classList.remove('tie');
    }

    overlay.classList.add('active');

    // Hide after 3.5 seconds
    setTimeout(() => {
        overlay.classList.remove('active');
    }, 3500);
}

// Socket event handlers
socket.on('roomCreated', (data) => {
    isHost = true;
    updateLobby(data);
    showScreen('lobby-screen');
    document.getElementById('start-game-btn').style.display = 'block';
    document.getElementById('waiting-message').style.display = 'none';
});

socket.on('roomJoined', (data) => {
    isHost = false;
    closeJoinModal();
    updateLobby(data);
    showScreen('lobby-screen');
    document.getElementById('start-game-btn').style.display = 'none';
    document.getElementById('waiting-message').style.display = 'block';
});

// Handle joining a game that's already in progress
socket.on('joinedMidGame', (data) => {
    isHost = false;
    closeJoinModal();
    gameActive = true;
    currentGuess = '';
    currentRow = 0;
    keyboardState = {};
    isWaitingOnPlayers = false;
    hasWonCurrentRound = false;
    
    showScreen('game-screen');
    initGameBoard();
    updateRoundInfo(data.currentRound, data.maxRounds);
    updateScoreboard(data.players);
    
    if (data.isSpectator) {
        // Disable input for spectators
        showMessage('Spectating this round. You\'ll play next round!', 'info');
        // Gray out the game board for spectators
        document.querySelectorAll('.key').forEach(key => {
            key.style.opacity = '0.5';
            key.style.pointerEvents = 'none';
        });
    } else {
        showMessage('Game in progress! Start guessing!', 'info');
    }
});

socket.on('joinError', (message) => {
    document.getElementById('join-error').textContent = message;
});

socket.on('playerJoined', (data) => {
    updatePlayersList(data.players);
});

socket.on('playerLeft', (data) => {
    updatePlayersList(data.players);
});

socket.on('becameHost', () => {
    isHost = true;
    document.getElementById('start-game-btn').style.display = 'block';
    document.getElementById('waiting-message').style.display = 'none';
});

socket.on('roomClosed', (message) => {
    alert(message);
    location.reload();
});

socket.on('gameStarted', (data) => {
    gameActive = true;
    currentGuess = '';
    currentRow = 0;
    keyboardState = {};
    isWaitingOnPlayers = false;
    hasWonCurrentRound = false;
    
    showScreen('game-screen');
    initGameBoard();
    updateRoundInfo(data.currentRound, data.maxRounds);
    updateScoreboard(data.players);
    showMessage('Game started! Guess the word!', 'info');
    
    // Reset keyboard colors
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('correct', 'present', 'absent');
    });
});

socket.on('guessResult', (data) => {
    const row = document.querySelectorAll('.row')[data.guessNumber - 1];
    const tiles = row.querySelectorAll('.tile');
    
    // Check if this guess was correct (all tiles are 'correct')
    const isCorrectGuess = data.result.every(status => status === 'correct');
    if (isCorrectGuess) {
        hasWonCurrentRound = true;
    }
    
    // Animate tiles with results
    data.result.forEach((status, index) => {
        setTimeout(() => {
            tiles[index].classList.add('reveal');
            setTimeout(() => {
                tiles[index].classList.add(status);
                updateKeyboardKey(data.guess[index], status);
            }, 250);
        }, index * 300);
    });

    currentRow = data.guessNumber;
    currentGuess = '';
});

socket.on('guessError', (message) => {
    showMessage(message, 'error');
    shakeCurrentRow();
});

socket.on('outOfGuesses', () => {
    isWaitingOnPlayers = true;
    gameActive = false;
    showMessage('Waiting on other players...', 'waiting');
});

socket.on('playerProgress', (data) => {
    // Could show other players' progress here
});

socket.on('roundWon', (data) => {
    gameActive = false;
    isWaitingOnPlayers = false;
    updateScoreboard(data.players);
    
    // Show the correct word on the board only for players who didn't get it
    if (!hasWonCurrentRound) {
        revealCorrectWord(data.word);
    }
    
    // Show the winner animation
    showRoundWinnerAnimation(data.winner, data.word, false);
});

socket.on('roundTied', (data) => {
    gameActive = false;
    isWaitingOnPlayers = false;
    updateScoreboard(data.players);
    
    // Show tie animation
    showRoundWinnerAnimation(null, data.word, true);
});

socket.on('newRound', (data) => {
    gameActive = true;
    currentGuess = '';
    currentRow = 0;
    keyboardState = {};
    isWaitingOnPlayers = false;
    hasWonCurrentRound = false;
    
    initGameBoard();
    updateRoundInfo(data.currentRound, data.maxRounds);
    updateScoreboard(data.players);
    showMessage('New round! Guess the word!', 'info');
    
    // Reset keyboard colors and re-enable keys (in case was spectating)
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('correct', 'present', 'absent');
        key.style.opacity = '';
        key.style.pointerEvents = '';
    });
});

socket.on('gameOver', (data) => {
    showScreen('gameover-screen');
    
    const announcement = document.getElementById('winner-announcement');
    if (data.isTie) {
        announcement.textContent = "It's a tie!";
    } else {
        announcement.textContent = `🏆 ${data.winner} wins! 🏆`;
    }
    
    const scoreList = document.getElementById('final-score-list');
    scoreList.innerHTML = '';
    data.finalScores.forEach((player, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${index + 1}. ${player.name}</span><span>${player.score} pts</span>`;
        scoreList.appendChild(li);
    });
    
    // Set up play again button
    document.getElementById('play-again-btn').onclick = () => {
        socket.emit('returnToLobby');
    };
});

// Return to lobby after game over
socket.on('returnedToLobby', (data) => {
    showScreen('lobby-screen');
    updateLobby(data);
    
    // Update host status
    isHost = data.isHost;
    const startBtn = document.getElementById('start-game-btn');
    if (isHost) {
        startBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'none';
    }
});

// UI Functions
function updateLobby(data) {
    document.getElementById('display-room-code').textContent = data.roomCode;
    document.getElementById('round-settings').textContent = `${data.maxPlayers} players, ${data.maxRounds} rounds`;
    updatePlayersList(data.players);
}

function updatePlayersList(players) {
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    players.forEach((player, index) => {
        const li = document.createElement('li');
        li.textContent = player.name;
        if (index === 0) li.classList.add('host');
        list.appendChild(li);
    });
}

function initGameBoard() {
    const board = document.getElementById('game-board');
    board.innerHTML = '';
    
    for (let i = 0; i < 6; i++) {
        const row = document.createElement('div');
        row.classList.add('row');
        
        for (let j = 0; j < 5; j++) {
            const tile = document.createElement('div');
            tile.classList.add('tile');
            row.appendChild(tile);
        }
        
        board.appendChild(row);
    }
}

function initKeyboard() {
    const keyboard = document.getElementById('keyboard');
    keyboard.innerHTML = '';
    
    const rows = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']
    ];
    
    rows.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.classList.add('keyboard-row');
        
        row.forEach(key => {
            const keyBtn = document.createElement('button');
            keyBtn.classList.add('key');
            keyBtn.textContent = key;
            keyBtn.setAttribute('data-key', key);
            
            if (key === 'ENTER' || key === '⌫') {
                keyBtn.classList.add('large');
            }
            
            keyBtn.addEventListener('click', () => handleKeyPress(key));
            rowDiv.appendChild(keyBtn);
        });
        
        keyboard.appendChild(rowDiv);
    });
}

function handleKeyDown(e) {
    if (!gameActive || isWaitingOnPlayers) return;
    
    if (e.key === 'Enter') {
        handleKeyPress('ENTER');
    } else if (e.key === 'Backspace') {
        handleKeyPress('⌫');
    } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKeyPress(e.key.toUpperCase());
    }
}

function handleKeyPress(key) {
    if (!gameActive || currentRow >= 6 || isWaitingOnPlayers) return;
    
    if (key === 'ENTER') {
        if (currentGuess.length === 5) {
            socket.emit('submitGuess', { guess: currentGuess });
        } else {
            showMessage('Not enough letters', 'error');
            shakeCurrentRow();
        }
    } else if (key === '⌫') {
        if (currentGuess.length > 0) {
            currentGuess = currentGuess.slice(0, -1);
            updateCurrentRow();
        }
    } else if (currentGuess.length < 5) {
        currentGuess += key;
        updateCurrentRow();
    }
}

function updateCurrentRow() {
    const row = document.querySelectorAll('.row')[currentRow];
    if (!row) return;
    const tiles = row.querySelectorAll('.tile');
    
    tiles.forEach((tile, index) => {
        if (index < currentGuess.length) {
            tile.textContent = currentGuess[index];
            tile.classList.add('filled');
        } else {
            tile.textContent = '';
            tile.classList.remove('filled');
        }
    });
}

function updateKeyboardKey(letter, status) {
    const key = document.querySelector(`.key[data-key="${letter}"]`);
    if (!key) return;
    
    // Only upgrade status (absent -> present -> correct)
    const currentStatus = keyboardState[letter];
    if (currentStatus === 'correct') return;
    if (currentStatus === 'present' && status === 'absent') return;
    
    key.classList.remove('correct', 'present', 'absent');
    key.classList.add(status);
    keyboardState[letter] = status;
}

function updateRoundInfo(current, total) {
    document.getElementById('current-round').textContent = current;
    document.getElementById('total-rounds').textContent = total;
}

function updateScoreboard(players) {
    const list = document.getElementById('score-list');
    list.innerHTML = '';
    
    const sorted = [...players].sort((a, b) => b.score - a.score);
    sorted.forEach(player => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="player-name">${player.name}</span><span class="player-score">${player.score}</span>`;
        list.appendChild(li);
    });
}

function showMessage(text, type) {
    const message = document.getElementById('game-message');
    message.textContent = text;
    message.className = 'game-message ' + type;
    
    // Don't auto-clear waiting message
    if (type === 'waiting') return;
    
    setTimeout(() => {
        if (message.textContent === text) {
            message.textContent = '';
            message.className = 'game-message';
        }
    }, 3000);
}

function shakeCurrentRow() {
    const row = document.querySelectorAll('.row')[currentRow];
    if (!row) return;
    row.classList.add('shake');
    setTimeout(() => row.classList.remove('shake'), 500);
}

// Reveal the correct word on the next empty row for players who didn't guess it
function revealCorrectWord(word) {
    const rows = document.querySelectorAll('.row');
    
    // Find the next empty row (currentRow)
    if (currentRow < 6) {
        const row = rows[currentRow];
        const tiles = row.querySelectorAll('.tile');
        
        // Fill in the word with correct styling
        word.split('').forEach((letter, index) => {
            setTimeout(() => {
                tiles[index].textContent = letter;
                tiles[index].classList.add('reveal', 'correct');
            }, index * 150);
        });
    }
}

// ========== Friends System ==========

// Friends state
let myFriendCode = localStorage.getItem('friendCode') || null;
let myName = localStorage.getItem('playerName') || '';
let friends = JSON.parse(localStorage.getItem('friends') || '[]');
let pendingRequests = JSON.parse(localStorage.getItem('pendingRequests') || '[]');
let currentRoomCode = null;

// Initialize friends system
function initFriendsSystem() {
    // Friends button click
    document.getElementById('friends-btn').addEventListener('click', openFriendsModal);
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Send friend request
    document.getElementById('send-request-btn').addEventListener('click', sendFriendRequest);
    
    // Friend code input - enter key
    document.getElementById('friend-code-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendFriendRequest();
    });
    
    // Close modal on outside click
    document.getElementById('friends-modal').addEventListener('click', (e) => {
        if (e.target.id === 'friends-modal') {
            closeFriendsModal();
        }
    });
    
    // Register user if we have saved credentials
    if (myFriendCode && myName) {
        socket.emit('registerUser', { friendCode: myFriendCode, name: myName });
    } else if (myName) {
        // Has name but no friend code yet
        socket.emit('registerUser', { name: myName });
    }
    
    // Send initial away status so friends see correct status immediately
    socket.emit('updateAwayStatus', { away: document.hidden });
    
    updateFriendsBadge();
}

// Update friends modal display
function updateFriendsModalView() {
    if (myFriendCode) {
        document.getElementById('my-friend-code').textContent = myFriendCode;
    }
    if (myName) {
        document.getElementById('display-profile-name').textContent = myName;
    }
}

// Open friends modal
function openFriendsModal() {
    // Check if user has set their name first
    if (!myName) {
        showNamePopup();
        return;
    }
    
    document.getElementById('friends-modal').classList.add('active');
    document.getElementById('add-friend-error').textContent = '';
    document.getElementById('add-friend-success').textContent = '';
    document.getElementById('friend-code-input').value = '';
    
    updateFriendsModalView();
    renderFriendsList();
    renderRequestsList();
    switchTab('friends-list');
}

// Close friends modal
function closeFriendsModal() {
    document.getElementById('friends-modal').classList.remove('active');
}

// Open settings modal
function openSettingsModal() {
    document.getElementById('settings-modal').classList.add('active');
    document.getElementById('settings-username').value = '';
    document.getElementById('settings-error').textContent = '';
    document.getElementById('settings-success').textContent = '';
    
    // Update current info display
    document.getElementById('current-username-display').textContent = myName || '-';
    document.getElementById('current-friendcode-display').textContent = myFriendCode || '-';
}

// Close settings modal
function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}

// Save username
function saveUsername() {
    const newUsername = document.getElementById('settings-username').value.trim();
    const errorEl = document.getElementById('settings-error');
    const successEl = document.getElementById('settings-success');
    
    errorEl.textContent = '';
    successEl.textContent = '';
    
    if (!newUsername) {
        errorEl.textContent = 'Please enter a username';
        return;
    }
    
    if (newUsername.length < 2) {
        errorEl.textContent = 'Username must be at least 2 characters';
        return;
    }
    
    if (newUsername.length > 15) {
        errorEl.textContent = 'Username must be 15 characters or less';
        return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
        errorEl.textContent = 'Username can only contain letters, numbers, and underscores';
        return;
    }
    
    // Send to server for validation
    socket.emit('changeUsername', { newUsername: newUsername });
}

// Handle username change response
socket.on('usernameChanged', (data) => {
    myName = data.newUsername;
    localStorage.setItem('playerName', myName);
    
    document.getElementById('settings-success').textContent = 'Username changed successfully!';
    document.getElementById('settings-error').textContent = '';
    document.getElementById('current-username-display').textContent = myName;
    document.getElementById('display-profile-name').textContent = myName;
    
    // Clear input
    document.getElementById('settings-username').value = '';
});

socket.on('usernameError', (data) => {
    document.getElementById('settings-error').textContent = data.message;
    document.getElementById('settings-success').textContent = '';
});

// Close settings modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') {
        closeSettingsModal();
    }
});

// Switch tabs
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

// Refresh friend code
function refreshFriendCode() {
    if (!myFriendCode) return;
    
    if (confirm('Are you sure you want to get a new friend code? Your existing friends will still have you, but anyone you shared your old code with won\'t be able to add you.')) {
        socket.emit('refreshFriendCode');
    }
}

// Send friend request
function sendFriendRequest() {
    const code = document.getElementById('friend-code-input').value.trim().toUpperCase();
    document.getElementById('add-friend-error').textContent = '';
    document.getElementById('add-friend-success').textContent = '';
    
    if (!code || code.length !== 6) {
        document.getElementById('add-friend-error').textContent = 'Please enter a valid 6-digit code';
        return;
    }
    
    if (code === myFriendCode) {
        document.getElementById('add-friend-error').textContent = "You can't add yourself!";
        return;
    }
    
    socket.emit('sendFriendRequest', { targetCode: code });
}

// Render friends list
function renderFriendsList() {
    const list = document.getElementById('friends-list-ul');
    const noFriendsMsg = document.getElementById('no-friends-msg');
    list.innerHTML = '';
    
    if (friends.length === 0) {
        noFriendsMsg.style.display = 'block';
        return;
    }
    
    noFriendsMsg.style.display = 'none';
    
    friends.forEach(friend => {
        const li = document.createElement('li');
        li.className = 'friend-item';
        
        // Determine status class: online (green), away (yellow), offline (no color)
        let statusClass = '';
        let statusText = 'Offline';
        if (friend.online) {
            if (friend.away) {
                statusClass = 'away';
                statusText = 'Away';
            } else if (friend.inRoom) {
                statusClass = 'online';
                statusText = 'In Game';
            } else {
                statusClass = 'online';
                statusText = 'Online';
            }
        }
        
        li.innerHTML = `
            <div class="friend-info">
                <div class="online-status ${statusClass}"></div>
                <div>
                    <div class="friend-name">${friend.name}</div>
                    <div class="friend-status">${statusText}</div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="message-btn" onclick="openChatModal('${friend.friendCode}', '${friend.name}')" title="Message">💬</button>
                ${friend.online && currentRoomCode ? 
                    `<button class="invite-btn" onclick="inviteFriend('${friend.friendCode}')" title="Invite to game">+</button>` : 
                    '<button class="invite-btn" disabled title="Invite to game">+</button>'}
                <button class="remove-btn" onclick="removeFriend('${friend.friendCode}')" title="Remove friend">✕</button>
            </div>
        `;
        list.appendChild(li);
    });
}

// Render requests list
function renderRequestsList() {
    const list = document.getElementById('requests-list-ul');
    const noRequestsMsg = document.getElementById('no-requests-msg');
    list.innerHTML = '';
    
    if (pendingRequests.length === 0) {
        noRequestsMsg.style.display = 'block';
        return;
    }
    
    noRequestsMsg.style.display = 'none';
    
    pendingRequests.forEach(request => {
        const li = document.createElement('li');
        li.className = 'request-item';
        li.innerHTML = `
            <div class="request-info">
                <div class="friend-name">${request.name}</div>
            </div>
            <div class="request-actions">
                <button class="btn-small accept" onclick="acceptRequest('${request.friendCode}')">✓</button>
                <button class="btn-small decline" onclick="declineRequest('${request.friendCode}')">✕</button>
            </div>
        `;
        list.appendChild(li);
    });
    
    // Update tab badge
    const badge = document.getElementById('requests-count');
    badge.textContent = pendingRequests.length > 0 ? pendingRequests.length : '';
}

// Accept friend request
function acceptRequest(friendCode) {
    socket.emit('acceptFriendRequest', { friendCode: friendCode });
}

// Decline friend request
function declineRequest(friendCode) {
    socket.emit('declineFriendRequest', { friendCode: friendCode });
    
    // Remove from local list
    pendingRequests = pendingRequests.filter(r => r.friendCode !== friendCode);
    localStorage.setItem('pendingRequests', JSON.stringify(pendingRequests));
    renderRequestsList();
    updateFriendsBadge();
}

// Remove friend
function removeFriend(friendCode) {
    if (confirm('Are you sure you want to remove this friend?')) {
        socket.emit('removeFriend', { friendCode: friendCode });
        
        // Remove from local list
        friends = friends.filter(f => f.friendCode !== friendCode);
        localStorage.setItem('friends', JSON.stringify(friends));
        renderFriendsList();
    }
}

// Invite friend to game
function inviteFriend(friendCode) {
    if (currentRoomCode) {
        socket.emit('inviteFriend', { friendCode, roomCode: currentRoomCode });
        // Provide feedback
        const btns = document.querySelectorAll('.invite-btn');
        btns.forEach(btn => {
            if (btn.onclick && btn.onclick.toString().includes(friendCode)) {
                btn.textContent = '✓';
                btn.disabled = true;
                setTimeout(() => {
                    btn.textContent = '+';
                    btn.disabled = false;
                }, 3000);
            }
        });
    }
}

// Chat system
let currentChatFriend = null;
let chatMessages = JSON.parse(localStorage.getItem('chatMessages')) || {}; // Store messages by friend code

// Save chat messages to localStorage
function saveChatMessages() {
    localStorage.setItem('chatMessages', JSON.stringify(chatMessages));
}

// Open chat modal
function openChatModal(friendCode, friendName) {
    currentChatFriend = { friendCode, name: friendName };
    document.getElementById('chat-friend-name').textContent = friendName;
    document.getElementById('chat-modal').classList.add('active');
    document.getElementById('chat-input').value = '';
    
    // Load messages for this friend
    if (!chatMessages[friendCode]) {
        chatMessages[friendCode] = [];
    }
    
    renderChatMessages();
    
    // Focus input
    document.getElementById('chat-input').focus();
}

// Close chat modal
function closeChatModal() {
    document.getElementById('chat-modal').classList.remove('active');
    currentChatFriend = null;
}

// Render chat messages
function renderChatMessages() {
    const container = document.getElementById('chat-messages');
    const messages = chatMessages[currentChatFriend?.friendCode] || [];
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="chat-empty">No messages yet. Say hello! 👋</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.sent ? 'sent' : 'received'}">
            ${msg.text}
            <span class="message-time">${msg.time}</span>
        </div>
    `).join('');
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Send chat message
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    
    if (!text || !currentChatFriend) return;
    
    // Send to server
    socket.emit('sendChatMessage', {
        toFriendCode: currentChatFriend.friendCode,
        message: text
    });
    
    // Add to local messages
    addChatMessage(currentChatFriend.friendCode, text, true);
    
    input.value = '';
    input.focus();
}

// Add message to chat (local)
function addChatMessage(friendCode, text, sent) {
    if (!chatMessages[friendCode]) {
        chatMessages[friendCode] = [];
    }
    
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    chatMessages[friendCode].push({
        text: text,
        sent: sent,
        time: time
    });
    
    // Keep only last 15 messages
    if (chatMessages[friendCode].length > 15) {
        chatMessages[friendCode].shift();
    }
    
    // Save to localStorage
    saveChatMessages();
    
    // Re-render if this chat is open
    if (currentChatFriend && currentChatFriend.friendCode === friendCode) {
        renderChatMessages();
    }
}

// Handle Enter key in chat input
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }
});

// Close chat modal on outside click
document.addEventListener('click', (e) => {
    if (e.target.id === 'chat-modal') {
        closeChatModal();
    }
});

// Update friends badge
function updateFriendsBadge() {
    const badge = document.getElementById('friends-badge');
    if (pendingRequests.length > 0) {
        badge.textContent = pendingRequests.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// Show friend request notification
function showFriendRequestNotification(from) {
    const notification = document.getElementById('friend-notification');
    const message = document.getElementById('notification-message');
    message.textContent = `${from.name} wants to be your friend!`;
    
    // Store current request info for buttons
    notification.dataset.fromCode = from.friendCode;
    notification.dataset.fromName = from.name;
    
    // Set up accept/decline buttons
    document.getElementById('accept-request-btn').onclick = () => {
        acceptRequest(from.friendCode);
        closeNotification();
    };
    document.getElementById('decline-request-btn').onclick = () => {
        declineRequest(from.friendCode);
        closeNotification();
    };
    
    notification.classList.add('show');
    
    // Auto-hide after 15 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 15000);
}

// Show game invite notification
function showGameInviteNotification(from, roomCode) {
    const notification = document.getElementById('invite-notification');
    const message = document.getElementById('invite-message');
    message.textContent = `${from} invited you to play!`;
    
    document.getElementById('accept-invite-btn').onclick = () => {
        // Join the room
        const name = myName || prompt('Enter your name:');
        if (name) {
            socket.emit('joinRoom', { roomCode, playerName: name });
        }
        notification.classList.remove('show');
    };
    document.getElementById('decline-invite-btn').onclick = () => {
        notification.classList.remove('show');
    };
    
    notification.classList.add('show');
    
    // Auto-hide after 30 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 30000);
}

// Close notification
function closeNotification() {
    document.getElementById('friend-notification').classList.remove('show');
}

// Socket events for friends system
socket.on('userRegistered', (data) => {
    myFriendCode = data.friendCode;
    localStorage.setItem('friendCode', data.friendCode);
    document.getElementById('my-friend-code').textContent = data.friendCode;
    
    // Update local friends with any saved data from server
    if (data.friends) {
        friends = data.friends;
        localStorage.setItem('friends', JSON.stringify(friends));
    }
    if (data.pendingRequests) {
        pendingRequests = data.pendingRequests;
        localStorage.setItem('pendingRequests', JSON.stringify(pendingRequests));
    }
    
    // Update the modal view to show main content
    updateFriendsModalView();
    
    updateFriendsBadge();
    renderFriendsList();
    renderRequestsList();
});

socket.on('friendRequestSent', () => {
    document.getElementById('friend-code-input').value = '';
    document.getElementById('add-friend-success').textContent = 'Friend request sent!';
});

socket.on('friendRequestError', (message) => {
    document.getElementById('add-friend-error').textContent = message;
});

socket.on('friendCodeRefreshed', (data) => {
    myFriendCode = data.newCode;
    localStorage.setItem('friendCode', data.newCode);
    document.getElementById('my-friend-code').textContent = data.newCode;
    
    // Visual feedback
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.textContent = '✓';
        setTimeout(() => refreshBtn.textContent = '🔄', 2000);
    }
});

socket.on('friendCodeChanged', (data) => {
    // A friend changed their code - update local storage
    const friend = friends.find(f => f.friendCode === data.oldCode);
    if (friend) {
        friend.friendCode = data.newCode;
        localStorage.setItem('friends', JSON.stringify(friends));
        renderFriendsList();
    }
});

socket.on('friendRequestReceived', (from) => {
    // Add to pending requests
    if (!pendingRequests.find(r => r.friendCode === from.friendCode)) {
        pendingRequests.push(from);
        localStorage.setItem('pendingRequests', JSON.stringify(pendingRequests));
    }
    
    updateFriendsBadge();
    renderRequestsList();
    showFriendRequestNotification(from);
});

socket.on('friendAdded', (friend) => {
    // Remove from pending requests
    pendingRequests = pendingRequests.filter(r => r.friendCode !== friend.friendCode);
    localStorage.setItem('pendingRequests', JSON.stringify(pendingRequests));
    
    // Add to friends list
    if (!friends.find(f => f.friendCode === friend.friendCode)) {
        friends.push(friend);
        localStorage.setItem('friends', JSON.stringify(friends));
    }
    
    updateFriendsBadge();
    renderFriendsList();
    renderRequestsList();
});

socket.on('friendStatusChanged', (data) => {
    const friend = friends.find(f => f.friendCode === data.friendCode);
    if (friend) {
        friend.online = data.online;
        friend.away = data.away;
        friend.inRoom = data.inRoom;
        localStorage.setItem('friends', JSON.stringify(friends));
        renderFriendsList();
    }
});

socket.on('gameInvite', (data) => {
    showGameInviteNotification(data.fromName, data.roomCode);
});

socket.on('chatMessage', (data) => {
    // Received a chat message from a friend
    addChatMessage(data.fromCode, data.message, false);
    
    // Show notification if chat is not open with this friend
    if (!currentChatFriend || currentChatFriend.friendCode !== data.fromCode) {
        showChatNotification(data.fromName, data.fromCode);
    }
});

// Show chat notification
function showChatNotification(fromName, fromCode) {
    // Remove any existing chat notification
    const existingNotification = document.querySelector('.chat-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'chat-notification';
    notification.innerHTML = `
        <div class="chat-notification-content">
            <span class="chat-notification-icon">💬</span>
            <span>New message from <strong>${fromName}</strong></span>
        </div>
        <button class="chat-notification-close">×</button>
    `;
    
    document.body.appendChild(notification);
    
    // Click on notification opens chat
    notification.querySelector('.chat-notification-content').addEventListener('click', () => {
        notification.remove();
        openChatModal(fromCode, fromName);
    });
    
    // Close button
    notification.querySelector('.chat-notification-close').addEventListener('click', (e) => {
        e.stopPropagation();
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    });
    
    // Animate in
    setTimeout(() => notification.classList.add('show'), 10);
}

socket.on('friendRemoved', (data) => {
    // Someone removed us as a friend, or we removed them
    friends = friends.filter(f => f.friendCode !== data.friendCode);
    localStorage.setItem('friends', JSON.stringify(friends));
    renderFriendsList();
});

// Update room code tracking
socket.on('roomCreated', (data) => {
    currentRoomCode = data.roomCode;
    
    // Update room status for friends
    socket.emit('updateRoomStatus', { inRoom: true, roomCode: currentRoomCode });
});

socket.on('roomJoined', (data) => {
    currentRoomCode = data.roomCode;
    
    // Update room status for friends
    socket.emit('updateRoomStatus', { inRoom: true, roomCode: currentRoomCode });
});

// Clear room status when leaving
window.addEventListener('beforeunload', () => {
    if (currentRoomCode) {
        socket.emit('updateRoomStatus', { inRoom: false, roomCode: null });
    }
});

// Track tab visibility for away status
document.addEventListener('visibilitychange', () => {
    const isAway = document.hidden;
    socket.emit('updateAwayStatus', { away: isAway });
});

// Initialize friends system on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initFriendsSystem();
});
