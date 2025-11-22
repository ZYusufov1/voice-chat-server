const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '..', 'data');
const channelsFile = path.join(dataDir, 'channels.json');

/**
 * @typedef {Object} Channel
 * @property {string} id
 * @property {string} name
 * @property {number} maxUsers
 * @property {boolean} hasPassword
 * @property {string | undefined} passwordHash
 * @property {string} createdAt
 */

/** @type {Map<string, Channel>} */
const channels = new Map();

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function loadChannelsFromDisk() {
    ensureDataDir();

    if (!fs.existsSync(channelsFile)) {
        const initial = [
            {
                id: 'dota 2',
                name: 'Общий',
                maxUsers: 10,
                hasPassword: false,
                passwordHash: undefined,
                createdAt: new Date().toISOString()
            },
            {
                id: 'coop',
                name: 'Игры',
                maxUsers: 10,
                hasPassword: false,
                passwordHash: undefined,
                createdAt: new Date().toISOString()
            },
            {
                id: 'squad',
                name: 'Игры',
                maxUsers: 10,
                hasPassword: false,
                passwordHash: undefined,
                createdAt: new Date().toISOString()
            },
        ];

        initial.forEach(ch => channels.set(ch.id, ch));
        saveChannelsToDisk();
        return;
    }

    try {
        const raw = fs.readFileSync(channelsFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            parsed.forEach(ch => {
                if (ch && ch.id && ch.name) {
                    channels.set(ch.id, {
                        id: String(ch.id),
                        name: String(ch.name),
                        maxUsers: Number(ch.maxUsers) || 10,
                        hasPassword: Boolean(ch.hasPassword),
                        passwordHash: ch.passwordHash ? String(ch.passwordHash) : undefined,
                        createdAt: ch.createdAt || new Date().toISOString()
                    });
                }
            });
        }
    } catch (e) {
        // если не получилось прочитать - лог и создать дефолт
        // eslint-disable-next-line no-console
        console.error('Failed to read channels.json, using defaults', e);

        channels.clear();
        const initial = [
            {
                id: 'general',
                name: 'Общий',
                maxUsers: 10,
                hasPassword: false,
                passwordHash: undefined,
                createdAt: new Date().toISOString()
            }
        ];
        initial.forEach(ch => channels.set(ch.id, ch));
        saveChannelsToDisk();
    }
}

function saveChannelsToDisk() {
    ensureDataDir();
    const arr = Array.from(channels.values());
    fs.writeFileSync(channelsFile, JSON.stringify(arr, null, 2), 'utf8');
}

/**
 * Вернуть массив каналов
 * @returns {Channel[]}
 */
function getChannels() {
    return Array.from(channels.values());
}

/**
 * Найти канал
 * @param {string} id
 * @returns {Channel | null}
 */
function getChannel(id) {
    return channels.get(id) || null;
}

/**
 * Сгенерировать id из имени
 * @param {string} name
 */
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        || 'channel-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Создать канал
 * @param {{ name: string, maxUsers?: number, password?: string | null }} params
 * @returns {Channel}
 */
function createChannel(params) {
    const name = String(params.name || '').trim();
    if (!name) {
        throw new Error('NAME_REQUIRED');
    }

    let id = slugify(name);

    // если id занят
    while (channels.has(id)) {
        id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    }

    const maxUsers = Number(params.maxUsers) > 0
        ? Number(params.maxUsers)
        : 10;

    const password = params.password ? String(params.password) : null;

    /** @type {Channel} */
    const channel = {
        id,
        name,
        maxUsers,
        hasPassword: Boolean(password),
        // хранить пока что так, для реального проекта тут мне нужна хеш-функция
        passwordHash: password || undefined,
        createdAt: new Date().toISOString()
    };

    channels.set(id, channel);
    saveChannelsToDisk();

    return channel;
}

/**
 * Обновить канал (пока только имя/лимит/пароль, если понадобится)
 * @param {string} id
 * @param {{ name?: string, maxUsers?: number, password?: string | null }} patch
 * @returns {Channel | null}
 */
function updateChannel(id, patch) {
    const existing = channels.get(id);
    if (!existing) return null;

    if (patch.name !== undefined) {
        const name = String(patch.name || '').trim();
        if (name) {
            existing.name = name;
        }
    }

    if (patch.maxUsers !== undefined) {
        const n = Number(patch.maxUsers);
        if (Number.isFinite(n) && n > 0) {
            existing.maxUsers = n;
        }
    }

    if (patch.password !== undefined) {
        const password = patch.password ? String(patch.password) : null;
        existing.hasPassword = Boolean(password);
        existing.passwordHash = password || undefined;
    }

    channels.set(id, existing);
    saveChannelsToDisk();
    return existing;
}

loadChannelsFromDisk();

module.exports = {
    getChannels,
    getChannel,
    createChannel,
    updateChannel
};
