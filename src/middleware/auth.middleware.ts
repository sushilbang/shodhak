import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

// extend express request type to include user
export interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
    }
}

/*
Authentication middleware - the gatekeeper of all protected routes.
For Development: Uses a simple X-User-Id header or created a default user.
For Production: Replace with JWT verification, OAuth, or session-based auth.

Flow:
1. check for auth header (X-user-id for dev, Authorizations: Bearer <token> for prod).
2. Validate the user exists in database
3. Attach user object to request
4. call next() to proceed, or return 401 if unauthorized.
*/

export const authMiddleware = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // development mode: accept user id from header
        // easy testing without full auth implementation
        const userIdHeader = req.headers['x-user-id'];
        if (userIdHeader) {
            const userId = parseInt(userIdHeader as string, 10);
            if (isNaN(userId)) {
                res.status(400).json({ error: 'Invalid user ID format' });
                return;
            }

            const result = await pool.query(
                'SELECT id, email from users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                res.status(401).json({ error: 'User not found' });
                return;
            }

            // attach user to request object - this is what controller access via req.user
            req.user = {
                id: result.rows[0].id,
                email: result.rows[0].email
            };

            next();
            return;
        }

        // no auth header provided
        res.status(401).json({
            error: 'Authentication required',
            hint: 'Include X-User-Id header with you user ID'
        });
    } catch (error) {
        console.error('Auth middleware error: ', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// create a test user if none exists
export const ensureTestUser = async (): Promise<{ id: number; email: string }> => {
    const testEmail = 'test@example.com';
    let result = await pool.query(
        'SELECT id, email FROM users WHERE email = $1',
        [testEmail]
    );

    if(result.rows.length === 0) {
        result = await pool.query(
            'INSERT INTO users (email) VALUES ($1) RETURNING id, email',
            [testEmail]
        );
    }

    return result.rows[0];
}