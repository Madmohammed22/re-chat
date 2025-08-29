import type { ChatMessage, ServerMessage, HistoryMessage, ReactionMessage, ChatReaction } from './types.js';

// Message storage and state
interface ChatState {
  isInitialLoad: boolean;
  lastScrollPosition: number;
  lastScrollHeight: number;
  lastMessageId: string;
}

let messageCache: ChatMessage[] = [];
const chatState: ChatState = {
  isInitialLoad: true,
  lastScrollPosition: 0,
  lastScrollHeight: 0,
  lastMessageId: ''
};

// DOM Elements
const chatLog = document.getElementById("messages") as HTMLUListElement;
if (!chatLog) throw new Error("Could not find messages element");

const messageInput = document.getElementById("input") as HTMLInputElement;
if (!messageInput) throw new Error("Could not find input element");

const sendForm = document.getElementById("form") as HTMLFormElement;
if (!sendForm) throw new Error("Could not find form element");

// WebSocket setup
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
const ws = new WebSocket(wsUrl);

// User management
let currentUser = localStorage.getItem("chatUserId");
if (!currentUser) {
  currentUser = "User_" + Math.random().toString(36).slice(2, 11);
  localStorage.setItem("chatUserId", currentUser);
}

// Save scroll state
function saveScrollState(): void {
  if (!chatState.isInitialLoad) {
    const lastMessage = messageCache[messageCache.length - 1];
    if (!lastMessage) return;

    const scrollInfo = {
      position: chatLog.scrollTop,
      height: chatLog.scrollHeight,
      messageId: lastMessage.id.toString()
    };
    localStorage.setItem('chatScrollState', JSON.stringify(scrollInfo));
  }
}

// Restore scroll state
async function restoreScrollState(): Promise<boolean> {
  try {
    const savedState = localStorage.getItem('chatScrollState');
    if (!savedState) return false;

    const { position, height, messageId } = JSON.parse(savedState);
    if (!messageId) return false;

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

  } catch (e) {
    console.error('Error restoring scroll state:', e);
    return false;
  }
}

// Scroll event handling with debounce
let scrollTimeout: number | undefined;
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
});

ws.addEventListener("close", () => {
  console.log("Disconnected from WebSocket server");
  updateOnlineStatus(false);
});

ws.addEventListener("error", (error) => {
  console.error("WebSocket error:", error);
  updateOnlineStatus(false);
});

ws.addEventListener("message", async (event: MessageEvent) => {
  try {
    const data = JSON.parse(event.data) as ServerMessage;
    console.log("Received message:", data);

    switch (data.type) {
      case "history": {
        const historyData = data as HistoryMessage;
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
          .sort((a: ChatMessage, b: ChatMessage) => {
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
          displayMessage(
            msg.from.username,
            msg.message,
            msg.id.toString(),
            msg.reactions
          );
        });

        // Handle scroll position
        if (chatState.isInitialLoad) {
          const restored = await restoreScrollState();
          if (!restored) {
            chatLog.scrollTop = chatLog.scrollHeight;
          }
          chatState.isInitialLoad = false;
        } else {
          chatLog.scrollTop = chatLog.scrollHeight;
        }
        break;
      }

      case "chat": {
        const wasAtBottom = 
          (chatLog.scrollHeight - chatLog.scrollTop) <= (chatLog.clientHeight + 50);

        const newMsg = data.message as ChatMessage;
        messageCache.push(newMsg);
        displayMessage(
          newMsg.from.username,
          newMsg.message,
          newMsg.id.toString(),
          newMsg.reactions
        );

        if (wasAtBottom) {
          chatLog.scrollTop = chatLog.scrollHeight;
        }
        saveScrollState();
        break;
      }

      case "reaction": {
        const reactionData = data as ReactionMessage;
        updateReactions(reactionData.messageId.toString(), reactionData.reactions);
        break;
      }

      default:
        console.warn("Unknown message type:", (data as { type: string }).type);
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
});

// Form submission
sendForm.addEventListener("submit", (e: Event) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (!message || ws.readyState !== WebSocket.OPEN) return;

  const chatMsg = {
    type: "chat" as const,
    sender: currentUser,
    message: message
  };

  ws.send(JSON.stringify(chatMsg));
  messageInput.value = "";
  messageInput.focus();
});

function sendReaction(messageId: string, emoji: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: "reaction" as const,
      messageId,
      emoji,
      user: currentUser,
    })
  );
}

function updateReactions(messageId: string, reactions: Array<{emoji: string, user: string}>): void {
  const messageElement = chatLog.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
  if (!messageElement) return;

  let reactionDisplay = messageElement.querySelector(".reactions") as HTMLElement | null;
  if (!reactionDisplay) {
    reactionDisplay = document.createElement("div");
    reactionDisplay.className = "reactions";
    messageElement.appendChild(reactionDisplay);
  }

  // Find the message in the cache and update its reactions
  const messageIndex = messageCache.findIndex(msg => msg.id.toString() === messageId);
  if (messageIndex !== -1) {
    messageCache[messageIndex].reactions = reactions.map(r => ({
      from: { username: r.user },
      type: r.emoji as any
    }));
  }

  // Group reactions by emoji
  const reactionGroups = reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) {
      acc[r.emoji] = { count: 0, users: [] };
    }
    acc[r.emoji].count++;
    acc[r.emoji].users.push(r.user);
    return acc;
  }, {} as Record<string, { count: number, users: string[] }>);

  reactionDisplay.innerHTML = Object.entries(reactionGroups)
    .map(([emoji, { count, users }]) => {
      const hasReacted = users.includes(currentUser || '');
      return `
        <span 
          class="reaction ${hasReacted ? 'reacted' : ''}"
          data-emoji="${emoji}"
          data-users="${users.join(',')}"
          onclick="handleReactionClick('${messageId}', '${emoji}')"
          aria-label="${emoji} has ${count} reactions from ${users.join(', ')}"
        >
          ${emoji} ${count}
        </span>
      `;
    })
    .join(" ");
}

function displayMessage(sender: string, message: string, messageId: string, reactions: ChatReaction[]): void {
  // Check if message already exists
  const existingMessage = document.querySelector(`[data-message-id="${messageId}"]`);
  if (existingMessage) {
    updateReactions(messageId, reactions.map(r => ({ emoji: r.type, user: r.from.username })));
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

  // Avatar for incoming messages
  if (!isCurrentUser) {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = sender.charAt(0).toUpperCase();
    content.appendChild(avatar);
  }

  // Text container
  const textContainer = document.createElement("div");
  textContainer.className = "text-container";

  // Sender label for incoming messages
  if (!isCurrentUser) {
    const senderLabel = document.createElement("div");
    senderLabel.className = "sender-label";
    senderLabel.textContent = sender;
    textContainer.appendChild(senderLabel);
  }

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
  
  // Create reaction button
  const reactionBtn = document.createElement("button");
  reactionBtn.type = "button";
  reactionBtn.className = "reaction-toggle";
  reactionBtn.innerHTML = "😀";
  reactionBtn.onclick = (e) => {
    e.stopPropagation();
    const emojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
    const reactionsDiv = document.createElement("div");
    reactionsDiv.className = "reaction-options";
    emojis.forEach(emoji => {
      const btn = document.createElement("button");
      btn.textContent = emoji;
      btn.onclick = (e) => {
        e.stopPropagation();
        sendReaction(messageId, emoji);
        reactionsDiv.remove();
      };
      reactionsDiv.appendChild(btn);
    });
    reactionBtn.parentElement?.appendChild(reactionsDiv);
    
    // Close on outside click
    const closeHandler = (e: MouseEvent) => {
      if (!reactionsDiv.contains(e.target as Node)) {
        reactionsDiv.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  };
  reactionsContainer.appendChild(reactionBtn);

  // Reactions display
  const reactionDisplay = document.createElement("div");
  reactionDisplay.className = "reactions";
  reactionsContainer.appendChild(reactionDisplay);
  
  if (reactions?.length) {
    updateReactions(messageId, reactions.map(r => ({ emoji: r.type, user: r.from.username })));
  }
  
  messageElement.appendChild(reactionsContainer);
  chatLog.appendChild(messageElement);
}

function updateOnlineStatus(online: boolean): void {
  const statusElem = document.querySelector(".online-status");
  if (statusElem) {
    statusElem.textContent = online ? "🟢 Connected" : "🔴 Disconnected";
  }
}

// Make reaction handler available globally
(window as any).handleReactionClick = (messageId: string, emoji: string) => {
  if (currentUser) sendReaction(messageId, emoji);
};
