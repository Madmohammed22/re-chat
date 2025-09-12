// I added primsma
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function getMessages() {
    const messages = await prisma.message.findMany({
        orderBy: {
            timestamp: 'asc'
        }
    });
    return messages;
}
export async function getReactions(messageId) {
    const reactions = await prisma.reaction.findMany({
        where: {
            messageId: messageId
        }
    });
    return reactions;
}
export async function addMessage(sender, message) {
    const newMessage = await prisma.message.create({
        data: {
            sender,
            receiver: "", // default receiver
            message,
            timestamp: new Date()
        }
    });
    return newMessage;
}
export async function addReaction(messageId, emoji, user) {
    const newReaction = await prisma.reaction.create({
        data: {
            messageId,
            emoji,
            user,
            timestamp: new Date()
        }
    });
    return newReaction;
}
export async function toggleReaction(messageId, emoji, username) {
    try {
        const existingReaction = await prisma.reaction.findFirst({
            where: {
                messageId: messageId,
                emoji: emoji,
                user: username
            }
        });
        if (existingReaction) {
            await prisma.reaction.delete({
                where: {
                    id: existingReaction.id
                }
            });
        }
        else {
            await prisma.reaction.create({
                data: {
                    messageId: messageId,
                    emoji: emoji,
                    user: username,
                    timestamp: new Date()
                }
            });
        }
    }
    catch (error) {
        console.error('Error in toggleReaction:', error);
        throw error;
    }
}
export async function getReactionsForMessage(messageId) {
    return getReactions(messageId);
}
export async function closeDb() {
    await prisma.$disconnect();
}
export async function initDb() {
    // No-op for Prisma as it automatically handles connections
}
// DATABASE_URL="file:./dev.db"
