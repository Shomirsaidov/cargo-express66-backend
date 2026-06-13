/**
 * Global error handler middleware.
 * Must be registered last in Express app.
 */
const errorHandler = (err, req, res, next) => {
  console.error('Unhandled error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  // Validation errors from express-validator
  if (err.type === 'validation') {
    return res.status(422).json({
      error: 'Validation failed',
      details: err.errors,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(422).json({ error: 'File too large' });
  }

  // Supabase / PostgreSQL unique constraint
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Record already exists' });
  }

  // Default
  const statusCode = err.statusCode || err.status || 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal server error'
      : err.message || 'Internal server error';

  res.status(statusCode).json({ error: message });
};

module.exports = { errorHandler };
