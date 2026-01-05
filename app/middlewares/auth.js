const jwt = require('jsonwebtoken')
const authenticateUser = (req, res, next) => {
    // console.log('authentication')
    const token = req.headers['authorization']
    // console.log(token)
    if (!token) {
        return res.status(401).json({ error: 'token is required' })
    }
    try {
        const tokenData = jwt.verify(token, process.env.JWT_SECRET)
        // console.log('data',tokenData)
        req.user = {
            id:tokenData.id,
            role: tokenData.role,
            userId: tokenData.userId,
            email: tokenData.email,
            number: tokenData.number,
            restaurantId: tokenData.restaurantId,
        }
        next()
    } catch (err) {
        // console.log(err)
        res.status(401).json({ error: 'invalid token' })
    }
}

const authorizeUser = (permittedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "User authentication required" });
        }
        if (permittedRoles.includes(req.user.role)) {
            return next();
        }
        res.status(403).json({ error: "You are not authorized to perform this action" });
    };
};

module.exports = { authenticateUser, authorizeUser }