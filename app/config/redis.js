require ('dotenv').config()
const {createClient} = require('redis');

const client = createClient({
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_ENDPOINT,
    port: 12821,
  },
});

client.on("error", (error) => {
  console.log("Redis error", error);
});

client.connect();

const redisClient = {
  get: async (key) => {
    const data = await client.get(key);
    return JSON.parse(data);
  },
  set: async (key, value, expire = 60 * 60 * 24 * 30) => {
    const data = JSON.stringify(value);
    await client.set(key, data);
    await client.expire(key, expire);
    return true;
  },
  del: async (key) => {
    return await client.del(key);
  },
  zadd: client.zAdd,
  zremrangebyscore: client.zRemRangeByScore,
};

module.exports = redisClient
