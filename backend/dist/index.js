import path from 'path';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import WebSocket, { WebSocketServer } from 'ws';
import amqp from 'amqplib';
import * as db from './db.js';
import 'dotenv/config';
// RABBITMQ: Config
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const BROADCAST_EXCHANGE = 'chat_broadcast'; // Fanout for group messages
const DM_EXCHANGE = 'user_messages'; // Direct for DMs
let channel = null;
// Map to track user -> WebSocket (local to this instance)
const userSockets = new Map(); // username -> WebSocket
// Emoji to ChatReactionType mapping
const emojiToReactionType = {
    '👍': 'like',
    '🧡': 'love',
    '😂': 'laugh',
    '🙂': 'wow',
    '😢': 'sad',
    '🙏': 'thanks',
};
const app = fastify();
const server = app.server;
const wss = new WebSocketServer({ server });
console.log('WebSocket server created');
// RABBITMQ: Connect and setup exchanges/queues
async function initRabbitMQ() {
    try {
        const conn = await amqp.connect(RABBITMQ_URL);
        channel = await conn.createChannel();
        // Group chat: Fanout exchange
        await channel.assertExchange(BROADCAST_EXCHANGE, 'fanout', { durable: true });
        const broadcastQueue = `chat_consumer_${process.pid}`;
        const q = await channel.assertQueue(broadcastQueue, { durable: true });
        await channel.bindQueue(q.queue, BROADCAST_EXCHANGE, '');
        // DMs: Direct exchange
        await channel.assertExchange(DM_EXCHANGE, 'direct', { durable: true });
        const dmQueue = `dm_consumer_${process.pid}`;
        await channel.assertQueue(dmQueue, { durable: true });
        // Consume broadcasts (group messages)
        await channel.consume(q.queue, (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    console.log('Received from RabbitMQ (broadcast):', content);
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(content));
                        }
                    });
                    channel?.ack(msg);
                }
                catch (err) {
                    console.error('Error broadcasting from RabbitMQ:', err);
                    channel?.nack(msg, false, true);
                }
            }
        }, { noAck: false });
        // Consume DMs (bound dynamically per user)
        await channel.consume(dmQueue, (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    console.log('Received from RabbitMQ (DM):', content);
                    const recipient = content.message?.recipient?.username;
                    const socket = recipient ? userSockets.get(recipient) : null;
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify(content));
                    }
                    channel?.ack(msg);
                }
                catch (err) {
                    console.error('Error processing DM:', err);
                    channel?.nack(msg, false, true);
                }
            }
        }, { noAck: false });
        console.log('RabbitMQ connected and consuming');
    }
    catch (err) {
        console.error('RabbitMQ init error:', err);
    }
}
// RABBITMQ: Publish helper
async function publishToRabbitMQ(payload, isDM = false, recipient) {
    if (!channel) {
        console.warn('RabbitMQ not connected; broadcasting locally');
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(payload));
            }
        });
        return;
    }
    try {
        const exchange = isDM ? DM_EXCHANGE : BROADCAST_EXCHANGE;
        const routingKey = isDM && recipient ? `user.${recipient}` : '';
        channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)));
        console.log(`Published to RabbitMQ (${exchange}, ${routingKey}):`, payload.type);
        // Always broadcast locally (idempotent; clients dedupe by ID)
        if (!isDM) {
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            });
        }
        else if (recipient) {
            const socket = userSockets.get(recipient);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(payload));
            }
        }
    }
    catch (err) {
        console.error('Publish error:', err);
        // Fallback: Local broadcast
        if (!isDM) {
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            });
        }
        else if (recipient) {
            const socket = userSockets.get(recipient);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(payload));
            }
        }
    }
}
wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});
wss.on('close', () => {
    console.log('WebSocket server closed');
});
await app.register(fastifyStatic, {
    root: path.join(process.cwd(), '../frontend/dist'),
    prefix: '/',
    decorateReply: true,
});
app.get('/', async (request, reply) => {
    return reply.sendFile('index.html');
});
function mapEmojiToReactionType(emoji) {
    return emojiToReactionType[emoji] || 'like';
}
function createUser(username) {
    return { username };
}
function formatDbMessageToChatMessage(msg, reactionsRows = msg.reactions || []) {
    const reactions = reactionsRows.map(r => ({
        type: mapEmojiToReactionType(r.emoji),
        from: { username: r.user }
    }));
    return {
        id: msg.id,
        from: { username: msg.sender },
        recipient: msg.receiver ? { username: msg.receiver } : undefined,
        date: msg.timestamp.toISOString(),
        message: msg.message,
        status: 'delivered',
        type: 'text',
        reactions,
    };
}
wss.on('connection', async (ws) => {
    console.log('Client connected');
    console.log('Total connected clients:', wss.clients.size);
    // Simulate auth (replace with JWT or session)
    let user = null;
    const url = ws.url || '';
    const params = new URLSearchParams(url.split('?')[1]);
    console.log('Connection URL:', params.toString());
    const username = params.get('username') || 'anonymous';
    user = createUser(username);
    userSockets.set(username, ws);
    // Bind DM queue for this user
    if (channel) {
        const dmQueue = `dm_consumer_${process.pid}`;
        await channel.bindQueue(dmQueue, DM_EXCHANGE, `user.${username}`);
        console.log(`Bound DM queue for user.${username}`);
    }
    try {
        const messages = await db.getMessagesForUser(username);
        console.log('--> messages:', messages);
        const messagesWithReactions = messages.map(msg => formatDbMessageToChatMessage(msg, msg.reactions || []));
        ws.send(JSON.stringify({
            type: 'history',
            messages: messagesWithReactions
        }));
    }
    catch (err) {
        console.error('Error loading chat history:', err);
        ws.send(JSON.stringify({ type: 'history', messages: [] }));
    }
    ws.on('message', async (data) => {
        console.log('Received message:', data.toString());
        try {
            const parsed = JSON.parse(data.toString());
            console.log('Parsed message:', parsed);
            if (parsed.type === 'chat') {
                const sender = parsed.sender || user?.username || 'anonymous';
                const messageText = parsed.message;
                const recipient = parsed.recipient || null;
                const insertedMessage = await db.addMessage(sender, recipient, messageText);
                const chatMessage = {
                    id: insertedMessage.id,
                    from: createUser(sender),
                    recipient: recipient ? createUser(recipient) : undefined,
                    date: insertedMessage.timestamp.toISOString(),
                    message: messageText,
                    status: 'delivered',
                    type: 'text',
                    reactions: [],
                };
                // Publish: DM if recipient specified, else broadcast
                await publishToRabbitMQ({
                    type: 'chat',
                    id: insertedMessage.id,
                    message: chatMessage,
                }, !!recipient, recipient);
            }
            else if (parsed.type === 'reaction') {
                const { messageId, emoji, user: reactionUser } = parsed;
                const numMessageId = Number(messageId);
                try {
                    await db.toggleReaction(numMessageId, emoji, reactionUser);
                    const reactionsRows = await db.getReactionsForMessage(numMessageId);
                    const reactionUpdate = {
                        type: 'reaction',
                        messageId: numMessageId,
                        reactions: reactionsRows.map((r) => ({
                            emoji: r.emoji,
                            user: r.user
                        }))
                    };
                    await publishToRabbitMQ(reactionUpdate);
                }
                catch (err) {
                    console.error('Error handling reaction:', err);
                }
            }
        }
        catch (err) {
            console.error('Error processing websocket message:', err);
        }
    });
    ws.on('close', () => {
        if (user) {
            userSockets.delete(user.username);
            if (channel) {
                channel.unbindQueue(`dm_consumer_${process.pid}`, DM_EXCHANGE, `user.${user.username}`);
            }
            console.log(`User ${user.username} disconnected`);
        }
    });
});
try {
    await db.initDb();
    await initRabbitMQ();
    const address = await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`Server listening on ${address}`);
}
catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
}
// Cleanup on server shutdown
process.on('SIGINT', async () => {
    if (channel) {
        await channel.close();
    }
    await db.closeDb();
    process.exit();
});
