
const express = require('express');
const routes = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../dbcon');

// Configure multer storage for media uploads (Videos & Images)
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const cleanName = (file.originalname || 'media').replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${uniqueSuffix}-${cleanName}`);
    }
});

const mediaUpload = multer({
    storage,
    limits: { fileSize: 150 * 1024 * 1024 }, // 150MB max file size
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/ogg', 'video/x-m4v',
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'
        ];
        const isAllowed = allowedTypes.includes(file.mimetype) ||
            /\.(mp4|webm|mov|m4v|avi|mkv|ogv|jpg|jpeg|png|webp|gif|svg)$/i.test(file.originalname);
        if (isAllowed) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    }
});

const uploadMiddleware = (req, res, next) => {
    mediaUpload.any()(req, res, (err) => {
        if (err) {
            console.error('[Upload Error]:', err);
            return res.status(400).json({ success: false, error: err.message || 'File upload failed' });
        }
        next();
    });
};

const handleMediaUpload = (req, res) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: 'No media file provided' });
    }

    const file = files[0];
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const relativeUrl = `/uploads/${file.filename}`;
    const fullUrl = `${protocol}://${host}${relativeUrl}`;

    res.json({
        success: true,
        url: fullUrl,
        relativeUrl,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype
    });
};

// Route handlers for uploads
routes.post('/upload-media', uploadMiddleware, handleMediaUpload);
routes.post('/upload-video', uploadMiddleware, handleMediaUpload);
routes.post('/upload', uploadMiddleware, handleMediaUpload);

// GET /admin/properties/stored-videos - List all videos from server uploads directory & database
routes.get('/stored-videos', async (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const host = req.get('host');
        const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const videoExtensions = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.ogv']);
        const storedVideosMap = new Map();

        // 1. Scan uploads directory
        if (fs.existsSync(uploadsDir)) {
            try {
                const files = await fs.promises.readdir(uploadsDir);
                for (const file of files) {
                    const ext = path.extname(file).toLowerCase();
                    if (videoExtensions.has(ext)) {
                        const filePath = path.join(uploadsDir, file);
                        try {
                            const stats = await fs.promises.stat(filePath);
                            const sizeMb = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
                            const fullUrl = `${protocol}://${host}/uploads/${file}`;
                            storedVideosMap.set(file, {
                                id: `file_${file}`,
                                fileName: file,
                                url: fullUrl,
                                relativeUrl: `/uploads/${file}`,
                                size: sizeMb,
                                sizeBytes: stats.size,
                                createdAt: stats.birthtime || stats.mtime,
                                guestName: '',
                                caption: '',
                                source: 'storage',
                            });
                        } catch (_) {}
                    }
                }
            } catch (fsErr) {
                console.warn('[stored-videos] Error reading uploads dir:', fsErr.message);
            }
        }

        // 2. Query accommodations table for any previously saved guest stories
        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute(
                'SELECT id, name, guest_stories FROM accommodations WHERE guest_stories IS NOT NULL AND guest_stories != ""'
            );

            for (const row of rows) {
                const stories = parseJSONField(row.guest_stories, []);
                if (Array.isArray(stories)) {
                    for (const s of stories) {
                        if (s && s.videoUrl && typeof s.videoUrl === 'string' && s.videoUrl.trim() !== '') {
                            const vUrl = s.videoUrl.trim();
                            const urlFileName = path.basename(vUrl.split('?')[0]);
                            const existing = storedVideosMap.get(urlFileName);

                            if (existing) {
                                if (!existing.guestName && s.guestName) existing.guestName = s.guestName;
                                if (!existing.caption && s.caption) existing.caption = s.caption;
                                if (!existing.thumbnail && s.thumbnail) existing.thumbnail = s.thumbnail;
                                if (!existing.accommodationName) existing.accommodationName = row.name;
                            } else {
                                storedVideosMap.set(urlFileName || vUrl, {
                                    id: s.id ? String(s.id) : `story_${Date.now()}_${Math.random()}`,
                                    fileName: s.fileName || urlFileName || 'Video Story',
                                    url: vUrl,
                                    relativeUrl: vUrl.startsWith('http') ? vUrl : `/uploads/${urlFileName}`,
                                    size: s.fileSize || '',
                                    guestName: s.guestName || '',
                                    caption: s.caption || '',
                                    thumbnail: s.thumbnail || '',
                                    accommodationName: row.name,
                                    source: 'database',
                                });
                            }
                        }
                    }
                }
            }
        } catch (dbErr) {
            console.warn('[stored-videos] Error querying accommodations stories:', dbErr.message);
        } finally {
            if (connection) connection.release();
        }

        const videosList = Array.from(storedVideosMap.values());
        videosList.sort((a, b) => {
            if (a.createdAt && b.createdAt) {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            return 0;
        });

        res.json({
            success: true,
            total: videosList.length,
            videos: videosList,
        });
    } catch (error) {
        console.error('Error fetching stored videos:', error);
        res.status(500).json({ error: 'Failed to fetch stored videos', details: error.message });
    }
});

const createConnection = async () => {
    return await pool.getConnection();
};

const closeConnection = async (connection) => {
    if (connection) connection.release();
};

const EXTENDED_COLUMNS = [
    ['meta_title', 'VARCHAR(255) NULL'],
    ['meta_description', 'TEXT NULL'],
    ['page_heading', 'VARCHAR(255) NULL'],
    ['image_details', 'LONGTEXT NULL'],
    ['room_numbers', 'LONGTEXT NULL'],
    ['activities', 'LONGTEXT NULL'],
    ['meal_details', 'LONGTEXT NULL'],
    ['how_to_reach', 'LONGTEXT NULL'],
    ['nearby_places', 'LONGTEXT NULL'],
    ['rules_and_policies', 'LONGTEXT NULL'],
    ['faqs', 'LONGTEXT NULL'],
    ['guest_stories', 'LONGTEXT NULL'],
];

let schemaReadyPromise = null;

const ensureExtendedSchema = async (connection) => {
    if (!schemaReadyPromise) {
        schemaReadyPromise = (async () => {
            try {
                const [existing] = await connection.query(
                    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accommodations'`
                );
                const names = new Set(existing.map((row) => (row.COLUMN_NAME || '').toLowerCase()));
                for (const [name, def] of EXTENDED_COLUMNS) {
                    if (!names.has(name.toLowerCase())) {
                        try {
                            await connection.query(`ALTER TABLE accommodations ADD COLUMN ${name} ${def}`);
                            console.log(`[accommodations] added column ${name}`);
                        } catch (alterErr) {
                            if (!alterErr.message.includes('Duplicate column')) {
                                console.warn(`Could not add column ${name}:`, alterErr.message);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Schema check warning (non-fatal):', err.message);
            }
        })();
    }
    return schemaReadyPromise;
};

const parseJSONField = (field, defaultValue) => {
    try {
        if (field === null || field === undefined || field === '') return defaultValue;
        if (typeof field === 'object') return field;
        let parsed = JSON.parse(field);
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch (_) {}
        }
        return parsed;
    } catch (e) {
        console.warn('Failed to parse JSON field:', e.message);
        return defaultValue;
    }
};

const toJson = (value, fallback) => {
    if (value === undefined || value === null) {
        return fallback === undefined ? null : JSON.stringify(fallback);
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    if (typeof value === 'string') {
        try {
            JSON.parse(value);
            return value;
        } catch {
            return JSON.stringify(value);
        }
    }
    return JSON.stringify(value);
};

const extractExtendedFields = (basicInfo = {}, current = {}, reqBody = {}) => ({
    metaTitle: basicInfo.metaTitle ?? reqBody.metaTitle ?? current.meta_title ?? null,
    metaDescription: basicInfo.metaDescription ?? reqBody.metaDescription ?? current.meta_description ?? null,
    pageHeading: basicInfo.pageHeading ?? reqBody.pageHeading ?? current.page_heading ?? null,
    imageDetails: (basicInfo.imageDetails !== undefined ? basicInfo.imageDetails : reqBody.imageDetails) !== undefined
        ? toJson(basicInfo.imageDetails ?? reqBody.imageDetails, [])
        : (current.image_details ?? toJson([], [])),
    roomNumbers: (basicInfo.roomNumbers !== undefined ? basicInfo.roomNumbers : reqBody.roomNumbers) !== undefined
        ? toJson(basicInfo.roomNumbers ?? reqBody.roomNumbers, [])
        : (current.room_numbers ?? toJson([], [])),
    activities: (basicInfo.activities !== undefined ? basicInfo.activities : reqBody.activities) !== undefined
        ? toJson(basicInfo.activities ?? reqBody.activities, [])
        : (current.activities ?? toJson([], [])),
    mealDetails: (basicInfo.mealDetails !== undefined ? basicInfo.mealDetails : reqBody.mealDetails) !== undefined
        ? toJson(basicInfo.mealDetails ?? reqBody.mealDetails, {})
        : (current.meal_details ?? toJson({}, {})),
    howToReach: (basicInfo.howToReach !== undefined ? basicInfo.howToReach : reqBody.howToReach) !== undefined
        ? toJson(basicInfo.howToReach ?? reqBody.howToReach, {})
        : (current.how_to_reach ?? toJson({}, {})),
    nearbyPlaces: (basicInfo.nearbyPlaces !== undefined ? basicInfo.nearbyPlaces : reqBody.nearbyPlaces) !== undefined
        ? toJson(basicInfo.nearbyPlaces ?? reqBody.nearbyPlaces, [])
        : (current.nearby_places ?? toJson([], [])),
    rulesAndPolicies: (basicInfo.rulesAndPolicies !== undefined ? basicInfo.rulesAndPolicies : reqBody.rulesAndPolicies) !== undefined
        ? toJson(basicInfo.rulesAndPolicies ?? reqBody.rulesAndPolicies, {})
        : (current.rules_and_policies ?? toJson({}, {})),
    faqs: (basicInfo.faqs !== undefined ? basicInfo.faqs : reqBody.faqs) !== undefined
        ? toJson(basicInfo.faqs ?? reqBody.faqs, [])
        : (current.faqs ?? toJson([], [])),
    guestStories: (basicInfo.guestStories !== undefined ? basicInfo.guestStories : (reqBody.guestStories ?? reqBody.guest_stories ?? basicInfo.guest_stories)) !== undefined
        ? toJson(basicInfo.guestStories ?? reqBody.guestStories ?? reqBody.guest_stories ?? basicInfo.guest_stories, [])
        : (current.guest_stories ?? toJson([], [])),
});

const formatListItem = (row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    price: row.price,
    capacity: row.capacity,
    rooms: row.rooms,
    available: Boolean(row.available),
    features: parseJSONField(row.features, []),
    images: parseJSONField(row.images, []),
    imageDetails: parseJSONField(row.image_details, []),
    amenities: parseJSONField(row.amenity_ids, []),
    max_person_villa: row.MaxPersonVilla,
    rate_per_person: row.RatePerPerson,
    mealPlans: parseJSONField(row.meal_plans, []),
    location: {
        address: row.address,
        coordinates: {
            latitude: row.latitude,
            longitude: row.longitude,
        },
    },
    ownerId: row.owner_id,
    cityId: row.city_id,
    package: {
        name: row.package_name,
        description: row.package_description,
        images: parseJSONField(row.package_images, []),
        pricing: {
            adult: row.adult_price,
            child: row.child_price,
            maxGuests: row.max_guests,
        },
    },
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    pageHeading: row.page_heading,
    roomNumbers: parseJSONField(row.room_numbers, []),
    activities: parseJSONField(row.activities, []),
    meals: parseJSONField(row.meal_details, {}),
    mealDetails: parseJSONField(row.meal_details, {}),
    howToReach: parseJSONField(row.how_to_reach, {}),
    nearbyPlaces: parseJSONField(row.nearby_places, []),
    rulesAndPolicies: parseJSONField(row.rules_and_policies, {}),
    faqs: parseJSONField(row.faqs, []),
    guestStories: parseJSONField(row.guest_stories, []),
    timestamps: {
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    },
});

const formatDetail = (accommodation) => ({
    id: accommodation.id,
    basicInfo: {
        name: accommodation.name || '',
        description: accommodation.description || '',
        type: accommodation.type || '',
        capacity: accommodation.capacity || 2,
        rooms: accommodation.rooms || 1,
        price: accommodation.price || 0,
        available: Boolean(accommodation.available),
        features: parseJSONField(accommodation.features, []),
        images: parseJSONField(accommodation.images, []),
        imageDetails: parseJSONField(accommodation.image_details, []),
        MaxPersonVilla: accommodation.MaxPersonVilla || 0,
        RatePersonVilla: accommodation.RatePerPerson || 0,
        mealPlans: parseJSONField(accommodation.meal_plans, []),
        metaTitle: accommodation.meta_title || '',
        metaDescription: accommodation.meta_description || '',
        pageHeading: accommodation.page_heading || '',
        roomNumbers: parseJSONField(accommodation.room_numbers, []),
        activities: parseJSONField(accommodation.activities, []),
        mealDetails: parseJSONField(accommodation.meal_details, {}),
        howToReach: parseJSONField(accommodation.how_to_reach, {}),
        nearbyPlaces: parseJSONField(accommodation.nearby_places, []),
        rulesAndPolicies: parseJSONField(accommodation.rules_and_policies, {}),
        faqs: parseJSONField(accommodation.faqs, []),
        guestStories: parseJSONField(accommodation.guest_stories, []),
    },
    location: {
        owner: {
            id: accommodation.owner_id,
            name: accommodation.owner_name,
        },
        city: {
            id: accommodation.city_id,
            name: accommodation.city_name,
            country: accommodation.country,
        },
        address: accommodation.address || '',
        coordinates: {
            latitude: accommodation.latitude,
            longitude: accommodation.longitude,
        },
    },
    amenities: {
        ids: parseJSONField(accommodation.amenity_ids, []),
    },
    packages: {
        name: accommodation.package_name || '',
        description: accommodation.package_description || '',
        images: parseJSONField(accommodation.package_images, []),
        pricing: {
            adult: accommodation.adult_price || 0,
            child: accommodation.child_price || 0,
            maxGuests: accommodation.max_guests || 2,
        },
    },
    metadata: {
        createdAt: accommodation.created_at,
        updatedAt: accommodation.updated_at,
    },
});

const applyCapacityFilter = (capacity, conditions, params) => {
    if (!capacity) return;
    if (capacity === '1-2') {
        conditions.push('capacity BETWEEN ? AND ?');
        params.push(1, 2);
    } else if (capacity === '3-4') {
        conditions.push('capacity BETWEEN ? AND ?');
        params.push(3, 4);
    } else if (capacity === '5+' || capacity === '5') {
        conditions.push('capacity >= ?');
        params.push(5);
    }
};

const applyAvailabilityFilter = (availability, isAvailable, conditions) => {
    const value = availability || isAvailable;
    if (value === 'available' || value === 'true') {
        conditions.push('available = TRUE');
    } else if (value === 'unavailable' || value === 'false') {
        conditions.push('available = FALSE');
    }
};

// GET /admin/properties/accommodations
routes.get('/accommodations', async (req, res) => {
    const connection = await createConnection();

    try {
        await ensureExtendedSchema(connection);

        const {
            type,
            min_capacity,
            max_capacity,
            capacity,
            is_available,
            availability,
            min_price,
            max_price,
            search,
            amenities,
            page = 1,
            limit,
            perPage,
            sort = 'created_at',
            order = 'DESC',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10)) || 1;
        const limitNum = Math.min(100, Math.max(1, parseInt(perPage || limit || 12, 10))) || 12;
        const offset = (pageNum - 1) * limitNum;

        let query = `
            SELECT
                id, name, type, description, price, capacity, rooms, available,
                features, images, image_details, amenity_ids, owner_id, city_id,
                address, latitude, longitude, package_name, package_description,
                package_images, adult_price, child_price, max_guests,
                created_at, updated_at, MaxPersonVilla, RatePerPerson, meal_plans,
                meta_title, meta_description, page_heading, room_numbers, activities,
                meal_details, how_to_reach, nearby_places, rules_and_policies, faqs, guest_stories
            FROM accommodations
        `;

        const conditions = [];
        const params = [];

        if (type) {
            conditions.push('type = ?');
            params.push(type);
        }

        applyCapacityFilter(capacity, conditions, params);

        if (min_capacity) {
            conditions.push('capacity >= ?');
            params.push(min_capacity);
        }

        if (max_capacity) {
            conditions.push('capacity <= ?');
            params.push(max_capacity);
        }

        applyAvailabilityFilter(availability, is_available, conditions);

        if (min_price) {
            conditions.push('price >= ?');
            params.push(min_price);
        }

        if (max_price) {
            conditions.push('price <= ?');
            params.push(max_price);
        }

        if (search) {
            conditions.push('(name LIKE ? OR description LIKE ? OR type LIKE ? OR address LIKE ?)');
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }

        if (amenities) {
            const amenityIds = amenities.split(',').map((id) => parseInt(id.trim(), 10));
            conditions.push('JSON_OVERLAPS(amenity_ids, ?)');
            params.push(JSON.stringify(amenityIds));
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        const validSortFields = [
            'id', 'name', 'type', 'price', 'capacity', 'rooms',
            'available', 'created_at', 'updated_at',
        ];
        const sortField = validSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        query += ` ORDER BY ${sortField} ${sortOrder} LIMIT ${limitNum} OFFSET ${offset}`;

        const [rows] = await connection.execute(query, params);

        const countQuery = `
            SELECT COUNT(*) as total
            FROM accommodations
            ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
        `;
        const [countRows] = await connection.execute(countQuery, params);
        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limitNum) || 1;

        res.json({
            data: rows.map(formatListItem),
            pagination: {
                total,
                totalPages,
                currentPage: pageNum,
                perPage: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1,
            },
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({
            error: 'Failed to fetch accommodations',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    sqlMessage: error.sqlMessage,
                },
            }),
        });
    } finally {
        await closeConnection(connection);
    }
});

// GET /admin/properties/accommodations/stats
routes.get('/accommodations/stats', async (req, res) => {
    let connection;
    try {
        connection = await createConnection();
        const [stats] = await connection.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN available = 1 THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN available = 0 THEN 1 ELSE 0 END) as unavailable,
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price
            FROM accommodations
        `);
        res.json(stats[0]);
    } catch (error) {
        console.error('Error fetching accommodation stats:', error);
        res.status(500).json({ error: 'Failed to fetch accommodation statistics' });
    } finally {
        await closeConnection(connection);
    }
});

// GET /admin/properties/accommodations/:id
routes.get('/accommodations/:id', async (req, res) => {
    const { id } = req.params;

    if (!Number.isInteger(Number(id)) || Number(id) < 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const connection = await createConnection();

    try {
        await ensureExtendedSchema(connection);

        const [rows] = await connection.execute(
            `SELECT
                a.*,
                u.name as owner_name,
                c.name as city_name,
                c.country as country
            FROM accommodations a
            LEFT JOIN users u ON a.owner_id = u.id
            LEFT JOIN cities c ON a.city_id = c.id
            WHERE a.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        res.json(formatDetail(rows[0]));
    } catch (error) {
        console.error('Error fetching accommodation:', error);

        if (error.code === 'ER_PARSE_ERROR' || error.code === 'ER_BAD_FIELD_ERROR') {
            return res.status(500).json({
                error: 'Database query error',
                details: process.env.NODE_ENV === 'development' ? {
                    message: error.message,
                    sql: error.sql,
                    code: error.code,
                } : undefined,
            });
        }

        res.status(500).json({
            error: 'Failed to fetch accommodation',
            ...(process.env.NODE_ENV === 'development' && {
                details: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code,
                },
            }),
        });
    } finally {
        await closeConnection(connection);
    }
});

// POST /admin/properties/accommodations
routes.post('/accommodations', async (req, res) => {
    let connection;
    try {
        const { basicInfo, location, amenities, ownerId, packages } = req.body;

        if (!basicInfo || !basicInfo.name || !basicInfo.type ||
            !basicInfo.capacity || !basicInfo.rooms || !basicInfo.price) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        connection = await createConnection();
        await ensureExtendedSchema(connection);

        const {
            name,
            description,
            type,
            capacity,
            rooms,
            price,
            features = [],
            images = [],
            available = true,
            MaxPersonVilla,
            RatePersonVilla,
            mealPlans = [],
        } = basicInfo;

        const extended = extractExtendedFields(basicInfo, {}, req.body);
        const address = location?.address || null;
        const cityId = location?.cityId || null;
        const latitude = location?.coordinates?.latitude || null;
        const longitude = location?.coordinates?.longitude || null;
        const amenityIds = amenities?.ids || [];

        const packageName = packages?.name || null;
        const packageDescription = packages?.description || null;
        const packageImages = packages?.images || [];
        const adultPrice = packages?.pricing?.adult || 0;
        const childPrice = packages?.pricing?.child || 0;
        const maxGuests = packages?.pricing?.maxGuests || 2;

        const [result] = await connection.execute(
            `INSERT INTO accommodations
            (name, description, type, capacity, rooms, price, features, images, available, owner_id, city_id,
             address, latitude, longitude, amenity_ids, package_name, package_description, package_images,
             adult_price, child_price, max_guests, MaxPersonVilla, RatePerPerson, meal_plans,
             meta_title, meta_description, page_heading, image_details, room_numbers, activities,
             meal_details, how_to_reach, nearby_places, rules_and_policies, faqs, guest_stories)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                description || null,
                type,
                capacity,
                rooms,
                price,
                JSON.stringify(features),
                JSON.stringify(images),
                available ? 1 : 0,
                ownerId || null,
                cityId || null,
                address,
                latitude,
                longitude,
                JSON.stringify(amenityIds),
                packageName,
                packageDescription,
                JSON.stringify(packageImages),
                adultPrice,
                childPrice,
                maxGuests,
                MaxPersonVilla || null,
                RatePersonVilla || null,
                JSON.stringify(mealPlans),
                extended.metaTitle,
                extended.metaDescription,
                extended.pageHeading,
                extended.imageDetails,
                extended.roomNumbers,
                extended.activities,
                extended.mealDetails,
                extended.howToReach,
                extended.nearbyPlaces,
                extended.rulesAndPolicies,
                extended.faqs,
                extended.guestStories,
            ]
        );

        res.status(201).json({
            message: 'Accommodation created successfully',
            id: result.insertId,
            name,
        });
    } catch (error) {
        console.error('Error creating accommodation:', error);
        res.status(500).json({
            error: 'Failed to create accommodation',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    } finally {
        await closeConnection(connection);
    }
});

// PUT /admin/properties/accommodations/:id
routes.put('/accommodations/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID' });
    }

    let connection;

    try {
        connection = await createConnection();
        await ensureExtendedSchema(connection);
        await connection.beginTransaction();

        const [existingRows] = await connection.execute(
            'SELECT * FROM accommodations WHERE id = ? FOR UPDATE',
            [id]
        );

        if (existingRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const current = existingRows[0];
        const {
            basicInfo = {},
            location = {},
            amenities = {},
            ownerId,
            packages = {},
        } = req.body;

        const name = basicInfo.name ?? current.name;
        const description = basicInfo.description ?? current.description;
        const type = basicInfo.type ?? current.type;
        const capacity = basicInfo.capacity ?? current.capacity;
        const rooms = basicInfo.rooms ?? current.rooms;
        const price = basicInfo.price ?? current.price;
        const MaxPersonVilla = basicInfo.MaxPersonVilla ?? current.MaxPersonVilla;
        const RatePerPerson = basicInfo.RatePersonVilla ?? current.RatePerPerson;
        const mealPlans = basicInfo.mealPlans !== undefined ? JSON.stringify(basicInfo.mealPlans) : current.meal_plans;

        const address = location.address ?? current.address;
        const cityId = location.cityId ?? current.city_id;
        const latitude = location.coordinates?.latitude ?? current.latitude;
        const longitude = location.coordinates?.longitude ?? current.longitude;

        const packageName = packages.name ?? current.package_name;
        const packageDescription = packages.description ?? current.package_description;
        const adultPrice = packages.pricing?.adult ?? current.adult_price;
        const childPrice = packages.pricing?.child ?? current.child_price;
        const maxGuests = packages.pricing?.maxGuests ?? current.max_guests;
        const finalOwnerId = ownerId ?? current.owner_id;

        let finalAvailable;
        if (basicInfo.available === true || basicInfo.available === 1) {
            finalAvailable = 1;
        } else if (basicInfo.available === false || basicInfo.available === 0) {
            finalAvailable = 0;
        } else {
            finalAvailable = current.available;
        }

        const finalFeatures = basicInfo.features ? JSON.stringify(basicInfo.features) : current.features;
        const finalImages = basicInfo.images ? JSON.stringify(basicInfo.images) : current.images;
        const finalAmenityIds = amenities.ids ? JSON.stringify(amenities.ids) : current.amenity_ids;
        const finalPackageImages = packages.images ? JSON.stringify(packages.images) : current.package_images;
        const extended = extractExtendedFields(basicInfo, current, req.body);

        if (!name || !type) {
            throw new Error('Missing required fields: name and type');
        }
        if (Number(capacity) <= 0 || Number(rooms) <= 0 || Number(price) <= 0) {
            throw new Error('Capacity, rooms, and price must be positive numbers');
        }

        const [result] = await connection.execute(
            `UPDATE accommodations SET
                name = ?, description = ?, type = ?, capacity = ?, rooms = ?,
                price = ?, features = ?, images = ?, available = ?, owner_id = ?,
                city_id = ?, address = ?, latitude = ?, longitude = ?, amenity_ids = ?,
                package_name = ?, package_description = ?, package_images = ?,
                adult_price = ?, child_price = ?, max_guests = ?,
                MaxPersonVilla = ?, RatePerPerson = ?, meal_plans = ?,
                meta_title = ?, meta_description = ?, page_heading = ?,
                image_details = ?, room_numbers = ?, activities = ?,
                meal_details = ?, how_to_reach = ?, nearby_places = ?,
                rules_and_policies = ?, faqs = ?, guest_stories = ?,
                updated_at = CURRENT_TIMESTAMP()
            WHERE id = ?`,
            [
                name, description, type, Number(capacity), Number(rooms),
                Number(price), finalFeatures, finalImages, finalAvailable, finalOwnerId,
                cityId, address, latitude, longitude, finalAmenityIds,
                packageName, packageDescription, finalPackageImages,
                Number(adultPrice), Number(childPrice), Number(maxGuests),
                MaxPersonVilla, RatePerPerson, mealPlans,
                extended.metaTitle, extended.metaDescription, extended.pageHeading,
                extended.imageDetails, extended.roomNumbers, extended.activities,
                extended.mealDetails, extended.howToReach, extended.nearbyPlaces,
                extended.rulesAndPolicies, extended.faqs, extended.guestStories,
                id,
            ]
        );

        await connection.commit();

        res.status(200).json({
            id,
            message: result.changedRows === 0
                ? 'No changes detected. Accommodation not updated.'
                : 'Accommodation updated successfully',
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (dbError) {
                console.error('Error during rollback:', dbError);
            }
        }

        console.error('Error updating accommodation:', error);

        if (error.message.includes('Missing required') ||
            error.message.includes('must be positive')) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({
            error: 'Failed to update accommodation',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    } finally {
        await closeConnection(connection);
    }
});

// DELETE /admin/properties/accommodations/:id
routes.delete('/accommodations/:id', async (req, res) => {
    const { id } = req.params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
        return res.status(400).json({ error: 'Invalid accommodation ID format' });
    }

    const connection = await createConnection();

    try {
        await connection.beginTransaction();

        const [accommodation] = await connection.execute(
            'SELECT id FROM accommodations WHERE id = ? FOR UPDATE',
            [id]
        );

        if (accommodation.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        const childTables = [
            'blocked_dates',
            'accommodation_amenities',
            'bookings',
            'reviews',
            'packages',
        ];

        for (const table of childTables) {
            try {
                await connection.execute(
                    `DELETE FROM ${table} WHERE accommodation_id = ?`,
                    [id]
                );
            } catch (err) {
                if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
            }
        }

        const [result] = await connection.execute(
            'DELETE FROM accommodations WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No accommodation deleted' });
        }

        await connection.commit();
        res.json({
            message: 'Accommodation and all related data deleted successfully',
            deletedId: id,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Database error deleting accommodation:', error);

        let errorMessage = 'Failed to delete accommodation';
        const errorDetails = {};

        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            errorMessage = 'Cannot delete - accommodation is referenced by other records';
            errorDetails.hint = 'Please delete related bookings or reviews first';
        } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            errorMessage = 'Referenced record not found';
            errorDetails.hint = 'Database consistency issue detected';
        } else if (error.code === 'ER_NO_SUCH_TABLE') {
            errorMessage = 'Database table missing';
        }

        res.status(500).json({
            error: errorMessage,
            ...errorDetails,
            ...(process.env.NODE_ENV !== 'production' && {
                details: {
                    code: error.code,
                    message: error.message,
                    sql: error.sql,
                },
            }),
        });
    } finally {
        await closeConnection(connection);
    }
});

// PATCH /admin/properties/accommodations/:id/toggle-availability
routes.patch('/accommodations/:id/toggle-availability', async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { available } = req.body;

        if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
            return res.status(400).json({ error: 'Invalid accommodation ID format' });
        }

        connection = await createConnection();
        const availableValue = available === false || available === 0 || available === 'false' ? 0 : 1;

        const [result] = await connection.execute(
            'UPDATE accommodations SET available = ?, updated_at = CURRENT_TIMESTAMP() WHERE id = ?',
            [availableValue, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Accommodation not found' });
        }

        res.json({
            message: 'Availability updated successfully',
            available: Boolean(availableValue),
        });
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    } finally {
        await closeConnection(connection);
    }
});

// GET /admin/properties/users
routes.get('/users', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, email FROM users');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /admin/properties/cities
routes.get('/cities', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, country FROM cities WHERE active = 1');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

module.exports = routes;
