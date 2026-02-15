import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import agentRoutes from './routes/agent.routes';
import { pool } from './config/database';
import { logger } from './utils/logger';
import { ensureTestUser } from './middleware/auth.middleware';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip
    });
    next();
});

app.get('/health', async (req: Request, res: Response) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected'
        });
    }
});

app.use('/api/agent', agentRoutes);

app.use((req: Request, res: Response) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.path} does not exist`
    });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error', {
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

const startServer = async (): Promise<void> => {
    try {
        await pool.query('SELECT NOW()');
        logger.info('Database connected successfully');

        try {
            await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
            logger.info('pgvector extension verified');
        } catch (e) {
            logger.warn('pgvector extension check failed - vector search may not work');
        }

        if (process.env.NODE_ENV === 'development') {
            const testUser = await ensureTestUser();
            logger.info('Test user available', { userId: testUser.id, email: testUser.email });
        }

        app.listen(PORT, () => {
            logger.info(`Server started on port ${PORT}`);
            logger.info(`Health check: http://localhost:${PORT}/health`);
            logger.info(`API base: http://localhost:${PORT}/api/agent`);

            if (process.env.NODE_ENV === 'development') {
                console.log('\n Shodhak Research Assistant Ready!');
                console.log(`   Frontend: http://localhost:${PORT}`);
                console.log(`   Health:   http://localhost:${PORT}/health`);
                console.log(`   API:      http://localhost:${PORT}/api/agent`);
                console.log('\n   Use X-User-Id header for API authentication (dev mode)\n');
            }
        });

    } catch (error) {
        logger.error('Failed to start server', { error });
        process.exit(1);
    }
};

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await pool.end();
    process.exit(0);
});

startServer();