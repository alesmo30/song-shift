class AppError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(details) {
        super('Validation Error', 400, details);
        this.name = 'ValidationError';
    }
}

class AuthenticationError extends AppError {
    constructor(message = 'Authentication Error') {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Authorization Error') {
        super(message, 403);
        this.name = 'AuthorizationError';
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Not Found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter) {
        super(message, 429, { retryAfter });
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

class ExternalServiceError extends AppError {
    constructor(message = 'External service is unavailable') {
        super(message, 502);
        this.name = 'ExternalServiceError';
    }
}

module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    ExternalServiceError
};
