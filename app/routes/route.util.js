const controller = require('../controllers/common.controller')
const setupRoutes = (router, routes) => {
    routes.forEach(route => {
        const { method, path, middlewares, handler } = route;
        router[method](path, ...middlewares, controller(handler));
    });
};

module.exports = setupRoutes;