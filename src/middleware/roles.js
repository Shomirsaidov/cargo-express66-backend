/**
 * Middleware factory that restricts access to users with specified roles.
 * Must be used after the authenticate middleware.
 *
 * Usage: requireRole('admin'), requireRole('admin', 'warehouse_employee')
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of these roles: ${roles.join(', ')}`,
      });
    }

    next();
  };
};

module.exports = { requireRole };
