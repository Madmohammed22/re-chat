// Generate a random username
const username = `User_${Math.random().toString(36).slice(2, 11)}`;

let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const baseReconnectDelay = 1000; // Start with 1 second delay

function connectWebSocket() {
    ws = new WebSocket('ws://localhost:3000');

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        document.querySelector('.online-status').textContent = '🟢 Connected';
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server');
        document.querySelector('.online-status').textContent = '🔴 Disconnected';
        
        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
            console.log(`Attempting to reconnect in ${delay}ms...`);
            setTimeout(connectWebSocket, delay);
            reconnectAttempts++;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
        console.log('Received message:', event.data);
        const data = JSON.parse(event.data);
        
        if (data.type === 'chat') {
            appendMessage(data.message);
        } else if (data.type === 'history') {
            const messagesDiv = document.getElementById('messages');
            messagesDiv.innerHTML = ''; // Clear existing messages
            data.messages.forEach(msg => appendMessage(msg));
        } else if (data.type === 'reaction') {
            updateMessageReactions(data.messageId, data.reactions);
        }
    };
}

function appendMessage(message) {
    const messagesDiv = document.getElementById('messages');
    const messageItem = document.createElement('li');
    messageItem.className = 'message';
    messageItem.setAttribute('data-message-id', message.id);
    
    const isOwnMessage = message.from.username === username;
    if (isOwnMessage) {
        messageItem.classList.add('own-message');
    }

    const header = document.createElement('div');
    header.className = 'message-header';
    
    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = message.from.username;
    
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(message.date).toLocaleTimeString();
    
    header.appendChild(sender);
    header.appendChild(time);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.message;

    const reactions = document.createElement('div');
    reactions.className = 'message-reactions';

    // Add reaction buttons
    const reactionTypes = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    reactionTypes.forEach(type => {
        const button = document.createElement('button');
        button.className = 'reaction-button';
        button.textContent = type;
        button.onclick = () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'reaction',
                    messageId: message.id,
                    emoji: type,
                    user: username
                }));
            }
        };
        reactions.appendChild(button);
    });

    // Add reaction counters container
    const reactionsCount = document.createElement('div');
    reactionsCount.className = 'reactions-count';
    reactions.appendChild(reactionsCount);

    messageItem.appendChild(header);
    messageItem.appendChild(content);
    messageItem.appendChild(reactions);
    
    messagesDiv.appendChild(messageItem);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Update reactions if any
    if (message.reactions && message.reactions.length > 0) {
        updateMessageReactions(message.id, message.reactions);
    }
}

function updateMessageReactions(messageId, reactions) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const reactionsCountDiv = messageElement.querySelector('.reactions-count');
    if (!reactionsCountDiv) return;

    // Clear existing reaction counters
    reactionsCountDiv.innerHTML = '';

    // Group reactions by emoji
    const reactionCounts = {};
    const reactionUsers = {};
    
    reactions.forEach(reaction => {
        const emoji = reaction.emoji;
        reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        if (!reactionUsers[emoji]) {
            reactionUsers[emoji] = [];
        }
        reactionUsers[emoji].push(reaction.user);
    });

    // Create a counter element for each emoji that has reactions
    Object.entries(reactionCounts).forEach(([emoji, count]) => {
        const counter = document.createElement('div');
        counter.className = 'reaction-counter';
        counter.textContent = `${emoji} ${count}`;
        
        // Add tooltip with user list
        const users = reactionUsers[emoji];
        counter.title = users.join(', ');
        
        // Highlight if current user reacted
        if (users.includes(username)) {
            counter.classList.add('user-reacted');
        }
        
        reactionsCountDiv.appendChild(counter);
    });
}

// Set up form submission
const form = document.getElementById('form');
const input = document.getElementById('input');

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat',
            sender: username,
            message: input.value
        }));
        input.value = '';
    }
});

// Initial connection
connectWebSocket();
