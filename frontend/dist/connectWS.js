let messageCache = [];
const chatState = {
    isInitialLoad: true,
    lastScrollPosition: 0,
    lastScrollHeight: 0,
    lastMessageId: ''
};
// DOM Elements
const chatLog = document.getElementById("messages");
if (!chatLog)
    throw new Error("Could not find messages element");
const messageInput = document.getElementById("input");
if (!messageInput)
    throw new Error("Could not find input element");
const sendForm = document.getElementById("form");
if (!sendForm)
    throw new Error("Could not find form element");
// WebSocket setup
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
console.log(wsUrl);
const ws = new WebSocket(wsUrl);
// User management
let currentUser = localStorage.getItem("chatUserId");
if (!currentUser) {
    currentUser = "User_" + Math.random().toString(36).slice(2, 11);
    localStorage.setItem("chatUserId", currentUser);
}
// Save scroll state
function saveScrollState() {
    if (!chatState.isInitialLoad) {
        const lastMessage = messageCache[messageCache.length - 1];
        if (!lastMessage)
            return;
        const scrollInfo = {
            position: chatLog.scrollTop,
            height: chatLog.scrollHeight,
            messageId: lastMessage.id.toString()
        };
        localStorage.setItem('chatScrollState', JSON.stringify(scrollInfo));
    }
}
// Restore scroll state
async function restoreScrollState() {
    try {
        const savedState = localStorage.getItem('chatScrollState');
        if (!savedState)
            return false;
        const { position, height, messageId } = JSON.parse(savedState);
        if (!messageId)
            return false;
        const lastMessage = messageCache[messageCache.length - 1];
        if (!lastMessage || lastMessage.id.toString() !== messageId) {
            return false;
        }
        const ratio = position / height;
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                chatLog.scrollTop = Math.round(chatLog.scrollHeight * ratio);
                resolve(true);
            });
        });
    }
    catch (e) {
        console.error('Error restoring scroll state:', e);
        return false;
    }
}
// Scroll event handling with debounce
let scrollTimeout;
chatLog.addEventListener('scroll', () => {
    if (scrollTimeout) {
        window.clearTimeout(scrollTimeout);
    }
    scrollTimeout = window.setTimeout(saveScrollState, 100);
});
// Save state before unload
window.addEventListener('beforeunload', saveScrollState);
// WebSocket event handlers
ws.addEventListener("open", () => {
    console.log("Connected to WebSocket server");
    updateOnlineStatus(true);
    updateUserCount(currentUser);
});
ws.addEventListener("close", () => {
    console.log("Disconnected from WebSocket server");
    updateOnlineStatus(false);
});
ws.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    updateOnlineStatus(false);
});
ws.addEventListener("message", async (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log("Received message:", data);
        switch (data.type) {
            case "history": {
                const historyData = data;
                if (!chatState.isInitialLoad) {
                    saveScrollState();
                }
                // Clear and sort messages
                chatLog.innerHTML = "";
                // Ensure dates are properly parsed and messages are sorted by both date and ID
                messageCache = historyData.messages
                    .map(msg => ({
                    ...msg,
                    date: new Date(msg.date) // Ensure date is a proper Date object
                }))
                    .sort((a, b) => {
                    // First sort by date
                    const dateA = new Date(a.date).getTime();
                    const dateB = new Date(b.date).getTime();
                    if (dateA !== dateB) {
                        return dateA - dateB;
                    }
                    // If dates are equal, sort by ID to maintain consistent order
                    return Number(a.id) - Number(b.id);
                });
                // Display messages
                messageCache.forEach(msg => {
                    displayMessage(msg.from.username, msg.message, msg.id.toString(), msg.reactions || []);
                });
                // Handle scroll position
                if (chatState.isInitialLoad) {
                    const restored = await restoreScrollState();
                    if (!restored) {
                        chatLog.scrollTop = chatLog.scrollHeight;
                    }
                    chatState.isInitialLoad = false;
                }
                else {
                    chatLog.scrollTop = chatLog.scrollHeight;
                }
                break;
            }
            case "chat": {
                const wasAtBottom = (chatLog.scrollHeight - chatLog.scrollTop) <= (chatLog.clientHeight + 50);
                const newMsg = data.message;
                messageCache.push(newMsg);
                displayMessage(newMsg.from.username, newMsg.message, newMsg.id.toString(), newMsg.reactions || []);
                if (wasAtBottom) {
                    chatLog.scrollTop = chatLog.scrollHeight;
                }
                saveScrollState();
                break;
            }
            case "reaction": {
                const reactionData = data;
                updateReactions(reactionData.messageId.toString(), reactionData.reactions);
                break;
            }
            default:
                console.warn("Unknown message type:", data.type);
        }
    }
    catch (error) {
        console.error("Error processing message:", error);
    }
});
// Form submission
sendForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (!message || ws.readyState !== WebSocket.OPEN)
        return;
    const chatMsg = {
        type: "chat",
        sender: currentUser,
        message: message
    };
    ws.send(JSON.stringify(chatMsg));
    messageInput.value = "";
    messageInput.focus();
});
// function sendReaction(messageId: string, emoji: string): void {
//     if (ws.readyState !== WebSocket.OPEN) return;
//     ws.send(
//         JSON.stringify({
//             type: "reaction" as const,
//             messageId,
//             emoji,
//             user: currentUser,
//         })
//     );
// }
function sendReaction(messageId, emoji) {
    if (ws.readyState !== WebSocket.OPEN)
        return;
    // Find the message in cache
    const messageIndex = messageCache.findIndex(msg => msg.id.toString() === messageId);
    if (messageIndex === -1)
        return;
    // Remove any existing reaction from this user
    const updatedReactions = (messageCache[messageIndex].reactions || []).filter(r => r.from.username !== currentUser);
    // Add the new reaction
    updatedReactions.push({
        from: { username: currentUser },
        type: emoji
    });
    // Update local cache
    messageCache[messageIndex].reactions = updatedReactions;
    // Send the new reaction
    ws.send(JSON.stringify({
        type: "reaction",
        messageId,
        emoji,
        user: currentUser,
    }));
}
function updateReactions(messageId, reactions) {
    const messageElement = chatLog.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) {
        console.warn(`Message element not found for ID: ${messageId}`);
        return;
    }
    let reactionDisplay = messageElement.querySelector(".reactions");
    if (!reactionDisplay) {
        reactionDisplay = document.createElement("div");
        reactionDisplay.className = "reactions";
        // Find the reactions container and append to it
        const reactionsContainer = messageElement.querySelector(".reactions-container");
        if (reactionsContainer) {
            reactionsContainer.appendChild(reactionDisplay);
        }
        else {
            messageElement.appendChild(reactionDisplay);
        }
    }
    // Find the message in the cache and update its reactions
    const messageIndex = messageCache.findIndex(msg => msg.id.toString() === messageId);
    if (messageIndex !== -1) {
        messageCache[messageIndex].reactions = reactions.map(r => ({
            from: { username: r.user },
            type: r.emoji
        }));
    }
    // If no reactions, clear the display
    if (!reactions || reactions.length === 0) {
        reactionDisplay.innerHTML = "";
        return;
    }
    // Group reactions by emoji
    const reactionGroups = reactions.reduce((acc, r) => {
        if (!acc[r.emoji]) {
            acc[r.emoji] = { count: 0, users: [] };
        }
        acc[r.emoji].count++;
        acc[r.emoji].users.push(r.user);
        return acc;
    }, {});
    // Generate HTML for reaction display
    // reactionDisplay.innerHTML = Object.entries(reactionGroups)
    //     .map(([emoji, { count, users }]) => {
    //         const hasReacted = users.includes(currentUser || '');
    //         const usersText = users.join(', ');
    //         return `
    //     <span
    //       class="reaction ${hasReacted ? 'reacted' : ''}"
    //       data-emoji="${emoji}"
    //       data-users="${users.join(',')}"
    //       onclick="handleReactionClick('${messageId}', '${emoji}')"
    //       title="${emoji} reacted by ${usersText}"
    //       style="cursor: pointer; margin-right: 4px; padding: 2px 6px; border-radius: 12px; background: ${hasReacted ? '#e3f2fd' : '#f5f5f5'}; border: 1px solid ${hasReacted ? '#2196f3' : '#ddd'}; font-size: 12px; display: inline-block;"
    //     >
    //       ${emoji} ${count}
    //     </span>
    //   `;
    //     })
    //     .join(" ");
    // Pick the emoji with the highest count
    const reaction = reactions[0]; // Only one reaction exists
    if (!reaction) {
        reactionDisplay.innerHTML = "";
        return;
    }
    const hasReacted = reaction.user === currentUser;
    const titleText = `${reaction.emoji} reacted by ${reaction.user}`;
    reactionDisplay.innerHTML = `
  <span 
    class="reaction ${hasReacted ? 'reacted' : ''}"
    data-emoji="${reaction.emoji}"
    data-users="${reaction.user}"
    onclick="handleReactionClick('${messageId}', '${reaction.emoji}')"
    title="${titleText}"
    style="cursor: pointer; margin-right: 4px; padding: 2px 6px; border-radius: 12px; background: ${hasReacted ? '#e3f2fd' : '#f5f5f5'}; border: 1px solid ${hasReacted ? '#2196f3' : '#ddd'}; font-size: 12px; display: inline-block;"
  >
    ${reaction.emoji}
  </span>
`;
}
function clamp(min, val, max) {
    return Math.max(min, Math.min(max, val));
}
function displayMessage(sender, message, messageId, reactions) {
    // Check if message already exists
    const existingMessage = document.querySelector(`[data-message-id="${messageId}"]`);
    if (existingMessage) {
        if (reactions && reactions.length > 0) {
            updateReactions(messageId, reactions.map(r => ({ emoji: r.type, user: r.from.username })));
        }
        return;
    }
    const messageElement = document.createElement("li");
    const isCurrentUser = sender === currentUser;
    messageElement.className = isCurrentUser ? "message outgoing" : "message incoming";
    messageElement.setAttribute("role", "article");
    messageElement.dataset.messageId = messageId;
    // Message content
    const content = document.createElement("div");
    content.className = "message-content";
    // Text container
    const textContainer = document.createElement("div");
    textContainer.className = "text-container";
    // Message text
    const messageText = document.createElement("div");
    messageText.className = "message-text";
    messageText.textContent = message;
    textContainer.appendChild(messageText);
    content.appendChild(textContainer);
    messageElement.appendChild(content);
    // Reactions container
    const reactionsContainer = document.createElement("div");
    reactionsContainer.className = "reactions-container";
    reactionsContainer.style.cssText = "margin-top: 4px; display: flex; align-items: center; gap: 8px;";
    // Create reaction button
    const reactionBtn = document.createElement("button");
    reactionBtn.type = "button";
    reactionBtn.className = "reaction-toggle";
    reactionBtn.innerHTML = "😀";
    reactionBtn.style.cssText = "background: none; border: 1px solid #ddd; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;";
    reactionBtn.onclick = (e) => {
        e.stopPropagation();
        /* -----  remove any existing popup ----- */
        document.querySelectorAll('.reaction-options').forEach(el => el.remove());
        const emojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
        const reactionsDiv = document.createElement("div");
        reactionsDiv.className = "reaction-options";
        reactionsDiv.style.cssText =
            "position:fixed; background:#fff; border:1px solid #ddd; border-radius:8px; padding:4px; box-shadow:0 2px 8px rgba(0,0,0,.1); z-index:1000; display:flex; gap:4px;";
        emojis.forEach(emoji => {
            const btn = document.createElement("button");
            btn.textContent = emoji;
            btn.style.cssText = "background:none; border:none; padding:4px 6px; cursor:pointer; border-radius:4px; font-size:16px;";
            btn.onmouseover = () => btn.style.backgroundColor = '#f0f0f0';
            btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
            btn.onclick = (ev) => {
                ev.stopPropagation();
                sendReaction(messageId, emoji);
                reactionsDiv.remove();
            };
            reactionsDiv.appendChild(btn);
        });
        document.body.appendChild(reactionsDiv);
        /* -----  position smartly ----- */
        const btnRect = reactionBtn.getBoundingClientRect();
        const pad = 4; // small gap
        const maxRight = window.innerWidth - pad;
        const maxLeft = pad;
        /*  default: left-aligned to button */
        let left = btnRect.left;
        let top = btnRect.top - reactionsDiv.offsetHeight - pad;
        /*  if message is outgoing -> right-align to button */
        if (isCurrentUser) {
            left = btnRect.right - reactionsDiv.offsetWidth;
        }
        /*  keep inside screen */
        left = clamp(maxLeft, left, maxRight - reactionsDiv.offsetWidth);
        top = clamp(pad, top, window.innerHeight - reactionsDiv.offsetHeight - pad);
        reactionsDiv.style.left = `${left}px`;
        reactionsDiv.style.top = `${top}px`;
        /* -----  close on outside click ----- */
        const close = (ev) => {
            if (!reactionsDiv.contains(ev.target)) {
                reactionsDiv.remove();
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    };
    // reactionBtn.onclick = (e) => {
    //     e.stopPropagation();
    //
    //     // Remove any existing reaction options
    //     const existingOptions = document.querySelector('.reaction-options');
    //     if (existingOptions) {
    //         existingOptions.remove();
    //     }
    //
    //     const emojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    //     const reactionsDiv = document.createElement("div");
    //     reactionsDiv.className = "reaction-options";
    //     reactionsDiv.style.cssText = "position: absolute; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; display: flex; gap: 4px;";
    //
    //     emojis.forEach(emoji => {
    //         const btn = document.createElement("button");
    //         btn.textContent = emoji;
    //         btn.style.cssText = "background: none; border: none; padding: 4px 6px; cursor: pointer; border-radius: 4px; font-size: 16px;";
    //         btn.onmouseover = () => btn.style.backgroundColor = '#f0f0f0';
    //         btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
    //         btn.onclick = (e) => {
    //             e.stopPropagation();
    //             sendReaction(messageId, emoji);
    //             reactionsDiv.remove();
    //         };
    //         reactionsDiv.appendChild(btn);
    //     });
    //
    //     // Position the options relative to the button
    //     const rect = reactionBtn.getBoundingClientRect();
    //     reactionsDiv.style.position = 'fixed';
    //     reactionsDiv.style.left = rect.left + 'px';
    //     reactionsDiv.style.top = (rect.top - reactionsDiv.offsetHeight - 8) + 'px';
    //
    //     document.body.appendChild(reactionsDiv);
    //
    //     // Close on outside click
    //     const closeHandler = (e: MouseEvent) => {
    //         if (!reactionsDiv.contains(e.target as Node)) {
    //             reactionsDiv.remove();
    //             document.removeEventListener('click', closeHandler);
    //         }
    //     };
    //     setTimeout(() => document.addEventListener('click', closeHandler), 0);
    // };
    reactionsContainer.appendChild(reactionBtn);
    // Reactions display
    const reactionDisplay = document.createElement("div");
    reactionDisplay.className = "reactions";
    reactionDisplay.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px;";
    reactionsContainer.appendChild(reactionDisplay);
    messageElement.appendChild(reactionsContainer);
    chatLog.appendChild(messageElement);
    // Initialize reactions if they exist
    if (reactions && reactions.length > 0) {
        updateReactions(messageId, reactions.map(r => ({ emoji: r.type, user: r.from.username })));
    }
}
function updateOnlineStatus(online) {
    const statusElem = document.querySelector(".online-status");
    if (statusElem) {
        statusElem.textContent = online ? "🟢 Online" : "🔴 Offline";
    }
}
function updateUserCount(name) {
    const userCountElem = document.querySelector(".user-count");
    console.log("-----------");
    console.log(userCountElem);
    console.log("-----------");
    if (userCountElem) {
        userCountElem.textContent = `${name}`;
    }
}
// Make reaction handler available globally
window.handleReactionClick = (messageId, emoji) => {
    if (currentUser)
        sendReaction(messageId, emoji);
};
export {};
