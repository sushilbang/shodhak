"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const research_routes_1 = __importDefault(require("./routes/research.routes"));
const agent_routes_1 = __importDefault(require("./routes/agent.routes"));
const database_1 = require("./config/database");
const logger_1 = require("./utils/logger");
const auth_middlware_1 = require("./middleware/auth.middlware");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id']
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Serve static files from public folder
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
app.use((req, res, next) => {
    logger_1.logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip
    });
    next();
});
app.get('/health', async (req, res) => {
    try {
        await database_1.pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected'
        });
    }
});
app.use('/api/research', research_routes_1.default);
app.use('/api/agent', agent_routes_1.default);
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.path} does not exist`
    });
});
app.use((err, req, res, next) => {
    logger_1.logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
        error: 'Internal server error',
        message: isDev ? err.message : 'Something went wrong',
        ...(isDev && { stack: err.stack })
    });
});
const startServer = async () => {
    try {
        await database_1.pool.query('SELECT NOW()');
        logger_1.logger.info('Database connected successfully');
        try {
            await database_1.pool.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
            logger_1.logger.info('pgvector extension verified');
        }
        catch (e) {
            logger_1.logger.warn('pgvector extension check failed - vector search may not work');
        }
        if (process.env.NODE_ENV === 'development') {
            const testUser = await (0, auth_middlware_1.ensureTestUser)();
            logger_1.logger.info('Test user available', { userId: testUser.id, email: testUser.email });
        }
        app.listen(PORT, () => {
            logger_1.logger.info(`Server started on port ${PORT}`);
            logger_1.logger.info(`Health check: http://localhost:${PORT}/health`);
            logger_1.logger.info(`API base: http://localhost:${PORT}/api/research`);
            if (process.env.NODE_ENV === 'development') {
                console.log('\n Shodhak Research Assistant Ready!');
                console.log(`   Frontend: http://localhost:${PORT}`);
                console.log(`   Health:   http://localhost:${PORT}/health`);
                console.log(`   API:      http://localhost:${PORT}/api/research`);
                console.log('\n   Use X-User-Id header for API authentication (dev mode)\n');
            }
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start server', { error });
        process.exit(1);
    }
};
process.on('SIGTERM', async () => {
    logger_1.logger.info('SIGTERM received, shutting down gracefully');
    await database_1.pool.end();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.logger.info('SIGINT received, shutting down gracefully');
    await database_1.pool.end();
    process.exit(0);
});
startServer();
