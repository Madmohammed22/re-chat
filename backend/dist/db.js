import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function getMessages() {
    const messages = await prisma.message.findMany({
        where: {
            receiver: undefined
        },
        orderBy: {
            timestamp: 'asc'
        }
    });
    return messages;
}
export async function getMessagesForUser(username) {
    const messages = await prisma.message.findMany({
        where: {
            OR: [
                { receiver: undefined },
                { sender: username },
                { receiver: username }
            ]
        },
        orderBy: {
            timestamp: 'asc'
        },
        include: { reactions: true }
    });
    return messages;
}
export async function addMessage(sender, receiver, // Fixed: Explicitly string | null
message) {
    const newMessage = await prisma.message.create({
        data: {
            sender,
            receiver: "", // Now correctly typed as string | null
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
    const reactions = await prisma.reaction.findMany({
        where: {
            messageId: messageId
        },
        orderBy: {
            timestamp: 'asc'
        }
    });
    return reactions;
}
export async function closeDb() {
    await prisma.$disconnect();
}
export async function initDb() {
}
